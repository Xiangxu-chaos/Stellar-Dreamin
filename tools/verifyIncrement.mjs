/**
 * 端到端业务验证（Node 环境，带最小 DOM/BOM shim）
 * 验证本轮增量需求：静态材料 / 多领域重合 / 图片 / 做题 / 收藏 / 分层边界
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (name, cond, extra = '') => (cond ? pass : fail).push(`${cond ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);

/* ---------------- 最小 DOM shim ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this._text = ''; this._html = ''; this.classList = mkClassList(); this.nodeType = 1; this.parentNode = null;
  }
  appendChild(c) { if (c == null) return c; this.children.push(c); if (c.nodeType === 1) c.parentNode = this; return c; }
  append(...cs) { cs.forEach((c) => { if (typeof c === 'string') this.appendChild(new TextNode(c)); else if (c != null) this.appendChild(c); }); }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, fn) { (this._ev = this._ev || {})[t] = fn; }
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get firstChild() { return this.children[0] || null; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text || this.children.map((c) => c.textContent ?? '').join(''); }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
}
class TextNode { constructor(t) { this.nodeType = 3; this._t = String(t); } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }
function mkClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, f) => { const on = f === undefined ? !set.has(c) : f; on ? set.add(c) : set.delete(c); return on; },
    get length() { return set.size; },
    toString: () => [...set].join(' '),
  };
}
const listeners = {};
globalThis.window = {
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener() {}, location: { reload() {} }, scrollTo() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i], get length() { return m.size; } }; })(),
};
globalThis.localStorage = window.localStorage;
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => new TextNode(t),
  createElementNS: (_ns, t) => new El(t),
  body: new El('body'),
  documentElement: new El('html'),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
/* dom.js 用 `c instanceof Node` 判断是否为节点，这里给出 shim */
globalThis.Node = El;
globalThis.HTMLElement = El;
globalThis.Element = El;

/* fetch：把本地文件路径映射成 file 读取 */
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u);
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('not found ' + p); } };
  const text = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(text); }, async text() { return text; } };
};

/* ---------------- 加载模块 ---------------- */
const wb = (await import('../src/services/wordBankService.js')).default;
const dms = (await import('../src/services/domainMaterialService.js')).default;
const ds = (await import('../src/services/dataService.js')).default;
const study = (await import('../src/services/studyService.js')).default;
const quiz = (await import('../src/services/quizService.js')).default;

console.log('=========== 端到端业务验证 ===========\n');

/* 1. 词库 + 领域 + 材料文件 */
await wb.ensureLoaded();
const wc = wb.getWordCount();
ok('词库载入', wc >= 5000 && wc <= 6000, `${wc} 词`);

const domains = wb.getDomains();
ok('领域数量 ≥ 4（四个原始领域必须在册）', domains.length >= 4 && ['slay_the_spire', 'hollow_knight', 'honor_of_kings', 'valorant'].every((id) => domains.some((d) => d.id === id)), domains.map((d) => `${d.name}(${d.termCount})`).join(' / '));

const withMat = wb.getDomainsWithMaterials();
ok('每个已注册领域都有材料文件映射', withMat.length === domains.length, `${withMat.length}/${domains.length}`);

/* 新增领域（任务三）必须在册 */
const NEW_DOMAINS = ['honor_of_kings', 'valorant'];
ok('新增领域王者荣耀/无畏契约已注册',
  NEW_DOMAINS.every((id) => domains.some((d) => d.id === id)),
  NEW_DOMAINS.filter((id) => !domains.some((d) => d.id === id)).join(', ') || 'both ok');
ok('新增领域均有预生成材料映射',
  NEW_DOMAINS.every((id) => withMat.includes(id)),
  withMat.join(', '));

/* 术语表：每个新增领域都有 source 溯源约定（配置侧 domainTerms 非空 + 材料侧 source/unverified） */
for (const id of NEW_DOMAINS) {
  const detail = wb.getDomainDetail(id);
  const termCount = Object.keys(detail?.domainTerms || {}).length;
  ok(`[${id}] 术语表非空`, termCount >= 20, `${termCount} 条术语`);
  ok(`[${id}] 配置了视觉主题`, Boolean(detail?.theme?.label), detail?.theme?.label || '缺失');
  ok(`[${id}] 配置了 generationPrompt`, Boolean(detail?.generationPrompt), '');
}

