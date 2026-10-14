/**
 * verifyAuth.mjs —— 自建后端（Cloudflare Worker + D1）认证闭环回归校验
 * ============================================================================
 * 背景：认证方案已走过 Supabase（被墙）→ 腾讯云 CloudBase（已废弃），
 *       现改为**自建免备案后端**：POST /api/register、/api/login、/api/record。
 *
 * 本脚本**不联网**（全部用假 fetch），分两层：
 *
 *   一、静态校验
 *     1. core/authService.js：三个接口路径、POST+JSON、超时、会话读写、
 *        行为上报（fire-and-forget，永不抛错）、中文错误文案、对外导出。
 *     2. index.html：已移除全部第三方 SDK 引入。
 *     3. main.js：路由守卫（有 userId → 主界面；无 → 登录页）+ 退出登录。
 *     4. pages/homePage.js：顶栏「当前用户：{userId}」+ 退出按钮 + 三处行为上报；
 *        **不碰 localStorage / fetch**（分层铁律）。
 *     5. services/quizService.js：答错单点上报。
 *     6. views/loginView.js：登录/注册双标签；**不碰 localStorage / fetch**。
 *     7. CSS / 目录：CloudBase、Supabase 代码彻底清干净。
 *
 *   二、动态（DOM shim + 假 fetch）
 *     1. authService：注册 / 登录 / 会话落盘 / 各条错误路径 / 上报 payload / 未登录不请求。
 *     2. createLoginView()：默认登录态、切到注册态、提交成功后回调 + 会话落盘、
 *        失败时显示错误且不回调。
 *     3. createHomePage()：未注入 → 无用户区（老 DOM 结构不变）；注入 → 当前用户 + 退出按钮。
 * ============================================================================
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
/** 剥掉注释再匹配，避免「注释里提到某词」造成的假通过/假失败 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const API_BASE = 'https://api.stellar-dreamin.site';

/* ==========================================================================
 * 一、静态校验
 * ======================================================================= */

/* ---- 1. authService.js ---- */
ok('src/core/authService.js 存在', exists('src/core/authService.js'));
const asrc = read('src/core/authService.js');

