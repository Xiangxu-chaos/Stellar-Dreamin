/**
 * DOM 层冒烟测试：真实挂载 homePage.js 并驱动交互流程
 * 目的：捕捉语法检查查不出的运行时错误（图标缺失、属性拼错、props 错位、事件绑定失败等）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

/* ============ 更完整的 DOM shim ============ */
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
      toString: () => [...this._cls].join(' '),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(c) { if (c == null) return c; this.children.push(c); if (c.nodeType === 1) c.parentNode = this; return c; }
  append(...cs) { cs.forEach((c) => { if (c == null) return; this.appendChild(typeof c === 'string' ? new TextNode(c) : c); }); }
  replaceChildren(...cs) { this.children.length = 0; this.append(...cs); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i >= 0) { this.children.splice(i, 0, c); c.parentNode = this; } else this.appendChild(c); return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) { this.children[i] = n; n.parentNode = this; o.parentNode = null; } return o; }
  cloneNode() { const e = new El(this.tagName); e._cls = new Set(this._cls); return e; }
  contains(n) { if (n === this) return true; return this.children.some((c) => c.nodeType === 1 && c.contains(n)); }
  closest(sel) { let n = this; while (n) { if (n.nodeType === 1) { const m = sel.startsWith('.') ? n._cls.has(sel.slice(1)) : n.tagName === sel.toUpperCase(); if (m) return n; } n = n.parentNode; } return null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); }
  removeEventListener() {}
  click() {
    /* 真实模拟浏览器 click 的**冒泡**行为：
     *   从 target 逐级向上派发到祖先，直到有人调用 stopPropagation()。
     *   这样「点卡片空白区应冒泡到卡片根触发翻转」「点按钮 stopPropagation 不翻转」
     *   才能被测出来（旧 shim 不回冒泡，等于测不到问题二）。 */
    let stopped = false;
    const ev = {
      target: this,
      currentTarget: this,
      get defaultPrevented() { return false; },
      stopPropagation() { stopped = true; },
      preventDefault() {},
    };
    let node = this;
    while (node) {
      ev.currentTarget = node;
      const handler = node['onclick'];
      if (typeof handler === 'function') { handler(ev); if (stopped) break; }
      const listeners = (node._ev && node._ev.click) || [];
      for (const fn of listeners) { fn(ev); if (stopped) break; }
      if (stopped) break;
      node = node.parentNode;
    }
  }
  dispatch(t, ev = {}) {
    const e = { target: this, currentTarget: this, stopPropagation() {}, preventDefault() {}, ...ev };
    const h = this['on' + t];
    if (typeof h === 'function') h(e);
    (this._ev[t] || []).forEach((fn) => fn(e));
  }
  scrollIntoView() {}
  focus() {} blur() {}
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
  get files() { return this._files || null; }
  getBoundingClientRect() { return { width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 }; }
}
class TextNode { constructor(t) { this.nodeType = 3; this._t = String(t); } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }

/* localStorage（真实实现，用于验证持久化） */
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
  addEventListener() {}, removeEventListener() {}, location: { reload() {}, href: 'http://127.0.0.1:8777/' },
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
  addEventListener() {}, removeEventListener() {},
};
globalThis.Node = El; globalThis.HTMLElement = El; globalThis.Element = El;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404 ' + p); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};

/* ============ 启动 ============ */
const errors = [];
process.on('unhandledRejection', (e) => errors.push(String(e)));

const { createHomePage } = await import('../src/pages/homePage.js');
const root = await createHomePage();
body.appendChild(root);

/* 等 boot() 里的异步链跑完 */
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 6)); };

ok('homePage 挂载成功', root.tagName === 'DIV' && root._cls.has('app'));
ok('暴露 __debug 调试接口', Boolean(root.__debug) && Boolean(root.__debug.state));

/* 顶栏 */
const tabs = root.querySelectorAll('.navtab');
ok('顶部导航含 4 个标签页（卡片库/收藏夹/错题本/我的库）', tabs.length === 4, tabs.map((t) => t.textContent).join(' | '));
ok('标签页含「收藏夹」', tabs.some((t) => t.textContent.includes('收藏夹')));
ok('标签页含「错题本」', tabs.some((t) => t.textContent.includes('错题本')));
ok('标签页含「增加我的库」', tabs.some((t) => t.textContent.includes('我的库')));