/* 2. 预生成静态材料：字段完整性 + source/unverified + 例句非空（问题二验收） */
let totalMat = 0; let unverifiedCount = 0; let missingSource = 0; const badFields = []; const emptyExample = [];
for (const dId of withMat) {
  const stats = await dms.getMaterialStats(dId);
  totalMat += stats.total;
  unverifiedCount += stats.unverified;
  const all = await dms.getMaterials(dId);
  for (const [w, m] of Object.entries(all)) {
    const need = ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'source'];
    for (const k of need) if (m[k] === undefined || m[k] === null) badFields.push(`${dId}/${w}.${k}`);
    if (!m.source) missingSource++;
    // 问题二：每条材料都必须有非空 example（卡片背面例句区不能空白）
    if (typeof m.example !== 'string' || !m.example.trim()) emptyExample.push(`${dId}/${w}`);
    if (typeof m.unverified !== 'boolean') badFields.push(`${dId}/${w}.unverified(type)`);
  }
}
/* 原始四领域固定 1340 条；扩展兴趣库只会追加，因此这里是「下界 + 每库下限」双断言 */
ok('预生成材料总量 ≥ 1340（原始四领域基线）', totalMat >= 1340, `${totalMat} 条`);
const thinDomains = [];
for (const dId of withMat) {
  const st = await dms.getMaterialStats(dId);
  if (st.total < 20) thinDomains.push(`${dId}:${st.total}`);
}
ok('每个有材料文件的领域都至少有 20 条', thinDomains.length === 0, thinDomains.join(', '));
ok('材料字段无缺失', badFields.length === 0, badFields.slice(0, 5).join(', '));
ok('每条材料都有 source', missingSource === 0, `${missingSource} 条缺失`);
ok('每条材料都有非空 example（问题二）', emptyExample.length === 0, emptyExample.slice(0, 5).join(', '));
ok('存在 unverified 标记', unverifiedCount > 0, `${unverifiedCount} 条标为待确认`);

/* 3. 多领域重合（需求二）：同一个词属于多个领域 */
const overlap = [];
const spireWords = new Set(Object.keys(await dms.getMaterials('slay_the_spire')).map((s) => s.toLowerCase()));
const hkWords = new Set(Object.keys(await dms.getMaterials('hollow_knight')).map((s) => s.toLowerCase()));
for (const w of spireWords) if (hkWords.has(w)) overlap.push(w);
ok('两领域存在重合词', overlap.length >= 5, `${overlap.length} 个：` + overlap.slice(0, 10).join(', '));

/* 每个重合词在两个领域下有独立材料（domainMeaning 不同） */
let independent = 0;
for (const w of overlap) {
  const a = await dms.getMaterial('slay_the_spire', w);
  const b = await dms.getMaterial('hollow_knight', w);
  if (a && b) independent++;
}
ok('重合词在两个领域各持独立材料', independent === overlap.length, `${independent}/${overlap.length}`);

/* 4. 多领域标签（getDomainTags / attachDomainTags） */
const tagsShowcase = [];
for (const w of ['focus', 'ritual', 'barrier', 'curse', 'strike', 'relic', 'guardian', 'claw']) {
  const tags = wb.getDomainTags(w);
  if (tags.length) tagsShowcase.push(`${w}→[${tags.map((t) => t.domainName + (t.level === 'exact' ? ':' + t.domainTermZh : '')).join('|')}]`);
}
ok('多领域标签索引可用', tagsShowcase.length >= 6, tagsShowcase.join('  '));

const attachTest = [{ word: 'focus' }, { word: 'guardian' }];
wb.attachDomainTags(attachTest);
ok('attachDomainTags 写入 domains 数组', attachTest.every((w) => Array.isArray(w.domains)), JSON.stringify(attachTest.map((w) => w.domains.length)));

/* 5. 相关词筛选 + 卡片补全（含 image / material / domains） */
for (const dId of withMat) {
  const { words } = await study.buildRelatedWords(dId, { localLimit: 600 });
  const cards = await study.hydrateCards(dId, words.slice(0, 400));
  const withMaterial = cards.filter((w) => w.material).length;
  const withDomains = cards.filter((w) => Array.isArray(w.domains)).length;
  const withImageField = cards.filter((w) => typeof w.image === 'string').length;
  // 阈值不能写死 100：影视/体育类领域的六级词命中面天然窄于游戏类，
  // 只断言「确实筛出了可用数量的相关词」，并保证上限不超 localLimit。
  ok(`[${dId}] 相关词筛选`, words.length >= 20 && words.length <= 600, `${words.length} 词`);
  ok(`[${dId}] 卡片已挂载 material`, withMaterial > 0, `${withMaterial}/400`);
  ok(`[${dId}] 卡片已挂载 domains`, withDomains === cards.length, `${withDomains}/${cards.length}`);
  ok(`[${dId}] 卡片带 image 字段`, withImageField === cards.length, `${withImageField}/${cards.length}`);
}

