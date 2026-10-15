/**
 * verifyTiers.mjs —— 「核心 / 相关 / 泛化」三档机制专项校验
 * ============================================================================
 * 锁死四件事：
 *   一、档位规则：按召回**排名**分档（前 20% / 20–50% / 50–100%），
 *       少于 20 个词的领域统一归「核心」；每项 tier 合法且单调。
 *   二、召回数量：ensureRecallCounts() 预计算的数量 = filterByDomain().length，
 *       并通过 getDomains().recallCount 暴露给领域选择器。
 *   三、卡片：wordCard / flipCard 正面渲染档位标签，缺 tier 时按「相关」兜底，
 *       正面标签总数不超过 4 类（领域 / 认证 / 词性 / 档位）。
 *   四、复习：默认档位 = 相关；选哪档就只出哪档的词。
 *
 * 运行：node tools/verifyTiers.mjs
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, e = '') => (c ? pass : fail).push(`${c ? '\u2714' : '\u2718'} ${n}${e ? ' — ' + e : ''}`);
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/* ---------------- DOM / BOM 最小 shim ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    this._ev = {};
    this.attributes = {};
    this.style = {};
    const s = this;
    this.classList = {
      add(...c) { c.forEach((x) => s._cls.add(x)); },
      remove(...c) { c.forEach((x) => s._cls.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !s._cls.has(c) : !!f; if (on) s._cls.add(c); else s._cls.delete(c); return on; },
      contains(c) { return s._cls.has(c); },
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach((n) => { if (n) this.appendChild(n); }); }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; } return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...ns) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this.append(...ns); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, f) { (this._ev[t] = this._ev[t] || []).push(f); }
  querySelector(s) { return this._find(s, true); }
  querySelectorAll(s) { return this._find(s, false); }
  _find(sel, first) {
    const out = [];
    const test = (n) => {
      if (n.nodeType !== 1) return false;
      if (sel.startsWith('.')) return n._cls.has(sel.slice(1));
      return n.tagName === sel.toUpperCase();
    };
    const walk = (n) => { for (const c of n.children || []) { if (test(c)) { out.push(c); if (first) return true; } if (walk(c) && first) return true; } return false; };
    walk(this);
    return first ? (out[0] || null) : out;
  }
  get textContent() { if (this._text !== undefined) return this._text; return this.children.map((c) => c.textContent || '').join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
}
globalThis.Node = El; globalThis.HTMLElement = El; globalThis.Element = El;
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  createElementNS: (_n, t) => new El(t),
  body: new El('body'),
};
globalThis.window = {
  addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (f) => setTimeout(() => f(0), 0), setTimeout, clearTimeout,
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

/* file:// fetch shim —— 让 wordBankService 能读本地词库 */
const fsmod = await import('node:fs');
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (!s.startsWith('file:')) return nativeFetch(url, init);
  const p = decodeURIComponent(s.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  if (!fsmod.existsSync(p)) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  const t = fsmod.readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(t), text: async () => t };
};

/* ==========================================================================
 * 一、档位规则（纯函数）
 * ======================================================================= */
console.log('—— 一、档位规则 ——');
const { tierOf, tierLabel, tierClass, TIERS, DEFAULT_TIER } = await import('../src/core/tierLabel.js');
ok('A1. tierOf(undefined) 兜底为 related', tierOf(undefined) === 'related');
ok('A2. tierOf({tier:"core"}) === core', tierOf({ tier: 'core' }) === 'core');
ok('A3. tierOf("extended") === extended', tierOf('extended') === 'extended');
ok('A4. 非法值兜底 related', tierOf('bogus') === DEFAULT_TIER);
ok('A5. 中文名 核心/相关/泛化', tierLabel('core') === '核心' && tierLabel('related') === '相关' && tierLabel('extended') === '泛化',
  `${tierLabel('core')}/${tierLabel('related')}/${tierLabel('extended')}`);
ok('A6. CSS 类名映射', tierClass('core') === 'chip--tier-core' && tierClass('extended') === 'chip--tier-extended');
ok('A7. 档位集合恰好三档', JSON.stringify(TIERS) === JSON.stringify(['core', 'related', 'extended']));

const wbs = await import('../src/services/wordBankService.js');
const { assignTiers, WORD_TIERS, TIER_MIN_TOTAL, ensureRecallCounts, getRecallCount, attachTiers } = wbs;

const countTiers = (list) => list.reduce((m, x) => { m[x.tier] = (m[x.tier] || 0) + 1; return m; }, {});
const mk = (n) => Array.from({ length: n }, (_, i) => ({ word: `w${i}`, relevance: { score: 100 - i } }));