ok('填入后端根地址 api.stellar-dreamin.site', asrc.includes(`'${API_BASE}'`));
ok('注册接口路径 /api/register', /register:\s*'\/api\/register'/.test(asrc));
ok('登录接口路径 /api/login', /login:\s*'\/api\/login'/.test(asrc));
ok('上报接口路径 /api/record', /record:\s*'\/api\/record'/.test(asrc));
ok('用 POST 发起请求', /method:\s*'POST'/.test(asrc));
ok('用 JSON 作为 body', /JSON\.stringify\(/.test(asrc) && /'Content-Type':\s*'application\/json'/.test(asrc));
ok('请求带超时（AbortController）', /AbortController/.test(asrc) && /REQUEST_TIMEOUT/.test(asrc));
ok('session 走 wb:cet6 命名空间', /SESSION_KEY\s*=\s*'wb:cet6:auth'/.test(asrc));

for (const fn of ['loadSession', 'saveSession', 'clearSession', 'getUserId', 'isSignedIn',
  'register', 'login', 'registerAndSignIn', 'loginAndSignIn', 'logout',
  'reportRecord', 'translateAuthError']) {
  ok(`导出 ${fn}`,
    new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`).test(asrc)
    || new RegExp(`export\\s+const\\s+${fn}\\b`).test(asrc));
}

ok('上报三类事件常量（收藏 / 答错 / 熟词）',
  /FAVORITE:\s*'favorite'/.test(asrc) && /WRONG:\s*'wrong'/.test(asrc) && /MASTERED:\s*'mastered'/.test(asrc));

/* 上报请求体必须严格是 { userId, type, word, domainId } —— 后端按此签名解析 */
ok('上报体含 userId / type / word / domainId 四个字段',
  /const body = \{\s*userId,\s*type,\s*word:[\s\S]{0,40}domainId:/.test(asrc));
ok('上报是 fire-and-forget（内部 catch，绝不 reject）',
  /return postJSON\(PATHS\.record, body\)\.catch\(/.test(asrc));
ok('未登录时上报直接跳过（不产生请求）',
  /if \(!userId\) return Promise\.resolve\(null\)/.test(asrc));

ok('中文错误文案：网络失败', /网络连接失败/.test(asrc));
ok('中文错误文案：请求超时', /请求超时/.test(asrc));
ok('401/403 → 用户名或密码错误', /用户名或密码错误/.test(asrc));
ok('409 → 该用户名已被注册', /该用户名已被注册/.test(asrc));
ok('识别 { success: false } 的业务失败', /data\.success === false/.test(asrc));

ok('authService 不渲染 UI（不 import components / pages / views）',
  !/from\s*'\.\.\/(components|pages|views)\//.test(asrc));
ok('authService 不引用任何第三方 SDK',
  !/@supabase|cloudbase|esm\.sh|jsdelivr/i.test(code(asrc)));

/* ---- 2. index.html ---- */
const html = read('index.html');
ok('index.html 不再引入 CloudBase SDK', !/cloudbase/i.test(html));
ok('index.html 不再引入 Supabase SDK', !!/supabase/i.test(html) === false);
ok('index.html 不含任何第三方 CDN 脚本（除字体）',
  !/<script[^>]+src="https?:\/\//.test(html));
ok('index.html 仍以 module 方式加载 main.js',
  /<script\s+type="module"\s+src="\.\/src\/main\.js"><\/script>/.test(html));

/* ---- 3. main.js 路由守卫 ---- */
const main = read('src/main.js');
ok('main.js 引入 authService',
  /import\s+\*\s+as\s+authService\s+from\s*'\.\/core\/authService\.js'/.test(main));
ok('main.js 引入登录页',
  /import\s*\{\s*createLoginView\s*\}\s*from\s*'\.\/views\/loginView\.js'/.test(main));
ok('启动时读本地会话决定路由', /authService\.loadSession\(\)/.test(main));
ok('有会话 → 渲染主界面', /if\s*\(session\)\s*\{[\s\S]{0,120}showApp\(session\)/.test(main));
ok('无会话 → 渲染登录页', /else\s*\{?\s*showLogin\(\)/.test(main));
ok('登录成功回调里进入主界面', /onSuccess:[\s\S]{0,200}showApp\(session\)/.test(main));
ok('退出登录调用 authService.logout()', /authService\.logout\(\)/.test(main));
ok('退出后回到登录页', /authService\.logout\(\)[\s\S]{0,80}showLogin\(\)/.test(main));
ok('把 userId 注入 homePage', /createHomePage\(\{[\s\S]{0,80}userId/.test(main));
ok('把 onSignOut 注入 homePage', /onSignOut:\s*handleSignOut/.test(main));
ok('main.js 不再引用 cloudbase / supabase',
  !/cloudbase|supabase/i.test(code(main)));

/* ---- 4. homePage：顶栏 + 上报 + 分层边界 ---- */
const hp = read('src/pages/homePage.js');
const hpCode = code(hp);
ok('homePage 接收 userId / username / onSignOut',
  /const\s*\{\s*userId = '',\s*username = '',\s*onSignOut\s*\}\s*=\s*options/.test(hp));
ok('homePage 不再接收 user / authError',
  !/authError/.test(hpCode) && !/\{\s*user = null/.test(hpCode));
ok('顶栏渲染 .topbar__user', /topbar__user/.test(hp));
ok('顶栏显示「当前用户：{userId}」', /当前用户：\$\{userId\}/.test(hp));
ok('顶栏有退出登录按钮', /'aria-label':\s*'退出登录'/.test(hp) && /iconPath\('logout'\)/.test(hp));
ok('退出按钮只触发注入的回调（不自己清会话）',
  /onClick:\s*\(\)\s*=>\s*\{\s*if \(typeof onSignOut === 'function'\) onSignOut\(\);/.test(hp));

ok('收藏时上报（RECORD_TYPES.FAVORITE）', /RECORD_TYPES\.FAVORITE/.test(hp));
ok('标记熟词时上报（RECORD_TYPES.MASTERED）', /RECORD_TYPES\.MASTERED/.test(hp));
ok('上报只在「成为收藏 / 熟词」时触发（取消不上报）',
  /if \(actual\) report\(authService\.RECORD_TYPES\.FAVORITE/.test(hp)
  && /if \(actual\) report\(authService\.RECORD_TYPES\.MASTERED/.test(hp));
ok('上报封装成 report() 且未登录直接返回', /function report\(type, word, domainId\)[\s\S]{0,80}if \(!userId\) return;/.test(hp));

ok('分层边界：homePage 不碰 localStorage', !/localStorage\s*\./.test(hpCode));
ok('分层边界：homePage 不直接 fetch', !/[^.\w]fetch\s*\(/.test(hpCode));

/* ---- 5. quizService：答错上报 ---- */
const qs = read('src/services/quizService.js');
ok('quizService 引入 authService',
  /import\s+\*\s+as\s+authService\s+from\s*'\.\.\/core\/authService\.js'/.test(qs));
ok('答错时上报（RECORD_TYPES.WRONG）',
  /if \(!correct\)\s*\{[\s\S]{0,200}RECORD_TYPES\.WRONG/.test(qs));
ok('答错上报在 submitQuizAnswer 内（所有做题入口的唯一交汇点）',
  /export async function submitQuizAnswer[\s\S]*?RECORD_TYPES\.WRONG/.test(qs));

/* ---- 6. loginView ---- */
ok('src/views/loginView.js 存在', exists('src/views/loginView.js'));
const lv = read('src/views/loginView.js');
const lvCode = code(lv);
ok('loginView 导出 createLoginView', /export function createLoginView/.test(lv));
ok('含「登录」「注册」双标签', /'登录'/.test(lv) && /'注册'/.test(lv) && /auth-tab/.test(lv));
ok('用户名输入框', /type:\s*'text'/.test(lv) && /用户名/.test(lv));
ok('密码输入框', /type:\s*'password'/.test(lv) && /密码/.test(lv));
ok('密码可见性开关', /auth__eye/.test(lv) && /eyeOff/.test(lv));
ok('调用 authService 的登录/注册', /authService\.loginAndSignIn/.test(lv) && /authService\.registerAndSignIn/.test(lv));
ok('成功后回调 onSuccess(session)', /onSuccess\(session\)/.test(lv));
ok('失败时用 translateAuthError 出中文文案', /authService\.translateAuthError\(err\)/.test(lv));
ok('防止 click + submit 双触发（busy 标志）', /if \(busy\) return;/.test(lv));
ok('分层边界：loginView 不碰 localStorage', !/localStorage\s*\./.test(lvCode));
ok('分层边界：loginView 不直接 fetch', !/[^.\w]fetch\s*\(/.test(lvCode));

/* ---- 7. CSS ---- */
const css = read('src/styles/components.css');
for (const cls of ['auth', 'auth__card', 'auth-tab', 'auth__tabs', 'auth__form',
  'auth__field', 'auth__msg', 'auth__submit', 'auth__eye',
  'topbar__user', 'topbar__user-name', 'topbar__user-out']) {
  ok(`CSS 定义 .${cls}`, new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}\\b`).test(css));
}
ok('CSS 已清掉匿名态遗留样式（.topbar__user-mail / --offline）',
  !/\.topbar__user-mail/.test(css) && !/\.topbar__user--offline/.test(css));
