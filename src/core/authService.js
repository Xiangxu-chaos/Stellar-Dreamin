/**
 * authService.js —— 自建后端（Cloudflare Worker + D1）认证与行为上报
 * ============================================================================
 * 背景：Supabase（国内被墙 + 代理域名始终 NXDOMAIN）与腾讯云 CloudBase 两套方案
 * 均已废弃，改用**我们自己的免备案后端**（Cloudflare Worker + D1）。
 *
 * 接口（全部 POST + JSON）：
 *   注册  POST /api/register  { username, password }            → { success, userId }
 *   登录  POST /api/login     { username, password }            → { success, userId }
 *   上报  POST /api/record    { userId, type, word, domainId }
 *
 * 职责边界：
 *   ✅ 本项目**唯一**发起认证 / 上报网络请求的模块（唯一出现 fetch 的地方）。
 *   ✅ 会话（userId）落在 localStorage —— core 层允许直接访问存储；
 *      components/ 与 pages/ 一律通过 props 或经本模块间接使用（分层铁律，
 *      由 tools/verifyIncrement.mjs 第 10 项机械断言）。
 *   ❌ 不渲染任何 UI（登录页在 views/loginView.js）。
 *   ❌ 本阶段**不做数据隔离**：收藏 / 错题 / 熟词仍全部走本地 localStorage，
 *      /api/record 只做「行为上报」，不回写本地、不参与渲染。
 *      因此上报失败绝不影响任何本地功能（全部吞掉并只打 warn）。
 *
 * 容错原则：
 *   · 所有存储访问包 try/catch（隐私模式 / 存储被禁用时不能崩）。
 *   · 请求带超时（AbortController），避免网络黑洞把按钮永远卡在 loading。
 *   · reportRecord 永不抛错、永不 reject（fire-and-forget）。
 * ============================================================================
 */

/** 后端根地址（Cloudflare Worker） */
export const API_BASE = 'https://api.stellar-dreamin.site';

/** 会话存储键（与 dataService 的 wb:cet6:* 命名空间保持一致） */
export const SESSION_KEY = 'wb:cet6:auth';

/** 单次请求超时（毫秒） */
export const REQUEST_TIMEOUT = 12000;

/** 上报事件类型：收藏 / 答错 / 标记熟词 */
export const RECORD_TYPES = Object.freeze({
  FAVORITE: 'favorite',
  WRONG: 'wrong',
  MASTERED: 'mastered',
});

/** 接口路径 */
export const PATHS = Object.freeze({
  register: '/api/register',
  login: '/api/login',
  record: '/api/record',
});

/* ---------------------------------------------------------------------------
 * 本地会话（localStorage）
 * ------------------------------------------------------------------------ */

function safeGetItem(key) {
  try {
    return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('[authService] 无法写入本地会话（存储可能被禁用）', e);
    return false;
  }
}

function safeRemoveItem(key) {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 读取本地会话。
 * 兼容两种历史形态：纯字符串 userId、以及 { userId, username } JSON。
 * @returns {{userId: string, username: string}|null} 未登录返回 null
 */
export function loadSession() {
  const raw = safeGetItem(SESSION_KEY);
  if (!raw) return null;

  // 形态一：直接存 userId 字符串
  if (!raw.startsWith('{')) {
    const userId = raw.trim();
    return userId ? { userId, username: '' } : null;
  }

  // 形态二：JSON
  try {
    const obj = JSON.parse(raw);
    const userId = String(obj?.userId || '').trim();
    if (!userId) return null;
    return { userId, username: String(obj?.username || '') };
  } catch (e) {
    console.warn('[authService] 本地会话已损坏，按未登录处理');
    return null;
  }
}

/**
 * 写入本地会话（登录 / 注册成功后调用）。
 * @param {string} userId
 * @param {string} [username]
 * @returns {boolean} 是否写入成功
 */
export function saveSession(userId, username = '') {
  const id = String(userId || '').trim();
  if (!id) return false;
  return safeSetItem(SESSION_KEY, JSON.stringify({
    userId: id,
    username: String(username || ''),
    at: Date.now(),
  }));
}

/** 清除本地会话（退出登录） */
export function clearSession() {
  return safeRemoveItem(SESSION_KEY);
}

/** 当前 userId（未登录返回空串） */
export function getUserId() {
  return loadSession()?.userId || '';
}

/** 是否已登录 */
export function isSignedIn() {
  return Boolean(getUserId());
}

/* ---------------------------------------------------------------------------
 * 请求
 * ------------------------------------------------------------------------ */

/** 构造带 code 的错误对象，便于上层翻译文案 */
function makeError(code, message, extra = {}) {
  const err = new Error(message || '请求失败');
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * 统一 POST JSON。
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>} 解析后的响应体
 * @throws {Error} 带 code：'timeout' | 'network' | 'http' | 'bad-json' | 'api'
 */
async function postJSON(path, body) {
  if (typeof fetch !== 'function') {
    throw makeError('network', '当前环境不支持网络请求。');
  }

  const url = `${API_BASE}${path}`;
  const hasAbort = typeof AbortController === 'function';
  const ctrl = hasAbort ? new AbortController() : null;
  const timer = hasAbort ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT) : null;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw makeError('timeout', '请求超时，请检查网络后重试。');
    }
    throw makeError('network', '网络请求失败，无法连接服务器。', { cause: e });
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 响应体可能是 JSON、也可能是 Worker 返回的纯文本错误页
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || text || `服务器返回 ${res.status}`;
    throw makeError('http', String(msg).slice(0, 300), { status: res.status });
  }
  if (!data) {
    throw makeError('bad-json', '服务器返回了无法解析的内容。', { status: res.status });
  }
  if (data.success === false) {
    throw makeError('api', data.message || data.error || '操作失败，请稍后重试。');
  }
  return data;
}