const empty = assignTiers([]);
ok('B1. 空数组不报错', Array.isArray(empty) && empty.length === 0);
const small = assignTiers(mk(10));
ok(`B2. 少于 ${TIER_MIN_TOTAL} 词 → 全部「核心」`, countTiers(small).core === 10, JSON.stringify(countTiers(small)));
const big = countTiers(assignTiers(mk(100)));
ok('B3. 100 词 → 核心 20 / 相关 30 / 泛化 50', big.core === 20 && big.related === 30 && big.extended === 50, JSON.stringify(big));
const mid = countTiers(assignTiers(mk(25)));
ok('B4. 25 词 → 核心 5 / 相关 8 / 泛化 12', mid.core === 5 && mid.related === 8 && mid.extended === 12, JSON.stringify(mid));
ok('B5. 分档不改变数组长度', assignTiers(mk(37)).length === 37);
ok('B6. 分档覆盖每一档（≥20 词时核心非空）', assignTiers(mk(20)).filter((x) => x.tier === WORD_TIERS.CORE).length >= 1);

/* ==========================================================================
 * 二、真实领域：tier / 数量
 * ======================================================================= */
console.log('—— 二、真实领域 ——');
const { INTEREST_DOMAINS } = await import('../src/config/interestsConfig.js');
const ids = Object.keys(INTEREST_DOMAINS);

const legal = []; const noCore = []; const allTiered = [];
const sample = ['slay_the_spire', 'basketball', 'animation'];
for (const id of ids) {
  const list = await wbs.filterByDomain(id);
  const bad = list.filter((x) => !TIERS.includes(x.tier));
  if (bad.length) allTiered.push(`${id}:${bad.length}`);
  if (!list.some((x) => x.tier === 'core')) noCore.push(`${id}(n=${list.length})`);
  if (sample.includes(id)) legal.push({ id, n: list.length, counts: countTiers(list) });
}
ok('C1. 20 个领域每一项都有合法 tier', allTiered.length === 0, allTiered.join(', '));
ok('C2. 每个领域的「核心」档都不为空', noCore.length === 0, noCore.join(', '));
ok('C3. 三档之和 = 领域词数', legal.every((s) => Object.values(s.counts).reduce((a, b) => a + b, 0) === s.n),
  legal.map((s) => `${s.id}:${s.n}`).join(' '));

/* 分档按分数单调：核心档的最低分 ≥ 泛化档的最高分 */
let monotone = true;
for (const id of sample) {
  const list = await wbs.filterByDomain(id);
  const coreMin = Math.min(...list.filter((x) => x.tier === 'core').map((x) => x.relevance.score));
  const extMax = Math.max(...list.filter((x) => x.tier === 'extended').map((x) => x.relevance.score));
  if (list.some((x) => x.tier === 'extended') && coreMin < extMax) monotone = false;
}
ok('C4. 分档与召回分数一致（核心 ≥ 泛化）', monotone);

const counts = await ensureRecallCounts();
ok('D1. ensureRecallCounts() 覆盖全部领域', ids.every((id) => typeof counts[id] === 'number' && counts[id] > 0),
  ids.slice(0, 4).map((id) => `${id}:${counts[id]}`).join(' '));
const probe = 'slay_the_spire';
ok('D2. 预计算数量 = filterByDomain().length', counts[probe] === (await wbs.filterByDomain(probe)).length, `${counts[probe]}`);
ok('D3. getRecallCount() 与预计算一致', getRecallCount(probe) === counts[probe]);
ok('D4. getDomains().recallCount 已透传', wbs.getDomains().every((d) => typeof d.recallCount === 'number'), String(wbs.getDomains()[0]?.recallCount));
ok('D5. 幂等（重复调用返回同一 promise 结果）', (await ensureRecallCounts())[probe] === counts[probe]);

/* ==========================================================================
 * 三、卡片正面档位标签
 * ======================================================================= */
console.log('—— 三、卡片 ——');
const { createWordCard } = await import('../src/components/wordCard.js');
const { createFlipCard } = await import('../src/components/flipCard.js');
const DOMAIN = wbs.getDomains()[0];
const ALL = await wbs.filterByDomain(DOMAIN.id);
const pickOf = (tier) => ALL.find((x) => x.tier === tier);

function frontBadges(node) {
  const badges = node.querySelector('.wordcard__badges') || node.querySelector('.flip__badges');
  return badges ? badges.children.filter((c) => c.nodeType === 1) : [];
}
function tierChipOf(node) {
  return frontBadges(node).find((c) => c.className.split(' ').some((k) => k.startsWith('chip--tier-'))) || null;
}