ok('登录卡片输入行用同权重选择器撑满宽度（不被 .field input 的 min-width 盖掉）',
  /\.auth__field\.field\s*\{/.test(css) && /\.auth__field\.field input\s*\{/.test(css));
ok('登录页样式未使用未定义的 --radius-pill',
  !/\.auth[\s\S]{0,4000}?var\(--radius-pill\)/.test(css.split('.topbar__user')[0] || ''));

const responsive = read('src/styles/responsive.css');
ok('响应式含登录页小屏规则', /\.auth\s*\{\s*padding:/.test(responsive));
ok('小屏顶栏用户区有宽度上限（避免挤爆一行）', /\.topbar__user\s*\{[^}]*max-width:\s*150px/.test(responsive));

/* ---- 8. 旧方案残留 ---- */
for (const f of ['src/core/cloudbaseClient.js', 'src/core/supabaseClient.js', 'sql/01_init_schema.sql']) {
  ok(`已删除 ${f}`, !exists(f));
}
ok('src/ 下代码无 cloudbase 残留', !code(read('src/core/authService.js')).match(/cloudbase/i)
  && !code(main).match(/cloudbase/i));
ok('src/ 下代码无 supabase 残留', !code(main).match(/supabase/i) && !code(hp).match(/supabase/i));

/* ==========================================================================
 * 二、DOM shim（参考 smokeDom.mjs / 旧版 verifyAuth.mjs）
 * ======================================================================= */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this._text = null;
    this._html = '';
    this._cls = new Set();
    this.nodeType = 1;
    this.parentNode = null;
    this._ev = {};
    this._disabled = false;
    this.classList = {
      add: (...c) => c.filter(Boolean).forEach((x) => String(x).split(/\s+/).filter(Boolean).forEach((y) => this._cls.add(y))),
      remove: (...c) => c.forEach((x) => this._cls.delete(x)),
      contains: (c) => this._cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !this._cls.has(c) : !!f; on ? this._cls.add(c) : this._cls.delete(c); return on; },
      get length() { return this._cls.size; },
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(c) { if (c == null) return c; this.children.push(c); if (c.nodeType === 1) c.parentNode = this; return c; }
  append(...cs) { cs.forEach((c) => { if (c == null) return; this.appendChild(typeof c === 'string' ? new TextNode(c) : c); }); }
  replaceChildren(...cs) { this.children.length = 0; this.append(...cs); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  contains(n) { if (n === this) return true; return this.children.some((c) => c.nodeType === 1 && c.contains(n)); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); }
  removeEventListener() {}
  click() { const ev = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    (this._ev.click || []).forEach((fn) => fn(ev)); }
  focus() {} blur() {}
  scrollIntoView() {}
  querySelector(sel) { return this._find(sel, true); }
  querySelectorAll(sel) { return this._find(sel, false); }
  _find(sel, first) {
    const out = [];
    const test = (n) => {
      if (n.nodeType !== 1) return false;
      if (sel.startsWith('.')) return n._cls.has(sel.slice(1));
      if (sel.startsWith('#')) return n.attributes.id === sel.slice(1);
      if (sel.includes('[')) {
        const m = sel.match(/^([a-zA-Z]+)\[type="([^"]+)"\]$/);
        if (m) return n.tagName === m[1].toUpperCase() && n.attributes.type === m[2];
      }
      return n.tagName === sel.toUpperCase();
    };
    const walk = (n) => { for (const c of n.children || []) { if (test(c)) { out.push(c); if (first) return true; } if (walk(c) && first) return true; } return false; };
    walk(this);
    return first ? (out[0] || null) : out;
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get textContent() { return this._text != null ? this._text : this.children.map((c) => c.textContent ?? '').join(''); }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = !!v; }
  get value() { return this._value ?? ''; }
  set value(v) { this._value = String(v); }
}
class TextNode { constructor(t) { this.nodeType = 3; this._t = String(t); } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k)),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i],
  get length() { return store.size; },
};

