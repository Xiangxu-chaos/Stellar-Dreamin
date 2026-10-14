/**
 * cloudbaseClient.js —— 腾讯云 CloudBase 客户端与认证封装（国内节点，无需代理）
 * ============================================================================
 * 职责边界：
 *   ✅ 本项目**唯一**允许接触 CloudBase SDK 的地方。
 *   ✅ 对外只暴露 Promise 语义的认证函数，配套中文错误文案。
 *   ❌ 不渲染任何 UI（路由与展示在 main.js / pages/homePage.js）。
 *   ❌ 不读写业务数据（收藏 / 错题 / 熟词）—— 那是「数据层迁移」阶段的事。
 *
 * SDK 引入方式（重要）：
 *   SDK 由 index.html 里的**传统 <script>** 引入 UMD 全量包
 *   （cloudbase.full.js），它会把 SDK 挂到 `window.cloudbase` 上。
 *   本模块从全局变量取用，**不做 import**：
 *     - 传统脚本是同步阻塞加载的，而本模块属于 deferred module，
 *       执行时全局必然已就绪，时序比动态 import 更确定；
 *     - 也不依赖任何打包器，符合项目「原生 ESM、零构建」的约定。
 *   具体地址见 index.html（国内 CDN：static.cloudbase.net）。
 *
 * 当前登录方式：**匿名登录**（无登录页，打开即用）。
 *   ⚠️ 控制台必须先开启「匿名登录」：CloudBase 控制台 → 环境 → 登录授权。
 *      未开启时 SDK 会抛 PROVIDER_NOT_ENABLED，本模块会翻译成中文指引。
 * ============================================================================
 */

/** CloudBase 环境 ID（控制台 → 环境 → 环境 ID） */
export const ENV_ID = 'stellar-dreamin-d2f2vgn912ba7454';

/** SDK 在 window 上暴露的全局名（cloudbase.full.js 的 UMD 导出名） */
const SDK_GLOBAL = 'cloudbase';

/**
 * 等待 SDK 就绪的最长毫秒数。
 * index.html 用的是 defer 脚本，按文档顺序必然先于本模块执行；
 * 走到「还要等待」基本只可能是脚本加载失败，所以不必等太久。
 */
const SDK_READY_TIMEOUT = 5000;

let appInstance = null;
let appPromise = null;
let authInstance = null;
let signInPromise = null;

/* ---------------------------------------------------------------------------
 * 初始化
 * ------------------------------------------------------------------------ */

/**
 * 等待 `window.cloudbase` 就绪。
 * 正常时序下 <script> 会阻塞解析、必然先于本模块执行；这里的轮询只是兜住
 * 「脚本被改成 async/defer」或「加载失败未挂载」这类边角情况，并给出可读错误。
 * 导出是为了让回归测试能传入极短超时，无需真的空等。
 * @param {number} [timeout] 最长等待毫秒数
 */