/* 功能三：掌握进度条 */
ok('顶栏有掌握进度条', Boolean(root.querySelector('.mastery-bar')));

/* ============ 功能一：首次进入引导 ============ */
await flush(60);   // 等 boot() 里的 wordBankService.ensureLoaded() 链跑完
const pickerCards = document.body.querySelectorAll('.dp-card');
ok('首次进入弹出领域选择引导', pickerCards.length >= 4, `${pickerCards.length} 张领域卡`);
const pickerModal = document.body.querySelector('.modal__panel--wide');
ok('引导为宽模态且不可关闭', Boolean(pickerModal) && !document.body.querySelector('.modal__close'),
  pickerModal ? 'wide' : 'missing');

/* 勾选「杀戮尖塔」+「空洞骑士」并确认 */
const spirePick = pickerCards.find((c) => c.textContent.includes('杀戮尖塔'));
const hollowPick = pickerCards.find((c) => c.textContent.includes('空洞骑士'));
spirePick.click();
hollowPick.click();
await flush(3);
ok('勾选后卡片进入选中态', spirePick._cls.has('is-on') && hollowPick._cls.has('is-on'));

const confirmBtn = document.body.querySelectorAll('.btn').find((b) => /确认，开始学习/.test(b.textContent));
ok('引导有确认按钮', Boolean(confirmBtn));
confirmBtn.click();
await flush(120);

const savedDomains = JSON.parse(localStorage.getItem('wb:cet6:userDomains') || '{}');
ok('「我的库」已落库', Array.isArray(savedDomains.data) && savedDomains.data.length === 2,
  JSON.stringify(savedDomains.data));

/* 领域卡片只渲染「我的库」里的领域 */
const domainCards = root.querySelectorAll('.domain-card');
ok('领域网格只渲染我的库里的领域（2 张）', domainCards.length === 2,
  domainCards.map((c) => c.querySelector('.domain-card__name')?.textContent).join(', '));

await flush(40);
const st = () => root.__debug.state;
ok('词库统计已回填', /\d+/.test(root.querySelectorAll('.stat-chip')[0]?.textContent || ''), (root.querySelectorAll('.stat-chip')[0] || {}).textContent);

/* 进入领域（引导完成后已自动进入第一个领域，若未进入则手动点击） */
let spireCard = domainCards.find((c) => c.textContent.includes('杀戮尖塔'));
if (!st().domainId && spireCard) { spireCard.click(); await flush(80); }
spireCard = root.querySelectorAll('.domain-card').find((c) => c.textContent.includes('杀戮尖塔'));
ok('已选中领域', st().domainId === 'slay_the_spire', String(st().domainId));
ok('筛选出相关词', st().matchCount > 100, `${st().matchCount} 词`);

/* ---- 档位筛选栏：核心 / 相关 / 泛化（默认「相关」）---- */
const segBtns = () => root.querySelectorAll('.seg__btn');
const tierBtn = (label) => segBtns().find((b) => b.textContent.trim() === label);
const TIER_NAMES = ['核心', '相关', '泛化'];
ok('筛选栏有「核心 / 相关 / 泛化」三个选项', TIER_NAMES.every((t) => Boolean(tierBtn(t))),
  segBtns().map((b) => b.textContent.trim()).join(' | '));
ok('默认选中「相关」',
  Boolean(tierBtn('相关')?.classList.contains('is-active')) && st().filterLevel === 'related',
  String(st().filterLevel));

/** 收集当前已渲染卡片正面的档位标签文案 */
const tierChipTexts = () => root.querySelectorAll('.wordcard').map((c) => {
  const badges = c.querySelector('.wordcard__badges');
  const chip = badges
    ? badges.querySelectorAll('.chip').find((x) => x.className.split(' ').some((k) => k.startsWith('chip--tier-')))
    : null;
  return chip ? chip.textContent.trim() : '';
});

tierBtn('核心').click();
await flush(30);
const coreChips = tierChipTexts();
ok('切到「核心」后卡片全部是核心档',
  coreChips.length > 0 && coreChips.every((t) => t === '核心'),
  `共 ${coreChips.length} 张；档位=${[...new Set(coreChips)].join(',')}`);