const body = new El('body');
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  location: { reload() {}, href: 'http://127.0.0.1:8099/', origin: 'http://127.0.0.1:8099', pathname: '/' },
  scrollTo() {}, innerWidth: 1440, innerHeight: 900, localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
};
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => new TextNode(t),
  createElementNS: (_ns, t) => new El(t),
  body, documentElement: new El('html'),
  querySelector: (s) => body.querySelector(s), querySelectorAll: (s) => body.querySelectorAll(s),
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
};
globalThis.Node = El; globalThis.HTMLElement = El; globalThis.Element = El;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(String(e)));

/* ---- 假 fetch：记录每次请求，并按场景返回 ---- */
const httpLog = [];
let httpRespond = async () => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ success: true, userId: 'u-1001' }),
});
globalThis.fetch = (url, init) => { httpLog.push({ url: String(url), init }); return httpRespond(String(url), init); };
const resetLog = () => { httpLog.length = 0; };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/* ==========================================================================
 * 三、动态：authService
 * ======================================================================= */
const auth = await import('../src/core/authService.js');

ok('API_BASE 常量正确', auth.API_BASE === API_BASE, auth.API_BASE);
ok('SESSION_KEY 使用 wb:cet6 命名空间', auth.SESSION_KEY === 'wb:cet6:auth', auth.SESSION_KEY);
ok('RECORD_TYPES 三类事件齐全',
  auth.RECORD_TYPES.FAVORITE === 'favorite'
  && auth.RECORD_TYPES.WRONG === 'wrong'
  && auth.RECORD_TYPES.MASTERED === 'mastered');