for (const tier of ['core', 'related', 'extended']) {
  const w = pickOf(tier);
  if (!w) { ok(`E.${tier} 样本词存在`, false); continue; }
  const card = createWordCard({ word: { ...w }, domain: DOMAIN, relevance: w.relevance, material: null });
  const chip = tierChipOf(card);
  ok(`E.${tier} 卡片正面渲染档位标签「${tierLabel(tier)}」`,
    chip && chip.className.includes(`chip--tier-${tier}`) && chip.textContent === tierLabel(tier),
    chip ? `${chip.className}|${chip.textContent}` : '（未找到）');
}

{
  const w = pickOf('related');
  const noTier = { ...w }; delete noTier.tier;
  const card = createWordCard({ word: noTier, domain: DOMAIN, relevance: w.relevance, material: null });
  const chip = tierChipOf(card);
  ok('E4. 缺 tier 字段 → 兜底「相关」', chip && chip.className.includes('chip--tier-related') && chip.textContent === '相关',
    chip ? `${chip.className}|${chip.textContent}` : '（未找到）');
  ok('E5. 正面标签总数 ≤ 4（领域/认证/词性/档位）', frontBadges(card).length <= 4, String(frontBadges(card).length));
}

{
  const w = pickOf('core') || pickOf('related');
  const flip = createFlipCard({ word: { ...w }, domain: DOMAIN, relevance: w.relevance, material: null });
  const chip = tierChipOf(flip);
  ok('E6. flipCard 正面同样有档位标签', Boolean(chip) && chip.className.includes('chip--tier-'), chip ? chip.className : '（未找到）');
}