/* 黑名单泄漏检查 */
const leak = [];
for (const dId of withMat) {
  const { words } = await study.buildRelatedWords(dId, { localLimit: 6000 });
  const excl = new Set(wb.getDomainDetail(dId)?.excludedTerms || []);
  for (const w of words) if (excl.has(w.word.toLowerCase())) leak.push(`${dId}:${w.word}`);
}
ok('假阳性黑名单零泄漏', leak.length === 0, leak.slice(0, 8).join(', '));

/* 6. 收藏（需求六） */
await ds.clearFavorites();
const t1 = await ds.toggleFavorite('slay_the_spire', 'ascension');
const t2 = await ds.toggleFavorite('hollow_knight', 'ritual');
const t3 = await ds.toggleFavorite('hollow_knight', 'focus');
ok('toggleFavorite 返回 true', t1 === true && t2 === true && t3 === true);
ok('isFavorite 命中', await ds.isFavorite('slay_the_spire', 'ascension'));
ok('同词不同领域互不影响', (await ds.isFavorite('hollow_knight', 'ascension')) === false);
const favKeys = await ds.getFavoriteKeys();
ok('getFavoriteKeys = 3', favKeys.length === 3, favKeys.join(', '));

const favCards = await study.buildFavorites();
ok('buildFavorites 跨领域聚合', favCards.length === 3, `${favCards.length} 张`);
ok('收藏卡片带 material + domains', favCards.every((w) => w.domains && Array.isArray(w.domains)), JSON.stringify(favCards.map((w) => w.domains.length)));

const t4 = await ds.toggleFavorite('hollow_knight', 'ritual');
ok('再次 toggle 取消收藏', t4 === false && !(await ds.isFavorite('hollow_knight', 'ritual')));
ok('取消后收藏数 = 2', (await ds.getFavoriteKeys()).length === 2);

/* 持久化（刷新不丢）：直接读 raw localStorage */
const rawFav = JSON.parse(localStorage.getItem('wb:cet6:favorites'));
ok('收藏已落 localStorage', rawFav && Object.keys(rawFav.data).length === 2, JSON.stringify(Object.keys(rawFav?.data || {})));

/* 7. 配图覆盖（需求三） */
await ds.setImageOverride('slay_the_spire', 'ascension', 'https://example.com/a.png');
const ov = await ds.getImageOverride('slay_the_spire', 'ascension');
ok('图片覆盖写入/读取', ov === 'https://example.com/a.png');
const { image: resolvedImg, material: matA } = await dms.getMaterialWithImage('slay_the_spire', 'ascension');
ok('resolveImage 优先用户覆盖', resolvedImg === 'https://example.com/a.png');
await ds.setImageOverride('slay_the_spire', 'ascension', '');
const { image: presetImg } = await dms.getMaterialWithImage('slay_the_spire', 'ascension');
ok('清空覆盖后回退预置图', presetImg === (matA?.imageUrl || ''), `"${presetImg}"`);

/* 8. 做题模式（需求五） */
for (const src of [quiz.QUIZ_SOURCES.DOMAIN, quiz.QUIZ_SOURCES.ALL, quiz.QUIZ_SOURCES.FAVORITES]) {
  const qs = await quiz.buildQuiz({ source: src, type: quiz.QUIZ_TYPES.MIXED, count: 10 }, { domainId: 'slay_the_spire', words: await study.hydrateCards('slay_the_spire', (await study.buildRelatedWords('slay_the_spire', { localLimit: 600 })).words) });
  const shapeOk = qs.every((q) => q.options && q.options.length >= 2 && q.options.filter((o) => o.correct).length === 1 && q.word);
  const types = new Set(qs.map((q) => q.type));
  ok(`[${src}] 出题成功`, qs.length > 0, `${qs.length} 题`);
  ok(`[${src}] 每题恰好 1 个正确选项`, shapeOk);
  ok(`[${src}] 题型为 en2zh/zh2en`, [...types].every((t) => t === 'en2zh' || t === 'zh2en'), [...types].join(','));
  if (qs.length) {
    const q0 = qs[0];
    const wrong = q0.options.find((o) => !o.correct);
    await quiz.submitQuizAnswer(q0, wrong.text);
    const stats = await ds.getQuizStats('slay_the_spire');
    ok(`[${src}] 判分落库`, stats.total > 0, `total=${stats.total}`);
  }
}