/* ---- 3.1 未登录状态 ---- */
ok('初始状态未登录', auth.isSignedIn() === false && auth.getUserId() === '');
ok('loadSession 未登录返回 null', auth.loadSession() === null);

/* ---- 3.2 登录 ---- */
resetLog();
const loginRes = await auth.login('alice', 'pw123456');
ok('login 命中 /api/login', httpLog[0]?.url === `${API_BASE}/api/login`, httpLog[0]?.url);
ok('login 用 POST', httpLog[0]?.init?.method === 'POST');
ok('login 带上 username / password',
  JSON.parse(httpLog[0].init.body).username === 'alice'
  && JSON.parse(httpLog[0].init.body).password === 'pw123456');
ok('login 解析出 userId', loginRes.userId === 'u-1001');
ok('login 本身不写会话（纯函数语义）', auth.isSignedIn() === false);

await auth.loginAndSignIn('alice', 'pw123456');
ok('loginAndSignIn 写入本地会话', auth.isSignedIn() === true && auth.getUserId() === 'u-1001');
ok('saveSession 落成 JSON（含 userId）',
  /"userId":"u-1001"/.test(String(globalThis.localStorage.getItem(auth.SESSION_KEY))));

/* ---- 3.3 注册 ---- */
resetLog();
httpRespond = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, userId: 'u-2002' }) });
const regRes = await auth.register('bob', 'pw654321');
ok('register 命中 /api/register', httpLog[0]?.url === `${API_BASE}/api/register`);
ok('register 解析出 userId', regRes.userId === 'u-2002');

/* ---- 3.4 错误路径 ---- */
const expectErr = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

httpRespond = async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ message: 'username taken' }) });
const e409 = await expectErr(() => auth.register('bob', 'pw654321'));
ok('HTTP 409 → 友好中文「该用户名已被注册」',
  /该用户名已被注册/.test(auth.translateAuthError(e409)), auth.translateAuthError(e409));

httpRespond = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: 'bad creds' }) });
const e401 = await expectErr(() => auth.login('alice', 'wrong'));
ok('HTTP 401 → 友好中文「用户名或密码错误」',
  /用户名或密码错误/.test(auth.translateAuthError(e401)));

httpRespond = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: false, message: '账号被禁用' }) });
const eLogic = await expectErr(() => auth.login('alice', 'pw123456'));
ok('{ success: false } 被视为失败并透出后端文案',
  /账号被禁用/.test(auth.translateAuthError(eLogic)));

httpRespond = async () => { throw new Error('Failed to fetch'); };
const eNet = await expectErr(() => auth.login('alice', 'pw123456'));
ok('网络失败 → 中文「网络连接失败」',
  /网络连接失败/.test(auth.translateAuthError(eNet)), auth.translateAuthError(eNet));

httpRespond = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
const eAbort = await expectErr(() => auth.login('alice', 'pw123456'));
ok('请求超时 → 中文「请求超时」',
  /请求超时/.test(auth.translateAuthError(eAbort)));

httpRespond = async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' });
const eHtml = await expectErr(() => auth.login('alice', 'pw123456'));
ok('非 JSON 响应 → 明确报错而非崩溃',
  /无法解析/.test(auth.translateAuthError(eHtml)));

const eEmpty = await expectErr(() => auth.login('  ', 'pw123456'));
ok('空用户名在客户端就被拦下', /请输入用户名/.test(auth.translateAuthError(eEmpty)));
const eEmptyPw = await expectErr(() => auth.login('alice', ''));
ok('空密码在客户端就被拦下', /请输入密码/.test(auth.translateAuthError(eEmptyPw)));