/**
 * 校验并归一化表单输入。
 * 只在客户端做「非空 + 去空格」，不额外加长度限制 ——
 * 具体规则由后端决定，前端不应替它拒绝合法输入。
 * @returns {{username: string, password: string}}
 */
function normalizeCredentials(username, password) {
  const u = String(username ?? '').trim();
  const p = String(password ?? '');
  if (!u) throw makeError('input', '请输入用户名。');
  if (!p) throw makeError('input', '请输入密码。');
  return { username: u, password: p };
}

/* ---------------------------------------------------------------------------
 * 注册 / 登录 / 退出
 * ------------------------------------------------------------------------ */

/** 从响应里取 userId（后端约定 { success, userId }） */
function pickUserId(data) {
  const userId = String(data?.userId ?? '').trim();
  if (!userId) throw makeError('api', '服务器未返回用户标识（userId），请检查后端返回格式。');
  return userId;
}

/**
 * 注册。成功后**不自动写入会话**，由 UI 层决定是「注册后直接进入」还是「回登录页」。
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{userId: string, username: string}>}
 */
export async function register(username, password) {
  const cred = normalizeCredentials(username, password);
  const data = await postJSON(PATHS.register, cred);
  return { userId: pickUserId(data), username: cred.username };
}

/**
 * 登录。成功后**不自动写入会话**（保持纯函数语义，便于测试）。
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{userId: string, username: string}>}
 */
export async function login(username, password) {
  const cred = normalizeCredentials(username, password);
  const data = await postJSON(PATHS.login, cred);
  return { userId: pickUserId(data), username: cred.username };
}

/**
 * 注册并直接建立本地会话（登录页「注册」标签页使用）。
 * 后端注册接口只返回 userId、不返回 token，因此注册成功即视为已登录。
 */
export async function registerAndSignIn(username, password) {
  const r = await register(username, password);
  saveSession(r.userId, r.username);
  return r;
}

/** 登录并建立本地会话 */
export async function loginAndSignIn(username, password) {
  const r = await login(username, password);
  saveSession(r.userId, r.username);
  return r;
}

/**
 * 退出登录：清除本地会话。
 * 本阶段无服务端会话（纯 userId），因此只需清本地。
 */
export function logout() {
  clearSession();
  return true;
}

/* ---------------------------------------------------------------------------
 * 行为上报
 * ------------------------------------------------------------------------ */

/**
 * 上报一次用户行为（收藏 / 答错 / 标记熟词）。
 *
 * **fire-and-forget**：调用方无需 await；未登录或参数不全时直接跳过；
 * 任何失败都只打 warn，绝不抛错、绝不 reject —— 上报属于旁路统计，
 * 不能因为后端抖动而影响用户手上的收藏 / 复习操作。
 *
 * @param {object} payload
 * @param {string} payload.type     RECORD_TYPES.*
 * @param {string} payload.word
 * @param {string} [payload.domainId]
 * @returns {Promise<object|null>} 成功返回响应体，跳过或失败返回 null
 */
export function reportRecord({ type, word, domainId } = {}) {
  const userId = getUserId();
  if (!userId) return Promise.resolve(null);      // 未登录：不上报
  if (!type || !word) return Promise.resolve(null);

  const body = { userId, type, word: String(word), domainId: String(domainId || '') };
  return postJSON(PATHS.record, body).catch((e) => {
    console.warn('[authService] 上报失败（不影响本地功能）', body, e?.message || e);
    return null;
  });
}

/* ---------------------------------------------------------------------------
 * 文案
 * ------------------------------------------------------------------------ */

/** 把网络 / 后端报错翻成用户能看懂的中文 */
export function translateAuthError(err) {
  if (!err) return '操作失败，请稍后重试。';
  const code = String(err.code || '');
  const raw = String(err.message || err);

  if (code === 'input') return raw;
  if (code === 'timeout') return '请求超时，请检查网络后重试。';
  if (code === 'network') return '网络连接失败，无法访问服务器，请检查网络后重试。';
  if (code === 'bad-json') return '服务器返回的内容无法解析，请稍后重试。';
  if (code === 'http') {
    if (err.status === 401 || err.status === 403) return '用户名或密码错误。';
    if (err.status === 409) return '该用户名已被注册。';
    if (err.status === 404) return '接口不存在（404），请检查后端路由是否正确。';
    if (err.status >= 500) return '服务器内部错误（' + err.status + '），请稍后重试。';
    return raw;
  }
  return raw || '操作失败，请稍后重试。';
}

export default {
  API_BASE,
  SESSION_KEY,
  RECORD_TYPES,
  loadSession,
  saveSession,
  clearSession,
  getUserId,
  isSignedIn,
  register,
  login,
  registerAndSignIn,
  loginAndSignIn,
  logout,
  reportRecord,
  translateAuthError,
};
