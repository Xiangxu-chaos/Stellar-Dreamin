/**
 * verifyPerformance.mjs —— 性能优化回归校验（本轮增量）
 * ============================================================================
 * 对应两个线上反馈：
 *   问题一：首次打开卡在「Loading Word Bank…」很久才进去
 *   问题二：手机端切换不同游戏领域明显卡顿
 *
 * 校验分两层（全部离线，不联网）：
 *
 * 一、静态断言
 *   1. index.html：启动骨架屏（0 依赖、0 网络）+ 内联兜底脚本，且无第三方 CDN
 *   2. main.js  ：BOOT_TIMEOUT=3000、withTimeout、登录验证与词库加载各带 3s 超时、
 *                 会话超时按未登录处理、视图就绪后立刻移除骨架屏
 *   3. homePage ：PAGE_SIZE=30、MAX_RENDER_CARDS=50、renderStep 受硬上限约束、
 *                 「加载更多」增量追加、切换领域先骨架屏、loadSeq 竞态守卫、
 *                 后端用户状态同步 200ms 防抖
 *   4. 服务层   ：wordBankService 相关词内存缓存 / domainMaterialService 材料内存缓存
 *   5. 样式     ：骨架屏与分页器样式齐全（含小屏规则）
 *
 * 二、动态断言（DOM shim + 文件 fetch）
 *   1. 相关词缓存：同领域第二次调用返回同一数组（零重算）
 *   2. 材料缓存：同领域第二次读取零新增请求
 *   3. 懒渲染：首屏卡片数 = 30 且 ≤ 50；「加载更多」单批增量 ≤ 50；
 *              切换领域后回到一页；分页器存在且文案正确
 *   4. 骨架屏先行：createHomePage() 返回后（词库尚未载入）骨架屏已在 DOM 里
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
/** 剥注释再匹配，避免「注释里提到某词」造成假通过 / 假失败 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ==========================================================================
 * 一、静态断言
 * ======================================================================= */

/* ---- 1. index.html：启动骨架屏 ---- */
const html = read('index.html');
ok('index.html 存在', exists('index.html'));
ok('启动骨架屏含占位块 .sk-card', (html.match(/class="sk-card"/g) || []).length >= 3);
ok('骨架屏文案为「加载中…」（不再阻塞式 Loading Word Bank）',
  /加载中…/.test(html) && !/Loading Word Bank/.test(html));
ok('骨架屏有 #boot-hint 提示位', /id="boot-hint"/.test(html));
ok('骨架屏自带 shimmer 动画', /skeleton-shimmer/.test(html));
ok('内联启动兜底脚本（3.5s 后可重试，绝不永久卡 Loading）',
  /__bootSplashTimer/.test(html) && /boot-retry/.test(html) && /3500/.test(html));