httpRespond = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) });
const eNoId = await expectErr(() => auth.login('alice', 'pw123456'));
ok('后端没返回 userId → 明确报错', /userId/.test(auth.translateAuthError(eNoId)));

/* ---- 3.5 上报 ---- */
httpRespond = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) });
resetLog();
auth.reportRecord({ type: auth.RECORD_TYPES.FAVORITE, word: 'Chamber', domainId: 'valorant' });
await tick();
ok('登录后上报会发出请求', httpLog.length === 1 && httpLog[0].url === `${API_BASE}/api/record`, httpLog[0]?.url);
const recBody = JSON.parse(httpLog[0].init.body);
ok('上报体字段完全符合后端签名 { userId, type, word, domainId }',
  recBody.userId === 'u-1001' && recBody.type === 'favorite'
  && recBody.word === 'Chamber' && recBody.domainId === 'valorant',
  JSON.stringify(recBody));

resetLog();
auth.logout();
ok('logout 清除本地会话', auth.isSignedIn() === false && auth.loadSession() === null);
auth.reportRecord({ type: auth.RECORD_TYPES.WRONG, word: 'Chamber', domainId: 'valorant' });
await tick();
ok('未登录时上报不发请求（静默跳过）', httpLog.length === 0);

/* 上报失败绝不影响调用方 */
httpRespond = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, userId: 'u-1001' }) });
await auth.loginAndSignIn('alice', 'pw123456');
httpRespond = async () => { throw new Error('backend down'); };
resetLog();
let reportThrew = false;
try {
  await auth.reportRecord({ type: auth.RECORD_TYPES.MASTERED, word: 'Chamber', domainId: 'valorant' });
} catch (e) { reportThrew = true; }
ok('后端不可用时上报不抛错（fire-and-forget）', !reportThrew);

/* 会话损坏容错 */
globalThis.localStorage.setItem(auth.SESSION_KEY, '{坏JSON');
ok('本地会话损坏时按未登录处理，不崩溃', auth.loadSession() === null && auth.isSignedIn() === false);
globalThis.localStorage.setItem(auth.SESSION_KEY, 'raw-user-id');
ok('兼容「直接存 userId 字符串」的历史形态',
  auth.getUserId() === 'raw-user-id' && auth.isSignedIn() === true);

/* ==========================================================================
 * 四、动态：createLoginView
 * ======================================================================= */
const { createLoginView } = await import('../src/views/loginView.js');

globalThis.localStorage.clear();
httpRespond = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, userId: 'u-777' }) });

const view = createLoginView({});
/* 注意：shim 的 querySelector 只搜后代、不搜自身，因此根节点用 classList 判断 */
ok('渲染出 .auth 容器', view._cls.has('auth'));
ok('渲染出登录卡片', Boolean(view.querySelector('.auth__card')));
const tabs = view.querySelectorAll('.auth-tab');
ok('有两个标签（登录 / 注册）', tabs.length === 2, `实际 ${tabs.length}`);
ok('默认处于「登录」态', tabs[0].textContent === '登录' && tabs[0]._cls.has('is-active'));
ok('有用户名输入框', Boolean(view.querySelector('input[type="text"]')));
ok('有密码输入框', Boolean(view.querySelector('input[type="password"]')));
const submitBtn = view.querySelector('.auth__submit');
ok('有提交按钮', Boolean(submitBtn) && submitBtn.textContent === '登录');
ok('有密码可见性开关', Boolean(view.querySelector('.auth__eye')));

/* 切到「注册」 */
tabs[1].click();
ok('点「注册」标签后按钮文案变为「注册并登录」', submitBtn.textContent === '注册并登录', submitBtn.textContent);
ok('注册标签激活', tabs[1]._cls.has('is-active'));
ok('注册态密码框 autocomplete=new-password',
  view.querySelector('input[type="password"]')?.getAttribute('autocomplete') === 'new-password');

/* 提交成功 */
const fakeInputs = view.querySelectorAll('input');
const userEl = fakeInputs.find((i) => i.attributes.type === 'text');
const pwEl = fakeInputs.find((i) => i.attributes.type === 'password');
userEl.value = 'carol';
pwEl.value = 'pw000000';