const css = read('src/styles/components.css');
ok('F1. CSS 定义 .chip--tier-core（主题色高亮）', /\.chip--tier-core\s*\{[^}]*color-mix/.test(css));
ok('F2. CSS 定义 .chip--tier-related', /\.chip--tier-related\s*\{/.test(css));
ok('F3. CSS 定义 .chip--tier-extended（低调）', /\.chip--tier-extended\s*\{[^}]*opacity/.test(css));
ok('F4. CSS 定义档位选择器说明 .group-setup__note', /\.group-setup__note\s*\{/.test(css));

/* ==========================================================================
 * 四、复习按档过滤
 * ======================================================================= */
console.log('—— 四、复习 ——');
const studyService = (await import('../src/services/studyService.js')).default;
const dataService = (await import('../src/services/dataService.js')).default;
ok('G1. 默认档位常量 = related', studyService.DEFAULT_REVIEW_TIER === 'related', String(studyService.DEFAULT_REVIEW_TIER));

const FAV_DOMAIN = 'slay_the_spire';
const favPool = await wbs.filterByDomain(FAV_DOMAIN);
const cores = favPool.filter((x) => x.tier === 'core').slice(0, 3);
const exts = favPool.filter((x) => x.tier === 'extended').slice(0, 3);
for (const w of [...cores, ...exts]) await dataService.setFavorite(FAV_DOMAIN, w.word, true);

const def = await studyService.buildReviewGroups({ domainId: FAV_DOMAIN });
ok('G2. 不传 tier → 默认 related', def.tier === 'related', def.tier);
ok('G3. 默认返回的词都是 related 档', def.groups.flat().every((w) => (w.tier || 'related') === 'related'),
  def.groups.flat().map((w) => w.tier).join(','));

const coreRes = await studyService.buildReviewGroups({ domainId: FAV_DOMAIN, tier: 'core' });
ok('G4. tier=core → 结果全部是 core 档', coreRes.groups.flat().length > 0 && coreRes.groups.flat().every((w) => w.tier === 'core'),
  coreRes.groups.flat().map((w) => `${w.word}:${w.tier}`).join(','));

const extRes = await studyService.buildReviewGroups({ domainId: FAV_DOMAIN, tier: 'extended' });
ok('G5. tier=extended → 结果全部是 extended 档', extRes.groups.flat().every((w) => w.tier === 'extended'),
  extRes.groups.flat().map((w) => `${w.word}:${w.tier}`).join(','));

ok('G6. tierCounts 三档齐全', ['core', 'related', 'extended'].every((t) => typeof coreRes.tierCounts[t] === 'number'),
  JSON.stringify(coreRes.tierCounts));
ok('G7. 非法 tier 回落 related', (await studyService.buildReviewGroups({ domainId: FAV_DOMAIN, tier: 'xxx' })).tier === 'related');
ok('G8. 每档分组仍满足「每组 ≤ groupSize」',
  coreRes.groups.every((g) => g.length <= coreRes.groupSize) && extRes.groups.every((g) => g.length <= extRes.groupSize));
ok('G9. attachTiers 给收藏词回填 tier', (await attachTiers([{ word: cores[0].word, domainId: FAV_DOMAIN }]))[0].tier === 'core');

/* 复习设置页源码必须挂载档位选择器 */
const rgv = read('src/components/reviewGroupView.js');
ok('H1. 复习设置页含档位选择器', /复习哪一档/.test(rgv) && /TIERS\.map/.test(rgv));
ok('H2. 切档走 boot()（带竞态守卫，不破坏分组逻辑）', /tier = id;[\s\S]{0,40}await boot\(\)/.test(rgv));
ok('H3. 保留每组词数 / 包含熟词 选择', /每组多少个词/.test(rgv) && /包含熟词/.test(rgv));

/* 领域选择器文案 */
const dp = read('src/components/domainPicker.js');
ok('I1. 领域卡片文案为「相关词 X 条」', /相关词 \$\{/.test(dp));
ok('I2. 未算好时显示「统计中…」', /统计中…/.test(dp));
ok('I3. 数量来自预计算缓存并可回填', /countsPromise/.test(dp) && /recallCount/.test(dp));

/* ==========================================================================
 * 五、卡片库顶部筛选栏 + 做题按档抽题
 * ======================================================================= */
console.log('—— 五、筛选栏 / 做题 ——');
const hp = read('src/pages/homePage.js');
ok('J1. 筛选栏渲染「核心 / 相关 / 泛化」三档',
  /for \(const t of TIERS\)[\s\S]{0,160}segBtn\(levelSeg, tierLabel\(t\)/.test(hp));
ok('J2. 筛选栏不再有「全部 / 专有术语」选项',
  !/segBtn\(levelSeg, '全部'/.test(hp) && !/segBtn\(levelSeg, '专有术语'/.test(hp));
ok('J3. 档位过滤严格基于 tier 字段（不是 relevance.level）',
  /tierOf\(w\) === level/.test(hp) && !/relevance\?\.level === state\.ui\.filterLevel/.test(hp));
ok('J4. 档位过滤在「搜索」之前（搜索结果不被档位清空）',
  hp.indexOf('tierOf(w) === level') < hp.indexOf('if (state.query)'),
  `tier@${hp.indexOf('tierOf(w) === level')} / query@${hp.indexOf('if (state.query)')}`);
ok('J5. 页面无「术语表」字样', !/术语表/.test(hp));
ok('J6. 领域卡片/顶栏统计显示「相关词 X 条」', /相关词 \$\{/.test(hp) && /recallText/.test(hp));

/* 旧版 filterLevel 取值（all / exact / vocab）→ 读取期归一化为「相关」 */
const legacy = ['all', 'exact', 'vocab', 'bogus'];
const migrated = [];
for (const v of legacy) {
  store.set('wb:cet6:ui', JSON.stringify({ __v: 1, data: { domainId: 'slay_the_spire', filterLevel: v } }));
  migrated.push((await dataService.getUI()).filterLevel);
}
store.set('wb:cet6:ui', JSON.stringify({ __v: 1, data: { domainId: 'slay_the_spire', filterLevel: 'core' } }));
const keptCore = (await dataService.getUI()).filterLevel;
store.delete('wb:cet6:ui');
ok('J7. 旧值 filterLevel 一律归一化为 related', migrated.every((v) => v === 'related'), migrated.join(','));
ok('J8. 合法档位值原样保留', keptCore === 'core', keptCore);
ok('J9. DEFAULT_UI 默认档 = related', (await dataService.getUI()).filterLevel === 'related');

/* 做题：只从传入的（当前档位）列表抽题；不传时退回专有术语级 */
const quizSvc = (await import('../src/services/quizService.js')).default;
const extPool = (await wbs.filterByDomain('slay_the_spire')).filter((w) => w.tier === 'extended').slice(0, 40);
const qsExt = await quizSvc.buildQuiz(
  { source: quizSvc.QUIZ_SOURCES.DOMAIN, type: quizSvc.QUIZ_TYPES.MIXED, count: 5 },
  { domainId: 'slay_the_spire', words: extPool },
);
const extSet = new Set(extPool.map((w) => String(w.word).toLowerCase()));
ok('J10. 做题只从传入档位的列表抽词',
  qsExt.length > 0 && qsExt.every((q) => extSet.has(String(q.word).toLowerCase())),
  `${qsExt.length} 题：${qsExt.map((q) => q.word).join(', ')}`);

const fallbackPool = await quizSvc.getQuestionPool(quizSvc.QUIZ_SOURCES.DOMAIN, { domainId: 'honor_of_kings' });
ok('J11. 不传 words 时退回专有术语级（旧行为保留）',
  fallbackPool.length > 0 && fallbackPool.every((w) => w.relevance?.level === 'exact'),
  `${fallbackPool.length} 条`);

/* 空档位给友好提示而非抛异常 */
ok('J12. 空档位有友好提示文案',
  /当前档位暂时没有可做题的单词/.test(hp) && /当前档位暂时出不了题/.test(read('src/components/quizView.js')),
  '');

console.log('\n============================');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