export async function waitForSdk(timeout = SDK_READY_TIMEOUT) {
  if (typeof window === 'undefined') {
    throw new Error('CloudBase SDK 只能在浏览器中运行。');
  }
  const deadline = Date.now() + timeout;
  for (;;) {
    const sdk = window[SDK_GLOBAL];
    if (sdk && typeof sdk.init === 'function') return sdk;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(
    'CloudBase SDK 未加载：请确认 index.html 里的 SDK <script> 存在且可访问'
    + '（国内 CDN：static.cloudbase.net）。',
  );
}

/**
 * 取（并按需初始化）单例 app。
 * 初始化失败会清空缓存，允许调用方重试。
 * @returns {Promise<object>} CloudBase app 实例
 */
export function getApp() {
  if (appInstance) return Promise.resolve(appInstance);
  if (!appPromise) {
    appPromise = waitForSdk()
      .then((sdk) => {
        if (!ENV_ID) throw new Error('缺少 CloudBase 环境 ID。');
        appInstance = sdk.init({ env: ENV_ID });
        return appInstance;
      })
      .catch((e) => {
        appPromise = null;   // 允许重试
        throw e;
      });
  }
  return appPromise;
}

/**
 * 取（并按需创建）auth 单例。
 * persistence: 'local' → 登录态写入 localStorage，刷新页面免重新登录
 * （SDK 默认即为 local，这里显式声明以免版本变更改变行为）。
 * @returns {Promise<object>} auth 实例
 */
export async function getAuth() {
  if (authInstance) return authInstance;
  const app = await getApp();
  if (typeof app.auth !== 'function') {
    throw new Error('CloudBase 初始化异常：app.auth() 不可用。');
  }
  authInstance = app.auth({ persistence: 'local' });
  return authInstance;
}

/* ---------------------------------------------------------------------------
 * 匿名登录
 * ------------------------------------------------------------------------ */

/**
 * 确保处于「已登录」状态（幂等）。
 *   ① localStorage 里已有登录态（刷新页面）→ 直接复用，不新建匿名用户；
 *   ② 否则调用 signInAnonymously() 创建匿名用户。
 * 并发调用只会真正登录一次（缓存 Promise）。
 * @returns {Promise<{user: object|null, isNew: boolean}>}
 */
export function ensureSignedIn() {
  if (signInPromise) return signInPromise;
  signInPromise = (async () => {
    const auth = await getAuth();

    // ① 复用已有登录态
    try {
      const state = await auth.getLoginState?.();
      if (state?.user) return { user: state.user, isNew: false };
    } catch (e) {
      // 本地登录态损坏 / 取不到 → 继续走匿名登录
      console.warn('[cloudbaseClient] 读取本地登录态失败，改走匿名登录', e);
    }

    // ② 匿名登录
    const res = await auth.signInAnonymously();
    return { user: res?.user || null, isNew: true };
  })().catch((e) => {
    signInPromise = null;   // 失败后允许重试
    throw new Error(translateAuthError(e));
  });
  return signInPromise;
}

/**
 * 当前登录用户（未登录 / 出错均返回 null，无副作用）。
 * @returns {Promise<object|null>}
 */
export async function getCurrentUser() {
  try {
    const auth = await getAuth();
    const state = await auth.getLoginState?.();
    return state?.user || null;
  } catch (e) {
    return null;
  }
}

/**
 * 退出当前登录态。
 * 界面目前没有入口（匿名用户没有「注销」概念），保留给后续「真实账号」阶段。
 */
export async function signOut() {
  const auth = await getAuth();
  await auth.signOut();
  signInPromise = null;
  return true;
}

/** SDK 是否已完成初始化（仅用于调试，不影响业务） */
export function isReady() {
  return Boolean(appInstance && authInstance);
}

/* ---------------------------------------------------------------------------
 * 工具
 * ------------------------------------------------------------------------ */

/** 把 CloudBase 的结构化 / 英文报错翻成用户能看懂的中文 */
export function translateAuthError(err) {
  if (!err) return '操作失败，请稍后重试。';

  const category = String(err.category || '');
  const raw = String(err.message || err || '');
  const m = `${category} ${raw}`.toLowerCase();

  if (m.includes('provider_not_enabled')) {
    return '匿名登录未开启：请到 CloudBase 控制台 → 环境 → 登录授权，开启「匿名登录」后重试。';
  }
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('load failed') || m.includes('timeout')) {
    return '网络连接失败，无法访问 CloudBase，请检查网络后重试。';
  }
  if (m.includes('quota') || m.includes('rate limit') || m.includes('too many')) {
    return '请求过于频繁或超出配额，请稍后再试。';
  }
  if (m.includes('env') && (m.includes('not found') || m.includes('invalid') || m.includes('no permission'))) {
    return `CloudBase 环境无效或无权限（${ENV_ID}），请核对环境 ID。`;
  }
  return raw || '认证失败，请稍后重试。';
}

export default {
  ENV_ID,
  getApp,
  getAuth,
  ensureSignedIn,
  getCurrentUser,
  signOut,
  isReady,
  translateAuthError,
};
