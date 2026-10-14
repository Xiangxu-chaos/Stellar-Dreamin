/**
 * verifyAuth.mjs —— CloudBase 认证接入回归校验（匿名登录 + 无登录页路由）
 * ============================================================================
 * 背景：认证方案已从 Supabase 换成腾讯云 CloudBase（国内节点，无需代理）。
 *
 * 本脚本不联网，分两层：
 *
 *   一、静态校验
 *     1. core/cloudbaseClient.js：环境 ID、SDK 取用方式（window.cloudbase 全局）、
 *        init/auth 参数、对外导出的认证函数、匿名登录调用、中文错误文案、
 *        **尚未**触碰业务数据集合（数据层迁移是下一阶段）。
 *     2. index.html：引入 CloudBase SDK（国内 CDN + defer）。
 *     3. main.js：无登录页，改为启动时匿名自动登录；失败降级不白屏。
 *     4. pages/homePage.js：只接收注入的 user/authError，**不 import** cloudbaseClient；
 *        顶栏为「游客」/「离线」，且**没有**退出登录按钮。
 *     5. CSS / 目录：Supabase 时代的登录页样式与文件已清干净。
 *     6. 全项目 src/ 与 index.html 不再出现 supabase。
 *
 *   二、动态渲染（DOM shim + 假 SDK）
 *     1. cloudbaseClient：用假 window.cloudbase 跑通
 *        「首次匿名登录 / 复用本地登录态 / 未开启匿名登录 / 网络失败 / SDK 未加载」五条路径。
 *     2. createHomePage()：未注入 → 无用户区；注入 user → 「游客」无按钮；
 *        注入 authError → 「离线」；三种情况下 .navtab 恒为 4 个。
 * ============================================================================
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));

/** 递归收集 src/ 下所有文件（相对 ROOT 的 posix 路径） */
function walk(relDir) {
  const out = [];
  const step = (rel) => {
    for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const next = path.posix.join(rel, e.name);
      if (e.isDirectory()) step(next); else out.push(next);
    }
  };
  step(relDir);
  return out;
}

const ENV_ID = 'stellar-dreamin-d2f2vgn912ba7454';

/* ==========================================================================
 * 一、静态校验
 * ======================================================================= */

/* ---- 1. cloudbaseClient.js ---- */
ok('src/core/cloudbaseClient.js 存在', exists('src/core/cloudbaseClient.js'));
const cbSrc = read('src/core/cloudbaseClient.js');

ok('填入 CloudBase 环境 ID', cbSrc.includes(`'${ENV_ID}'`));
ok('从全局 window.cloudbase 取用 SDK（不做 import）',
  /window\[SDK_GLOBAL\]/.test(cbSrc) && !/^\s*import[\s\S]*cloudbase\.full/m.test(cbSrc));
ok('SDK 全局名声明为 cloudbase', /SDK_GLOBAL\s*=\s*'cloudbase'/.test(cbSrc));
ok('用 sdk.init({ env }) 初始化', /sdk\.init\(\s*\{\s*env:\s*ENV_ID\s*\}\s*\)/.test(cbSrc));
ok('通过 app.auth() 创建认证实例', /app\.auth\(\s*\{\s*persistence:\s*'local'\s*\}\s*\)/.test(cbSrc));
ok('调用 signInAnonymously() 匿名登录', /signInAnonymously\s*\(\s*\)/.test(cbSrc));
ok('先读本地登录态，避免刷新时重复创建匿名用户', /getLoginState/.test(cbSrc));
ok('登录 Promise 做了缓存（并发/重复调用只登录一次）', /signInPromise/.test(cbSrc));
ok('初始化失败后允许重试（清空缓存）', /appPromise\s*=\s*null/.test(cbSrc));
ok('会话持久化到 localStorage（刷新免登录）', /persistence:\s*'local'/.test(cbSrc));