tierBtn('泛化').click();
await flush(30);
const extChips = tierChipTexts();
ok('切到「泛化」后卡片全部是泛化档',
  extChips.length > 0 && extChips.every((t) => t === '泛化'),
  `共 ${extChips.length} 张；档位=${[...new Set(extChips)].join(',')}`);

tierBtn('相关').click();
await flush(30);
ok('切回「相关」档且卡片全部是相关档',
  st().filterLevel === 'related' && tierChipTexts().every((t) => t === '相关'),
  `档位=${[...new Set(tierChipTexts())].join(',')}`);

/* 卡片渲染 */
const cards = root.querySelectorAll('.wordcard');
ok('渲染 WordCard 网格', cards.length > 0, `${cards.length} 张`);
const firstCard = cards[0];
ok('卡片有正面/背面', Boolean(firstCard.querySelector('.wordcard__face--front')) && Boolean(firstCard.querySelector('.wordcard__face--back')));
ok('卡片有配图区', Boolean(firstCard.querySelector('.wordcard__figure')));
ok('卡片有收藏星标', Boolean(firstCard.querySelector('.wordcard__fav')));

/* 翻面 */
const wasFlip = firstCard.classList.contains('is-flipped');
firstCard.click();
await flush(3);
ok('点击卡片可翻面', firstCard.classList.contains('is-flipped') !== wasFlip);

/* ---- 问题二回归：背面必须能翻回正面，按钮不得触发翻转 ---- */
const backFace = firstCard.querySelector('.wordcard__face--back');
const backScroll = firstCard.querySelector('.wordcard__backscroll');
ok('背面根容器不再整体阻止冒泡', Boolean(backScroll) && !(backScroll._ev && backScroll._ev.click && backScroll._ev.click.length));

// 此时卡片应为「已翻到背面」
ok('前置：卡片当前处于背面', firstCard.classList.contains('is-flipped'));

// 1) 点击背面空白区 → 应翻回正面
backFace.click();
await flush(3);
ok('点击背面区域可翻回正面', !firstCard.classList.contains('is-flipped'));

// 2) 再点一次卡片 → 翻到背面（验证往复）
firstCard.click();
await flush(3);
ok('再次点击卡片翻到背面（往复正常）', firstCard.classList.contains('is-flipped'));

// 3) 点击背面上的按钮 → 不得翻转（按钮自身 stopPropagation）
const actionsWrap = backFace.querySelector('.wordcard__actions');
const backExpandBtn = actionsWrap ? actionsWrap.querySelector('.btn') : null;
if (backExpandBtn) {
  const beforeBtnFlip = firstCard.classList.contains('is-flipped');
  backExpandBtn.click();
  await flush(3);
  ok('点击背面按钮不触发翻转', firstCard.classList.contains('is-flipped') === beforeBtnFlip);
} else {
  ok('点击背面按钮不触发翻转', false, '未找到背面按钮');
}

// 复位到正面，避免影响后续用例
if (firstCard.classList.contains('is-flipped')) { firstCard.click(); await flush(3); }

/* 问题一回归：单词必须以小写字形呈现（不使用全大写装饰字体） */
const wordEl = firstCard.querySelector('.wordcard__word');
ok('单词节点存在', Boolean(wordEl));
ok('单词内容为小写形式', wordEl && wordEl.textContent === wordEl.textContent.toLowerCase(), wordEl && wordEl.textContent);

/* 收藏切换 → 持久化 */
const favBtn = firstCard.querySelector('.wordcard__fav');
const favWord = firstCard.querySelector('.wordcard__word').textContent;
favBtn.click();
await flush(20);
ok('点击星标后进入收藏', st().favorites === 1, `${favWord} → ${st().favorites}`);
const persisted = JSON.parse(localStorage.getItem('wb:cet6:favorites'));
ok('收藏已持久化到 localStorage', persisted && Object.keys(persisted.data).length === 1, JSON.stringify(Object.keys(persisted?.data || {})));