let successSession = null;
const view2 = createLoginView({ onSuccess: (s) => { successSession = s; } });
const inputs2 = view2.querySelectorAll('input');
inputs2.find((i) => i.attributes.type === 'text').value = 'carol';
inputs2.find((i) => i.attributes.type === 'password').value = 'pw000000';
resetLog();
view2.querySelector('.auth__submit').click();
await tick(40);
ok('提交走 /api/login（默认登录态）', httpLog.some((r) => r.url === `${API_BASE}/api/login`), httpLog[0]?.url);
ok('成功回调收到 userId', successSession?.userId === 'u-777', JSON.stringify(successSession));
ok('成功后会话已写入 localStorage', auth.getUserId() === 'u-777');
ok('成功提示为 ok 态', view2.querySelector('.auth__msg')?._cls.has('auth__msg--ok'));

/* 提交失败 */
globalThis.localStorage.clear();
httpRespond = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: 'bad creds' }) });
let failCallbackFired = false;
const view3 = createLoginView({ onSuccess: () => { failCallbackFired = true; } });
const inputs3 = view3.querySelectorAll('input');
inputs3.find((i) => i.attributes.type === 'text').value = 'carol';
inputs3.find((i) => i.attributes.type === 'password').value = 'wrong';
view3.querySelector('.auth__submit').click();
await tick(40);
ok('失败时不触发 onSuccess', failCallbackFired === false);
ok('失败时给出中文错误提示',
  view3.querySelector('.auth__msg')?._cls.has('auth__msg--err')
  && /用户名或密码错误/.test(view3.querySelector('.auth__msg').textContent),
  view3.querySelector('.auth__msg')?.textContent);
ok('失败后按钮恢复可点（不卡在 loading）',
  view3.querySelector('.auth__submit').disabled === false);

/* ==========================================================================
 * 五、动态：homePage 顶栏
 * ======================================================================= */
globalThis.localStorage.clear();
httpRespond = async () => ({ ok: false, status: 404, text: async () => '' });

const { createHomePage } = await import('../src/pages/homePage.js');

/* 未注入 userId（Node 测试环境默认情形）→ 保持老 DOM 结构 */
const bare = await createHomePage();
ok('未注入 userId 时不渲染 .topbar__user（向后兼容）', !bare.querySelector('.topbar__user'));
ok('未注入时顶部仍为 4 个 .navtab（不破坏既有断言）',
  bare.querySelectorAll('.navtab').length === 4);

/* 注入 userId → 当前用户 + 退出按钮 */
let signedOut = 0;
const page = await createHomePage({ userId: 'u-8888', username: 'dave', onSignOut: () => { signedOut += 1; } });
const box = page.querySelector('.topbar__user');
ok('注入 userId 后顶栏出现用户区', Boolean(box));
ok('用户区文案为「当前用户：u-8888」',
  page.querySelector('.topbar__user-name')?.textContent === '当前用户：u-8888',
  page.querySelector('.topbar__user-name')?.textContent);
ok('用户区含退出登录按钮', box.querySelectorAll('button').length === 1);
ok('退出按钮 title 为「退出登录」',
  page.querySelector('.topbar__user-out')?.getAttribute('title') === '退出登录');
page.querySelector('.topbar__user-out').click();
ok('点击退出按钮触发注入的 onSignOut', signedOut === 1, `调用 ${signedOut} 次`);
ok('注入后 .navtab 仍为 4 个', page.querySelectorAll('.navtab').length === 4);

await tick(30);

/* ==========================================================================
 * 汇总
 * ======================================================================= */
console.log('\n===== verifyAuth =====');
for (const line of pass) console.log(line);
for (const line of fail) console.log(line);
if (unhandled.length) console.log(`\n⚠️ unhandledRejection: ${unhandled.length}\n${unhandled.join('\n')}`);
console.log(`\n通过 ${pass.length} / ${pass.length + fail.length}`);
if (fail.length) { console.error(`\n❌ 有 ${fail.length} 条断言失败`); process.exit(1); }
console.log('✅ 全部通过');