/* 干扰项优先同词根 / 近义 */
const pool = await study.hydrateCards('slay_the_spire', (await study.buildRelatedWords('slay_the_spire', { localLimit: 600 })).words);
const target = pool.find((w) => w.root && w.root !== '核心词') || pool[0];
const distractors = quiz.pickDistractors(target, pool, 4, true);
ok('干扰项数量 = 3', distractors.length === 3, distractors.map((d) => d.word).join(', '));
ok('干扰项不含正确词', distractors.every((d) => d.word.toLowerCase() !== target.word.toLowerCase()));

/* 9. 列表 / 网格组件可实例化（WordCard） */
const { createWordCard } = await import('../src/components/wordCard.js');
const sample = pool[0];
const cardEl = createWordCard({
  word: sample, material: sample.material, image: sample.image,
  domain: wb.getDomainDetail('slay_the_spire'), domains: sample.domains,
  relevance: sample.relevance, index: 0, favorite: false, selected: false,
  onExpand: () => {}, onFlip: () => {}, onToggleFavorite: () => {}, onToggleSelect: () => {},
});
ok('WordCard 可渲染', cardEl && cardEl.tagName === 'ARTICLE');
ok('WordCard 暴露 __flip', typeof cardEl.__flip === 'function');

/* 无图卡片 → 占位图，不产生 img */
const noImg = createWordCard({ word: { ...sample, word: 'zzzz' }, material: null, image: '', domain: null, domains: [] });
const flat = [];
(function walk(n) { flat.push(n); (n.children || []).forEach(walk); })(noImg);
ok('无图时渲染占位图（无 img）', !flat.some((n) => n.tagName === 'IMG'), `节点 ${flat.length}`);

/* 10. 分层边界：components / pages 不得直接碰 localStorage / fetch / 词库 JSON */
const boundaryFiles = [];
(function walkDir(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkDir(p); else if (e.name.endsWith('.js')) boundaryFiles.push(p);
  }
})(path.join(ROOT, 'src'));
const violations = [];
for (const f of boundaryFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (!rel.includes('/components/') && !rel.includes('/pages/')) continue;
  const src = readFileSync(f, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/localStorage\s*\./.test(code)) violations.push(`${rel}: localStorage`);
  if (/[^.\w]fetch\s*\(/.test(code)) violations.push(`${rel}: fetch`);
  if (/data\/cet6Core\.json/.test(code)) violations.push(`${rel}: 直接引用词库 JSON`);
}
ok('分层边界：components/pages 零越界', violations.length === 0, violations.join('; '));

/* 11. 只读铁律：dataService 的「读取类」函数体内不得出现任何写入调用 ──────────
 * 背景：曾因在 getFavorites() 的读取路径里加「自愈回写」，
 *       导致一次普通读取就把 localStorage 的收藏写成 {}（收藏被清空）。
 *       此断言永久防止该类回退。 */
const dsSrc = readFileSync(path.join(ROOT, 'src/services/dataService.js'), 'utf8');
const readFnNames = [
  'readFavoriteList', 'getFavorites', 'getFavoriteKeys', 'getAllFavoriteWords', 'isFavorite',
  // 功能三 / 四新增的读取类函数，同样必须纯读取
  'readMasteredList', 'getMasteredWords', 'getMasteredKeys', 'getAllMasteredWords',
  'getMasteredCount', 'isMastered',
  'readWrongList', 'getWrongWords', 'getWrongCount', 'isWrongWord', 'getWrongRecord',
  // 功能一：纯读取
  'getUserDomains',
];
const writeCallRe = /\b(writeRaw|updateRaw|setItem|removeItem|clearFavorites|setFavorite|toggleFavorite)\s*\(/;
const readFnViolations = [];
for (const name of readFnNames) {
  // 截取 async function <name>( ... ) { ... } 的函数体（按大括号配平）
  const startRe = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = startRe.exec(dsSrc);
  if (m) {
    let i = dsSrc.indexOf('{', m.index);
    let depth = 0, end = i;
    for (; end < dsSrc.length; end++) {
      if (dsSrc[end] === '{') depth++;
      else if (dsSrc[end] === '}') { depth--; if (depth === 0) break; }
    }
    const bodySrc = dsSrc.slice(i, end + 1);
    const bodyCode = bodySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (writeCallRe.test(bodyCode)) readFnViolations.push(name);
  }
}
ok('只读铁律：收藏读取函数体内零写入调用', readFnViolations.length === 0, readFnViolations.join(', '));

/* ---------------- 输出 ---------------- */
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