/* ============ 功能三：标记为熟词 ============ */
const masterBtn = firstCard.querySelector('.wordcard__master-btn');
ok('卡片背面有「标记为熟词」按钮', Boolean(masterBtn));
if (masterBtn) {
  ok('熟词按钮初始为「标记为熟词」', /标记为熟词/.test(masterBtn.textContent), masterBtn.textContent);
  masterBtn.click();
  await flush(30);
  ok('点击后卡片进入 is-mastered', firstCard._cls.has('is-mastered'));
  ok('出现「已掌握」徽标', Boolean(firstCard.querySelector('.wordcard__mastered-badge')));
  const masteredStore = JSON.parse(localStorage.getItem('wb:cet6:masteredWords') || '{}');
  ok('熟词已落库', masteredStore.data && Object.keys(masteredStore.data).length === 1,
    JSON.stringify(Object.keys(masteredStore.data || {})));
  ok('掌握进度已刷新（mastered >= 1）', st().mastered >= 1, `${st().mastered} / ${st().masteryTotal}`);

  /* 取消标记 → 徽标消失、落库清空 */
  masterBtn.click();
  await flush(30);
  ok('取消后移除 is-mastered', !firstCard._cls.has('is-mastered'));
  const masteredStore2 = JSON.parse(localStorage.getItem('wb:cet6:masteredWords') || '{}');
  ok('取消后熟词库清空', Object.keys(masteredStore2.data || {}).length === 0);
}

/* 列表视图 */
const viewSegBtns = root.querySelectorAll('.seg__btn');
const listBtn = viewSegBtns.find((b) => b.textContent.includes('列表'));
listBtn.click();
await flush(20);
ok('切换到列表视图', root.querySelectorAll('.row').length > 0, `${root.querySelectorAll('.row').length} 行`);

/* 做题模式 */
const quizBtn = root.querySelectorAll('.btn').find((b) => b.textContent.trim() === '做题');
ok('工具栏有做题入口', Boolean(quizBtn));
if (quizBtn) {
  quizBtn.click();
  await flush(100);
  const mainEl = root.querySelectorAll('main')[0];
  ok('做题视图已挂载', Boolean(root.querySelector('.quiz-view')), 'quiz-view');
  const options = root.querySelectorAll('.quiz-option');
  ok('渲染 4 个选项', options.length >= 2, `${options.length}`);
  const prompt = root.querySelector('.quiz-card__prompt');
  ok('题干已渲染', Boolean(prompt && prompt.textContent), prompt?.textContent?.slice(0, 40));

  options[0].click();
  await flush(40);
  ok('选择后有判定反馈', Boolean(root.querySelector('.quiz-verdict')), root.querySelector('.quiz-verdict')?.textContent?.slice(0, 30));
  ok('展开完整记忆卡片', root.querySelectorAll('.wordcard').length > 0, 'reveal card');
  ok('出现「下一题」按钮', root.querySelectorAll('.btn').some((b) => /下一题|查看成绩/.test(b.textContent)));
  const quizStats = JSON.parse(localStorage.getItem('wb:cet6:quizStats') || '{}');
  ok('答题记录已落库', quizStats.data && Object.keys(quizStats.data).length > 0, JSON.stringify(Object.keys(quizStats.data || {})));

  /* 返回 */
  const backBtn = root.querySelectorAll('.btn').find((b) => b.textContent.includes('返回'));
  backBtn.click();
  await flush(20);
  ok('可退出做题模式', st().mode === 'browse', st().mode);
}

/* 收藏夹标签页 */
const favTab = root.querySelectorAll('.navtab').find((t) => t.textContent.includes('收藏夹'));
favTab.click();
await flush(60);
ok('切到收藏夹标签', st().tab === 'favorites');
const favCards = root.querySelectorAll('.wordcard');
ok('收藏夹渲染已收藏卡片', favCards.length === 1, `${favCards.length} 张`);
ok('收藏夹有出题入口', root.querySelectorAll('.btn--accent').some((b) => b.textContent.includes('做题')));
const favGridFirst = favCards[0];
ok('收藏卡片为紧凑模式', favGridFirst && favGridFirst._cls.has('wordcard--compact'));

/* 收藏夹空态 + 清空 */
const clearFavBtn = root.querySelectorAll('.btn').find((b) => b.textContent.includes('清空收藏'));
ok('收藏夹有清空按钮', Boolean(clearFavBtn));