ok('index.html 仍无任何第三方 CDN 脚本', !/<script[^>]+src="https?:\/\//.test(html));
ok('index.html 仍以 module 方式加载 main.js',
  /<script\s+type="module"\s+src="\.\/src\/main\.js"><\/script>/.test(html));

/* ---- 2. main.js：非阻塞启动 + 3 秒超时 ---- */
const main = read('src/main.js');
const mainCode = code(main);
ok('main.js 定义 3 秒启动超时常量', /BOOT_TIMEOUT\s*=\s*3000/.test(mainCode));
ok('main.js 实现 withTimeout（超时不 reject，返回 timedOut）',
  /function withTimeout\(/.test(mainCode) && /timedOut:\s*true/.test(mainCode));
ok('登录验证带 3 秒超时', /withTimeout\(resolveSession\(\),\s*BOOT_TIMEOUT/.test(mainCode));
ok('词库加载带 3 秒超时', /withTimeout\(wordBankService\.ensureLoaded\(\),\s*BOOT_TIMEOUT/.test(mainCode));
ok('词库加载不阻塞路由（先拿到 bankTask 再判会话）',
  /const bankTask = withTimeout\(/.test(mainCode)
  && mainCode.indexOf('const bankTask =') < mainCode.indexOf('resolveSession()'));
ok('会话超时按「未登录」处理并提示重试', /登录验证超时，请重试/.test(mainCode));
ok('bootstrap 一开始就确保骨架屏可见', /showSkeleton\(\)/.test(mainCode));
ok('视图就绪后立刻移除骨架屏（不等待词库）',
  /removeSplash\(\);\s*booted = true;/.test(mainCode));
ok('移除骨架屏时清掉兜底计时器', /__bootSplashTimer/.test(mainCode) && /clearTimeout\(window\.__bootSplashTimer\)/.test(mainCode));
ok('词库超时 / 失败只给可重试提示，不影响界面',
  /词库加载较慢/.test(mainCode) && /词库加载失败/.test(mainCode));

/* ---- 3. homePage：懒渲染 + 骨架屏 + 防抖 ---- */
const hp = read('src/pages/homePage.js');
const hpCode = code(hp);
ok('PAGE_SIZE = 30（首屏/每批只渲染 30 张）', /const PAGE_SIZE = 30;/.test(hpCode));
ok('MAX_RENDER_CARDS = 50（单次渲染硬上限）', /const MAX_RENDER_CARDS = 50;/.test(hpCode));
ok('renderStep() 受硬上限约束',
  /const renderStep = \(\) => Math\.min\(PAGE_SIZE, MAX_RENDER_CARDS\);/.test(hpCode));
ok('网格按 visibleCount 切片渲染',
  /Math\.min\(state\.visibleCount, state\.words\.length\)/.test(hpCode));
ok('存在「加载更多」按钮（带剩余数量）', /加载更多（还有 \$\{remain\} 个）/.test(hpCode));
ok('「加载更多」是增量追加（extendGrid / extendList），不是整表重渲染',
  /function extendGrid\(/.test(hpCode) && /function extendList\(/.test(hpCode));
ok('分页器在追加后会刷新 / 移除', /function refreshPager\(/.test(hpCode));
ok('切换领域先渲染骨架屏', /renderSkeleton\(\);/.test(hpCode));
ok('骨架屏使用领域主题色变量', /--domain-primary/.test(hpCode));
ok('骨架屏固定 6 个占位块（不耗性能）', /i < 6; i \+= 1/.test(hpCode));
ok('领域切换有竞态守卫 loadSeq', /const seq = \+\+loadSeq/.test(hpCode) && /seq !== loadSeq/.test(hpCode));
ok('切换领域向后端拉用户状态：200ms 防抖',
  /debounce\(\(domainId\) =>/.test(hpCode) && /\},\s*200\);/.test(hpCode));
ok('切换领域会重置分页到首屏', /state\.visibleCount = PAGE_SIZE;/.test(hpCode));
ok('收藏夹同样分页（favVisible）', /state\.favVisible/.test(hpCode));
ok('词库软超时 3s：超时换成可重试失败态（绝不无限停在骨架屏）',
  /const BANK_TIMEOUT = 3000;/.test(hpCode)
  && /renderBankTimeout\(\)/.test(hpCode)
  && /clearTimeout\(guard\)/.test(hpCode));
ok('homePage 仍不碰 localStorage / fetch',
  !/localStorage\s*\./.test(hpCode) && !/[^.\w]fetch\s*\(/.test(hpCode));

/* ---- 4. 服务层：内存缓存 ---- */
const wbSrc = read('src/services/wordBankService.js');
ok('wordBankService 有相关词内存缓存表 domainWordsCache',
  /const domainWordsCache = new Map\(\)/.test(wbSrc));
ok('filterByDomain 命中缓存直接复用（只在未命中时计算）',
  /let results = domainWordsCache\.get\(cacheKey\);/.test(wbSrc)
  && /results = await computeDomainWords\(/.test(wbSrc)
  && /domainWordsCache\.set\(cacheKey, results\)/.test(wbSrc));
ok('缓存键包含领域 + 词库集合（切词库不脏读）',
  /const cacheKey = `\$\{domainId\}\|\$\{banks\.join\(','\)\}`/.test(wbSrc));
ok('导出 hasDomainWordsCache / clearDomainWordsCache',
  /export function hasDomainWordsCache/.test(wbSrc) && /export function clearDomainWordsCache/.test(wbSrc));
ok('注册自定义词库 / 切换激活词库时失效缓存',
  (wbSrc.match(/clearDomainWordsCache\(\)/g) || []).length >= 3);

const dmsSrc = read('src/services/domainMaterialService.js');
ok('domainMaterialService：ensure 命中内存缓存即同步返回',
  /const cached = materialCache\.get\(domainId\);\s*\n\s*if \(cached\) return cached;/.test(dmsSrc));
ok('导出 isLoaded（同步判断是否已驻留内存）', /export function isLoaded\(/.test(dmsSrc));
ok('导出 peekMaterials（同步读取缓存，不触发 IO）', /export function peekMaterials\(/.test(dmsSrc));
ok('导出 clearCache（测试 / 手动释放）', /export function clearCache\(/.test(dmsSrc));
ok('默认导出包含缓存查询 API',
  /isLoaded,\s*\n\s+peekMaterials,\s*\n\s+peekMaterial,\s*\n\s+clearCache,/.test(dmsSrc));

/* ---- 5. 样式 ---- */
const css = read('src/styles/components.css');
ok('CSS 定义 .skeleton-grid', /\.skeleton-grid\s*\{/.test(css));
ok('CSS 定义 .skeleton-card 与占位条', /\.skeleton-card\s*\{/.test(css) && /\.skeleton-card__bar\s*\{/.test(css));
ok('CSS 定义 .card-pager / .card-pager__btn', /\.card-pager\s*\{/.test(css) && /\.card-pager__btn\s*\{/.test(css));
ok('CSS 定义 .card-flow', /\.card-flow\s*\{/.test(css));
const responsive = read('src/styles/responsive.css');
ok('小屏骨架屏改两列', /\.skeleton-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(responsive));

/* ==========================================================================
 * 二、DOM shim（参考 smokeDom.mjs）
 * ======================================================================= */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.childNodes = this.children;
    this.attributes = {};
    this.style = new Proxy(
      { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] ?? ''; } },
      { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; } },
    );
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
  click() {
    let stopped = false;
    const ev = { target: this, currentTarget: this, stopPropagation() { stopped = true; }, preventDefault() {} };
    let node = this;
    while (node) {
      ev.currentTarget = node;
      const handler = node.onclick;
      if (typeof handler === 'function') { handler(ev); if (stopped) break; }
      for (const fn of (node._ev && node._ev.click) || []) { fn(ev); if (stopped) break; }
      if (stopped) break;
      node = node.parentNode;
    }
  }
  focus() {} blur() {} scrollIntoView() {}
  querySelector(sel) { return this._find(sel, true); }
  querySelectorAll(sel) { return this._find(sel, false); }
  _find(sel, first) {
    const out = [];
    const test = (n) => {
      if (n.nodeType !== 1) return false;
      if (sel.startsWith('.')) return n._cls.has(sel.slice(1));
      if (sel.startsWith('#')) return n.attributes.id === sel.slice(1);
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
  location: { reload() {}, href: 'http://127.0.0.1:8099/' },
  scrollTo() {}, innerWidth: 1440, innerHeight: 900, localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
  // themeManager.applyTheme 在换肤动画时会用 window.setTimeout
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a),
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

/* ---- 文件 fetch：记录每个 URL 的请求次数 ---- */
const fetchCount = new Map();
globalThis.fetch = async (url) => {
  const key = String(url);
  fetchCount.set(key, (fetchCount.get(key) || 0) + 1);
  const u = key.replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404 ' + p); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};
const totalFetches = () => [...fetchCount.values()].reduce((a, b) => a + b, 0);
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 6)); };

/* ==========================================================================
 * 三、动态：相关词内存缓存
 * ======================================================================= */
const wb = await import('../src/services/wordBankService.js');
await wb.ensureLoaded();

wb.clearDomainWordsCache();
ok('清缓存后 hasDomainWordsCache 为 false', wb.hasDomainWordsCache('slay_the_spire') === false);

const r1 = await wb.filterByDomain('slay_the_spire', { limit: 600 });
const afterFirst = totalFetches();
const r2 = await wb.filterByDomain('slay_the_spire', { limit: 600 });
ok('首次筛选有结果', r1.length > 100, `${r1.length} 词`);
ok('带 limit 的两次调用结果条数一致', r2.length === r1.length, `${r1.length} / ${r2.length}`);
ok('第二次调用不再产生任何网络请求', totalFetches() === afterFirst, `${afterFirst} → ${totalFetches()}`);

/* 不传 limit 时直接返回缓存数组本体 → 用「同一引用」证明零重算 */
const full1 = await wb.filterByDomain('slay_the_spire');
const full2 = await wb.filterByDomain('slay_the_spire');
ok('同领域两次调用返回**同一个数组**（缓存复用，零重算）', full1 === full2);
ok('hasDomainWordsCache 命中', wb.hasDomainWordsCache('slay_the_spire') === true);

const r3 = await wb.filterByDomain('slay_the_spire', { limit: 5 });
ok('limit 只是在缓存结果上切片（不破坏缓存）', r3.length === 5 && r3[0] === full1[0]);
const r4 = await wb.filterByDomain('honor_of_kings');
ok('不同领域各自独立缓存', r4 !== full1 && r4.length > 0, `${r4.length} 词`);

/* ==========================================================================
 * 四、动态：领域材料内存缓存
 * ======================================================================= */
const dms = await import('../src/services/domainMaterialService.js');
ok('未载入时 isLoaded 为 false', dms.isLoaded('honor_of_kings') === false);
ok('未载入时 peekMaterials 为 null', dms.peekMaterials('honor_of_kings') === null);

const before1 = totalFetches();
const mats1 = await dms.getMaterials('honor_of_kings');
const afterFirstMat = totalFetches();
ok('首次读取领域材料有数据', Object.keys(mats1).length > 0, `${Object.keys(mats1).length} 条`);
ok('首次读取产生了 1 次材料请求', afterFirstMat - before1 === 1, `${afterFirstMat - before1} 次`);

const mats2 = await dms.getMaterials('honor_of_kings');
ok('第二次读取同一领域零新增请求（内存缓存命中）', totalFetches() === afterFirstMat, `${afterFirstMat} → ${totalFetches()}`);
ok('第二次读取内容一致', Object.keys(mats2).length === Object.keys(mats1).length);
ok('isLoaded 反映缓存状态', dms.isLoaded('honor_of_kings') === true);
ok('peekMaterials 同步返回缓存 Map（不触发 IO）', (dms.peekMaterials('honor_of_kings') || new Map()).size > 0);

const m1 = await dms.getMaterial('honor_of_kings', 'lane');
ok('同领域单条查询同样零新增请求', totalFetches() === afterFirstMat);
ok('单条材料可命中', Boolean(m1 && m1.word === 'lane'));

/* ==========================================================================
 * 五、动态：懒渲染（homePage）
 * ======================================================================= */
/* 预置「我的库」与当前领域，跳过首次引导弹窗 */
store.set('wb:cet6:userDomains', JSON.stringify({ __v: 1, data: ['slay_the_spire', 'hollow_knight'] }));
store.set('wb:cet6:ui', JSON.stringify({ __v: 1, data: { domainId: 'slay_the_spire', view: 'grid', sortBy: 'relevance', filterLevel: 'all' } }));

const { createHomePage } = await import('../src/pages/homePage.js');
const root = await createHomePage();
body.appendChild(root);

/* 骨架屏先行：此刻词库还没载入完，但骨架屏已经在 DOM 里 */
ok('createHomePage() 返回时立即有骨架屏（不空等词库）',
  root.querySelectorAll('.skeleton-card').length === 6,
  `${root.querySelectorAll('.skeleton-card').length} 块`);
ok('骨架屏含「正在载入领域数据…」提示',
  /正在载入领域数据/.test(root.querySelector('.loading-head')?.textContent || ''));

await flush(220);

const st = () => root.__debug.state;
ok('自动恢复到「我的库」里的领域', st().domainId === 'slay_the_spire', String(st().domainId));
ok('筛选出相关词', st().matchCount > 100, `${st().matchCount} 词`);
ok('暴露性能参数 pageSize=30 / maxRenderCards=50',
  st().pageSize === 30 && st().maxRenderCards === 50, `${st().pageSize} / ${st().maxRenderCards}`);

const cardsNow = () => root.querySelectorAll('.wordcard').length;
const firstPage = cardsNow();
ok('首屏只渲染一页（30 张）', firstPage === 30, `${firstPage} 张`);
ok('首屏渲染量 ≤ 单次硬上限 50', firstPage <= st().maxRenderCards);
ok('首屏未渲染全部相关词（懒渲染生效）', firstPage < st().matchCount, `${firstPage} / ${st().matchCount}`);

const pager = root.querySelector('.card-pager');
ok('存在「加载更多」分页器', Boolean(pager));
ok('分页器文案显示剩余数量', /加载更多（还有 \d+ 个）/.test(pager?.textContent || ''), pager?.textContent);
ok('分页器提示「已显示 30 / N 张」', /已显示 30 \//.test(pager?.textContent || ''), pager?.textContent);

/* 点击「加载更多」→ 单批增量必须 ≤ 50 */
const before2 = cardsNow();
root.querySelector('.card-pager__btn').click();
await flush(20);
const after2 = cardsNow();
ok('「加载更多」有新增卡片', after2 > before2, `${before2} → ${after2}`);
ok('「加载更多」单批增量 ≤ 50（不允许一次性渲染超过 50 张）',
  after2 - before2 <= st().maxRenderCards, `+${after2 - before2}`);
ok('「加载更多」是追加而非重渲染（原卡片仍在）', after2 === before2 + st().pageSize, `${after2}`);

/* 切换领域 → 分页重置 + 重新骨架屏 + 结果正确 */
const hkCard = root.querySelectorAll('.domain-card').find((c) => c.textContent.includes('空洞骑士'));
ok('领域网格里有第二个领域可切', Boolean(hkCard));
hkCard.click();
await flush(400);
ok('切换领域后分页重置为一页（30 张）', cardsNow() === 30, `${cardsNow()} 张`);
ok('切换领域后仍是新领域的数据', st().domainId === 'hollow_knight', String(st().domainId));
ok('切换领域后分页器仍在（词很多）', Boolean(root.querySelector('.card-pager')));

/* 切回原领域 —— 走内存缓存，应仍然正常且无需重新请求词库 */
const spireCard = root.querySelectorAll('.domain-card').find((c) => c.textContent.includes('杀戮尖塔'));
spireCard.click();
await flush(400);
ok('切回原领域正常渲染', st().domainId === 'slay_the_spire' && cardsNow() === 30, `${cardsNow()} 张`);
ok('切回原领域命中相关词缓存', wb.hasDomainWordsCache('slay_the_spire') === true);

/* 列表视图同样分页 */
const listBtn = root.querySelectorAll('.seg__btn').find((b) => b.textContent.includes('列表'));
listBtn.click();
await flush(40);
const rows = root.querySelectorAll('.row').length;
ok('列表视图同样只渲染一页（≤ 50 行）', rows > 0 && rows <= st().maxRenderCards, `${rows} 行`);

ok('过程中没有未捕获的 Promise 拒绝', unhandled.length === 0, unhandled.slice(0, 2).join(' | '));

/* ---------------- 输出 ---------------- */
console.log('=========== 性能优化校验（启动非阻塞 + 领域切换流畅度）===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