for (const fn of ['getApp', 'getAuth', 'ensureSignedIn', 'getCurrentUser', 'signOut', 'isReady', 'translateAuthError']) {
  ok(`导出认证函数 ${fn}`,
    new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`).test(cbSrc)
    || new RegExp(`export\\s+const\\s+${fn}\\b`).test(cbSrc));
}

/* 错误文案：必须能引导用户去控制台开匿名登录 */
ok('英文/结构化报错已翻译为中文', /translateAuthError/.test(cbSrc));
ok('专门识别 PROVIDER_NOT_ENABLED（未开启匿名登录）', /PROVIDER_NOT_ENABLED|provider_not_enabled/.test(cbSrc));
ok('给出「去控制台开启匿名登录」的指引', /登录授权/.test(cbSrc) && /匿名登录/.test(cbSrc));
ok('网络类报错有中文文案', /网络连接失败/.test(cbSrc));

/* 迁移阶段之前，认证层不应触碰业务数据集合 */
const cbCode = cbSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('本阶段未读写业务数据集合（不出现 .collection(...)）', !/\.collection\s*\(/.test(cbCode));
ok('cloudbaseClient 不渲染 UI（不 import components / pages）',
  !/from\s*'\.\.\/(components|pages)\//.test(cbSrc));

/* ---- 2. index.html ---- */
const html = read('index.html');
ok('index.html 引入 CloudBase SDK',
  /<script[^>]+static\.cloudbase\.net\/cloudbase-js-sdk\/latest\/cloudbase\.full\.js/.test(html));
ok('SDK 脚本带 defer（不阻塞首屏）', /<script[^>]*defer[^>]*cloudbase\.full\.js/.test(html));
ok('不再使用 imgcache.qq.com 那条失效地址', !/imgcache\.qq\.com/.test(html));
ok('index.html 无 supabase 残留', !/supabase/i.test(html));

/* ---- 3. main.js 路由 ---- */
const main = read('src/main.js');
ok('main.js 引入 cloudbaseClient 的 ensureSignedIn',
  /import\s*\{[^}]*ensureSignedIn[^}]*\}\s*from\s*'\.\/core\/cloudbaseClient\.js'/.test(main));
ok('main.js 不再引入登录页', !/createLoginView/.test(main) && !/views\/loginView/.test(main));
ok('main.js 不再引入 supabaseClient', !/supabaseClient/.test(main));
ok('启动即匿名自动登录', /await\s+ensureSignedIn\s*\(\s*\)/.test(main));
ok('登录成功后直接渲染主界面', /await\s+showApp\(/.test(main));
ok('main.js 把 user 注入 homePage', /createHomePage\(\s*\{\s*user/.test(main));
ok('main.js 把 authError 注入 homePage', /authError/.test(main));
ok('认证失败不阻断渲染（降级而非白屏）',
  /try\s*\{[\s\S]*?ensureSignedIn[\s\S]*?\}\s*catch/.test(main)
  && !/else\s+showLogin/.test(main));
ok('离线时给出用户可见提示', /showToast\(/.test(main));

/* ---- 4. homePage 不依赖 CloudBase（保持 Node 测试可跑） ---- */
const hp = read('src/pages/homePage.js');
const hpCode = hp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/* 注意：先剥掉注释再匹配，否则注释里「本页不 import cloudbaseClient」这句会误伤 */
ok('homePage 不 import cloudbaseClient', !/cloudbaseClient/.test(hpCode));
ok('homePage 不 import supabaseClient', !/supabaseClient/.test(hp));
ok('homePage 接收 user / authError 选项',
  /const\s*\{\s*user\s*=\s*null,\s*authError\s*=\s*''\s*\}\s*=\s*options/.test(hp));
ok('homePage 已移除 onSignOut', !/onSignOut/.test(hp));
ok('homePage 渲染顶栏用户区 .topbar__user', /topbar__user/.test(hp));
ok('顶栏显示「游客」', /游客/.test(hp));
ok('顶栏有「离线」状态', /离线/.test(hp) && /topbar__user--offline/.test(hp));
ok('已移除退出登录按钮', !/退出登录/.test(hp) && !/iconPath\(\s*'logout'\s*\)/.test(hp));
ok('homePage 仍在分层边界内（不碰 localStorage）', !/localStorage\s*\./.test(hpCode));

/* ---- 5. CSS ---- */
const css = read('src/styles/components.css');
for (const cls of ['topbar__user', 'topbar__user-mail', 'topbar__user--offline']) {
  ok(`CSS 定义 .${cls}`, new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}\\b`).test(css));
}
ok('CSS 已清掉登录页样式（.auth / .auth__card / .auth-tab）',
  !/\.auth\s*\{/.test(css) && !/\.auth__card/.test(css) && !/\.auth-tab/.test(css));
const responsive = read('src/styles/responsive.css');
ok('响应式样式已清掉 .auth', !/\.auth\s*\{/.test(responsive) && !/\.auth__card/.test(responsive));
ok('小屏保留状态文字（不隐藏 .topbar__user-mail）',
  !/\.topbar__user-mail\s*\{\s*display:\s*none/.test(responsive));

/* ---- 6. 全项目 Supabase 残留 ---- */
const removed = [
  'src/core/supabaseClient.js',
  'src/views/loginView.js',
  'sql/01_init_schema.sql',
];
for (const f of removed) ok(`已删除 ${f}`, !exists(f));
ok('src/views 目录已移除', !exists('src/views'));

const srcFiles = walk('src');
const supabaseHits = srcFiles.filter((f) => /supabase/i.test(read(f)));
ok('src/ 下无任何 supabase 残留', supabaseHits.length === 0, supabaseHits.join(', '));
ok('src/ 下无 esm.sh 残留', !srcFiles.some((f) => /esm\.sh/.test(read(f))));
ok('index.html 已不再引用任何 CDN 上的 supabase', !/supabase/i.test(read('index.html')));

/* ==========================================================================
 * 二、DOM shim（参考 smokeDom.mjs）
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
  location: { reload() {}, href: 'http://127.0.0.1:8777/', origin: 'http://127.0.0.1:8777', pathname: '/' },
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
/* 词库 JSON 取不到也无所谓：本脚本只关心顶栏结构，不关心卡片数据 */
globalThis.fetch = async () => ({ ok: false, status: 404, async json() { throw new Error('404'); }, async text() { return ''; } });

const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(String(e)));

/* ==========================================================================
 * 三、动态：假 CloudBase SDK，跑通认证各条路径
 * ======================================================================= */

/** 记录 SDK 收到的参数与调用次数 */
const sdkCalls = { initCfg: null, authOpts: null, signInCalls: 0 };
/** 每个场景通过它改写假 auth 的行为 */
let behavior = { loginState: null, signIn: async () => ({ user: { uid: 'anon-1' } }) };

const fakeAuth = {
  async getLoginState() { return behavior.loginState; },
  async signInAnonymously() { sdkCalls.signInCalls += 1; return behavior.signIn(); },
  async signOut() { /* noop */ },
};
globalThis.window.cloudbase = {
  init(cfg) {
    sdkCalls.initCfg = cfg;
    return { auth(opts) { sdkCalls.authOpts = opts; return fakeAuth; } };
  },
};
const setBehavior = (b) => { behavior = b; };

/* ---- 场景 1：首次进入 → 匿名登录 ---- */
const cb = await import('../src/core/cloudbaseClient.js');
const r1 = await cb.ensureSignedIn();
ok('init 收到正确的环境 ID', sdkCalls.initCfg?.env === ENV_ID, JSON.stringify(sdkCalls.initCfg));
ok('auth 显式声明 persistence: local', sdkCalls.authOpts?.persistence === 'local');
ok('首次进入返回 isNew = true', r1.isNew === true);
ok('拿到了匿名用户对象', r1.user?.uid === 'anon-1');
ok('确实调用了 signInAnonymously 1 次', sdkCalls.signInCalls === 1);

const r1b = await cb.ensureSignedIn();
ok('再次调用复用同一结果（幂等，不新建匿名用户）',
  r1b === r1 && sdkCalls.signInCalls === 1);

/* ---- 场景 2：刷新页面（本地已有登录态）→ 复用，不重复登录 ---- */
setBehavior({ loginState: { user: { uid: 'anon-9' } }, signIn: async () => { throw new Error('不该被调用'); } });
const cbReuse = await import('../src/core/cloudbaseClient.js?reuse=1');
const r2 = await cbReuse.ensureSignedIn();
ok('本地已有登录态时 isNew = false', r2.isNew === false);
ok('复用已有匿名用户 id', r2.user?.uid === 'anon-9');

/* ---- 场景 3：控制台没开匿名登录 → 中文指引 ---- */
setBehavior({
  loginState: null,
  signIn: async () => { const e = new Error('provider disabled'); e.category = 'PROVIDER_NOT_ENABLED'; throw e; },
});
const cbProvider = await import('../src/core/cloudbaseClient.js?provider=1');
let providerMsg = '';
try { await cbProvider.ensureSignedIn(); } catch (e) { providerMsg = e.message; }
ok('未开启匿名登录 → 提示去控制台开启', /匿名登录未开启/.test(providerMsg), providerMsg);
ok('提示里点明「登录授权」入口', /登录授权/.test(providerMsg));

/* ---- 场景 4：网络不可达 → 中文提示且不抛原始英文 ---- */
setBehavior({ loginState: null, signIn: async () => { throw new Error('Failed to fetch'); } });
const cbNet = await import('../src/core/cloudbaseClient.js?net=1');
let netMsg = '';
try { await cbNet.ensureSignedIn(); } catch (e) { netMsg = e.message; }
ok('网络失败 → 可读中文提示', /网络连接失败/.test(netMsg), netMsg);

/* ---- 场景 5：SDK 脚本根本没加载 ---- */
const savedSdk = globalThis.window.cloudbase;
delete globalThis.window.cloudbase;
const cbNoSdk = await import('../src/core/cloudbaseClient.js?nosdk=1');
let sdkMsg = '';
try { await cbNoSdk.waitForSdk(150); } catch (e) { sdkMsg = e.message; }
ok('SDK 未加载 → 明确指向 index.html 的 script 标签',
  /SDK 未加载/.test(sdkMsg) && /index\.html/.test(sdkMsg), sdkMsg);
let noSdkLoginMsg = '';
try { await cbNoSdk.ensureSignedIn(); } catch (e) { noSdkLoginMsg = e.message; }
ok('SDK 未加载时匿名登录也给出可读错误（不是 TypeError）',
  /SDK 未加载/.test(noSdkLoginMsg), noSdkLoginMsg);
globalThis.window.cloudbase = savedSdk;

/* ---- translateAuthError 纯函数 ---- */
ok('translateAuthError 空输入不炸', typeof cb.translateAuthError(null) === 'string');
ok('translateAuthError 未开启匿名登录',
  /匿名登录未开启/.test(cb.translateAuthError({ category: 'PROVIDER_NOT_ENABLED' })));
ok('translateAuthError 网络错误',
  /网络连接失败/.test(cb.translateAuthError(new Error('NetworkError'))));
ok('translateAuthError 保留未知错误原文',
  cb.translateAuthError(new Error('something weird')).includes('something weird'));

/* ==========================================================================
 * 四、动态：homePage 顶栏三态
 * ======================================================================= */
const { createHomePage } = await import('../src/pages/homePage.js');

/* 未注入认证信息（Node 测试环境的默认情形） */
const bare = await createHomePage();
ok('未注入认证信息时不渲染 .topbar__user（向后兼容）', !bare.querySelector('.topbar__user'));
ok('未注入时顶部仍为 4 个 .navtab（不破坏既有断言）',
  bare.querySelectorAll('.navtab').length === 4);

/* 匿名登录成功 → 「游客」 */
const anon = await createHomePage({ user: { uid: 'anon-123' }, authError: '' });
const anonBox = anon.querySelector('.topbar__user');
ok('匿名登录后顶栏出现用户区', Boolean(anonBox));
ok('用户区文案为「游客」', anon.querySelector('.topbar__user-mail')?.textContent === '游客');
ok('用户区 title 带匿名用户 id', /anon-123/.test(anonBox?.getAttribute('title') || ''));
ok('用户区不含任何按钮（退出登录已移除）',
  anonBox && anonBox.querySelectorAll('button').length === 0);
ok('用户区不是离线态', !anonBox?._cls.has('topbar__user--offline'));
ok('匿名登录后 .navtab 仍为 4 个', anon.querySelectorAll('.navtab').length === 4);

/* 认证失败 → 「离线」+ 原因 */
const offline = await createHomePage({ user: null, authError: '网络连接失败，无法访问 CloudBase。' });
const offBox = offline.querySelector('.topbar__user--offline');
ok('认证失败时顶栏显示离线态', Boolean(offBox));
ok('离线文案为「离线」', offline.querySelector('.topbar__user-mail')?.textContent === '离线');
ok('离线 title 带失败原因', /网络连接失败/.test(offBox?.getAttribute('title') || ''));
ok('离线态下 .navtab 仍为 4 个', offline.querySelectorAll('.navtab').length === 4);

await new Promise((r) => setTimeout(r, 30));

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