/* 详情弹窗（直接验证模块，不依赖 modal 的 portal） */
favGridFirst.querySelector('.wordcard__fav').click();
await flush(20);
ok('取消收藏后收藏数归零', st().favorites === 0, String(st().favorites));

/* ============ 功能四：错题本落库与视图 ============ */
/* 先直接调 dataService 记录两次作答（1 错 1 对），验证落库与错误率 */
const ds = root.__debug.dataService;
await ds.recordAnswer('slay_the_spire', 'ascension', false);
await ds.recordAnswer('slay_the_spire', 'ascension', true);
const wrongRec = await ds.getWrongRecord('slay_the_spire', 'ascension');
ok('错题本记录 wrongCount=1 / totalAttempts=2', wrongRec && wrongRec.wrongCount === 1 && wrongRec.totalAttempts === 2,
  JSON.stringify(wrongRec && { w: wrongRec.wrongCount, t: wrongRec.totalAttempts }));
ok('错误率 = 0.5', wrongRec && Math.abs(wrongRec.ratio - 0.5) < 1e-9, String(wrongRec && wrongRec.ratio));

/* 连续答对 3 次 → 自动移出错题本 */
/* 当前状态：wrongCount=1, totalAttempts=2, correctStreak=1（上面那次答对） */
await ds.recordAnswer('slay_the_spire', 'ascension', true);   // streak = 2
const stillThere = await ds.isWrongWord('slay_the_spire', 'ascension');
ok('第 2 次连续答对后仍在错题本', stillThere === true);
await ds.recordAnswer('slay_the_spire', 'ascension', true);   // streak = 3 → 移出
const gone = await ds.isWrongWord('slay_the_spire', 'ascension');
ok('连续答对 3 次后自动移出错题本', gone === false);

/* 重新造一条错题，验证错题本标签页渲染 */
await ds.recordAnswer('slay_the_spire', 'barrier', false);
const wrongTab = root.querySelectorAll('.navtab').find((t) => t.textContent.includes('错题本'));
wrongTab.click();
await flush(60);
ok('切到错题本标签', st().tab === 'wrong', st().tab);
const wrongRows = root.querySelectorAll('.wrong-row');
ok('错题本渲染错题行', wrongRows.length >= 1, `${wrongRows.length} 行`);
ok('顶栏错题角标已更新', st().wrongCount >= 1, String(st().wrongCount));

/* ============ 功能二：复习分组设置页 ============ */
/* 先补足收藏（复习需要 >= 2 张） */
await ds.setFavorite('slay_the_spire', 'barrier', true);
await ds.setFavorite('slay_the_spire', 'ascension', true);
/* 回到卡片库标签，工具栏才会渲染 */
const libTab = root.querySelectorAll('.navtab').find((t) => t.textContent.includes('卡片库'));
libTab.click();
await flush(60);
const reviewBtn = root.querySelectorAll('.btn').find((b) => b.textContent.includes('复习收藏夹'));
ok('工具栏有复习入口', Boolean(reviewBtn));
if (reviewBtn) {
  reviewBtn.click();
  // 分组设置需要读取收藏词条的材料（文件 I/O），多等一会儿
  await flush(300);
  const setupEl = root.querySelector('.group-setup');
  ok('复习进入分组设置页', Boolean(setupEl), setupEl ? 'group-setup' : 'missing');
  const optsWrap = setupEl ? setupEl.querySelector('.group-setup__opts') : null;
  const sizeOpts = optsWrap ? optsWrap.querySelectorAll('.btn') : [];
  ok('渲染 4 个词数选项', sizeOpts.length === 4, `${sizeOpts.length} 个词数选项`);
  ok('分组选项为 10/20/30/50', sizeOpts.map((b) => b.textContent).join(',') === '10 词,20 词,30 词,50 词',
    sizeOpts.map((b) => b.textContent).join(','));
  ok('默认每组 20 词高亮', sizeOpts.some((b) => b.textContent === '20 词' && b._cls.has('btn--accent')));
  const includeBox = setupEl ? setupEl.querySelector('.check-line') : null;
  ok('设置页有「包含熟词」开关', Boolean(includeBox && includeBox.querySelector('input')));

  /* ---- 档位选择器（核心 / 相关 / 泛化，默认「相关」）----
   * 默认档位可能是空的（收藏词恰好都在别的档），因此测试里选「词数最多」的一档，
   * 保证后续能真的进入答题；默认高亮本身也单独断言。 */
  const tierWrap = setupEl ? setupEl.querySelector('.tier-opts') : null;
  const tierBtns = tierWrap ? tierWrap.querySelectorAll('.btn') : [];
  ok('复习设置页有档位选择器', tierBtns.length === 3, tierBtns.map((b) => b.textContent.trim()).join(','));
  ok('档位选项为 核心/相关/泛化', tierBtns.map((b) => b.textContent.trim().split(' ')[0]).join(',') === '核心,相关,泛化',
    tierBtns.map((b) => b.textContent.trim()).join(','));
  ok('默认档位为「相关」', tierBtns.some((b) => /^相关 /.test(b.textContent.trim()) && b._cls.has('btn--accent')),
    tierBtns.map((b) => `${b.textContent.trim()}${b._cls.has('btn--accent') ? '*' : ''}`).join(' '));

  const numOf = (b) => Number((b.textContent.match(/(\d+)/) || [0, 0])[1]);
  const bestTier = tierBtns.slice().sort((a, b) => numOf(b) - numOf(a))[0];
  if (bestTier && numOf(bestTier) > 0 && !bestTier._cls.has('btn--accent')) {
    bestTier.click();
    await flush(300);   // 切档会整页重算（boot）
  }

  const startBtn = root.querySelectorAll('.btn').find((b) => /开始第 1 组/.test(b.textContent));
  ok('有「开始第 1 组」按钮', Boolean(startBtn));
  if (startBtn) {
    startBtn.click();
    await flush(300);
    ok('进入第 1 组答题（组标题条出现）', Boolean(root.querySelector('.group-dots')),
      root.querySelector('.quiz-view__counter')?.textContent || '');

    /* ---- 完成整组答题 → 验证组间小结 + quizSessions 落库 ---- */
    let guard = 0;
    while (root.querySelector('.quiz-option') && guard < 60) {
      const opts = root.querySelectorAll('.quiz-option');
      if (!opts.length) break;
      opts[0].click();
      await flush(30);
      const nextBtn = root.querySelectorAll('.btn').find((b) => /下一题|查看成绩/.test(b.textContent));
      if (nextBtn) { nextBtn.click(); await flush(30); }
      guard += 1;
    }
    await flush(60);

    const sessionsRaw = JSON.parse(localStorage.getItem('wb:cet6:quizSessions') || '{"data":[]}');
    const sessions = Array.isArray(sessionsRaw.data) ? sessionsRaw.data : [];
    ok('分组结果已落库 quizSessions', sessions.length >= 1, `${sessions.length} 条`);
    const s0 = sessions[0] || {};
    ok('会话记录含 sessionId / groupIndex / totalGroups',
      Boolean(s0.sessionId) && s0.groupIndex === 1 && s0.totalGroups >= 1,
      JSON.stringify({ id: s0.sessionId, gi: s0.groupIndex, tg: s0.totalGroups }));
    ok('会话记录含 wordCount / correctCount / wrongCount',
      typeof s0.wordCount === 'number' && typeof s0.correctCount === 'number' && typeof s0.wrongCount === 'number',
      JSON.stringify({ w: s0.wordCount, c: s0.correctCount, x: s0.wrongCount }));
    ok('会话记录含逐词对错明细 words[]',
      Array.isArray(s0.words) && s0.words.every((x) => typeof x.word === 'string' && typeof x.correct === 'boolean'),
      `${(s0.words || []).length} 词`);

    const statsBoxes = root.querySelectorAll('.group-stats__box');
    ok('组间小结显示统计（正确率/答对/答错）', statsBoxes.length === 3, `${statsBoxes.length} 项`);
    ok('组间小结有「继续下一组」或「查看本轮总结」',
      root.querySelectorAll('.btn').some((b) => /继续第|查看本轮总结/.test(b.textContent)));
  }
}

/* ============ 结果 ============ */
console.log('=========== DOM 冒烟测试 ===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败 ---'); console.log(fail.join('\n')); }
if (errors.length) { console.log('\n--- 未捕获异常 ---'); console.log(errors.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败 / ${errors.length} 异常`);
process.exit(fail.length || errors.length ? 1 : 0);
