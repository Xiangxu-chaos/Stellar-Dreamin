/**
 * verifyTasksII_III.mjs —— 任务二 / 任务三 专项验收
 * ============================================================================
 * 任务二：复习模式改为「收藏夹专属 + 预生成例句」
 *   1. 题目只从收藏夹取词（不碰全量词库作为考题）
 *   2. 题型为选择题（英译中 / 中译英），每题恰好 1 个正确项
 *   3. 干扰项优先来自收藏夹，收藏夹不足时回退全量词库补齐
 *   4. 例句来自预生成材料（material.example / exampleZh），运行时不调 AI
 *   5. 全程零网络请求（有 fetch 计数器佐证）
 *   6. 答题历史按词可查（getWordHistory / getHistorySummaryMap）
 *
 * 任务三：新增两个材料库（王者荣耀 / 无畏契约）
 *   1. 两个领域已在 INTEREST_DOMAINS 注册，且有预生成材料文件映射
 *   2. 术语表使用官方中文译名（关键条目标 source/unverified）
 *   3. 预生成材料每条都有 root/generalMeaning/domainMeaning/story/example/source
 *   4. 视觉主题符合要求（暗金中国风 / 深红战术）
 *   5. 两个领域能正常筛选相关词、挂载 material/domains
 *   6. 禁止自行翻译：unverified 条目必须写明来源不确定性
 * ============================================================================
 */
import { readFileSync, existsSync } from 'node:fs';
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
    this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this._text = ''; this._html = '';
    this.classList = mkClassList(); this.nodeType = 1; this.parentNode = null; this.disabled = false;
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
globalThis.Node = El;
globalThis.HTMLElement = El;
globalThis.Element = El;

/* fetch：统计调用次数（用于证明「复习模式零网络请求」） */
let fetchCount = 0;
const fetchedUrls = [];
const ASSET_RE = /\.json$/i;
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u);
  if (ASSET_RE.test(p)) { fetchCount++; fetchedUrls.push(path.basename(p)); }
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

console.log('=========== 任务二 / 任务三 专项验收 ===========\n');

await wb.ensureLoaded();

/* ==========================================================================
 * 任务三：新增两个材料库
 * ======================================================================= */
console.log('—— 任务三：王者荣耀 / 无畏契约 ——');

const NEW_DOMAINS = [
  { id: 'honor_of_kings', name: '王者荣耀', matFile: 'honorOfKings.json', themeHint: '暗金' },
  { id: 'valorant', name: '无畏契约', matFile: 'valorant.json', themeHint: '深红' },
];

const allDomains = wb.getDomains();
const withMat = wb.getDomainsWithMaterials();

for (const nd of NEW_DOMAINS) {
  const d = wb.getDomainDetail(nd.id);
  ok(`[${nd.id}] 领域已注册`, Boolean(d), d ? d.name : '未找到');
  ok(`[${nd.id}] 名称正确`, d?.name === nd.name, d?.name);
  ok(`[${nd.id}] 材料文件已映射`, withMat.includes(nd.id), withMat.join(', '));

  /* 配置文件存在且结构正确 */
  const matPath = path.join(ROOT, 'src/data/domainMaterials', nd.matFile);
  ok(`[${nd.id}] 材料 JSON 文件存在`, existsSync(matPath), nd.matFile);
  if (existsSync(matPath)) {
    const raw = JSON.parse(readFileSync(matPath, 'utf8'));
    ok(`[${nd.id}] 材料 JSON domainIdInConfig 一致`, raw.domainIdInConfig === nd.id, raw.domainIdInConfig);
    ok(`[${nd.id}] 材料 JSON 有 _comment 说明来源`, Array.isArray(raw._comment) && raw._comment.length >= 4, '');
    const keys = Object.keys(raw.materials || {});
    ok(`[${nd.id}] 材料条目数 >= 20`, keys.length >= 20, `${keys.length} 条`);

    /* 每条材料必须有完整五段 + source + unverified */
    const bad = [];
    for (const [w, m] of Object.entries(raw.materials)) {
      for (const k of ['root', 'generalMeaning', 'domainMeaning', 'story', 'example']) {
        if (!m[k] || typeof m[k] !== 'string') bad.push(`${w}.${k}`);
      }
      if (typeof m.imageUrl !== 'string') bad.push(`${w}.imageUrl`);
      if (!m.source || typeof m.source !== 'string') bad.push(`${w}.source`);
      if (typeof m.unverified !== 'boolean') bad.push(`${w}.unverified`);
    }
    ok(`[${nd.id}] 材料字段完整（含 source/unverified）`, bad.length === 0, bad.slice(0, 6).join(', '));

    /* 禁止自行翻译：unverified=true 的条目，domainMeaning 必须说明不确定性。
       「AI 补充，待复核」也算明确的不确定性声明（autoFixGap 补缺口时写入的措辞）。 */
    const badUnv = keys.filter((k) => {
      const m = raw.materials[k];
      if (!m.unverified) return false;
      return !/待确认|待复核|无权威来源|未.{0,4}(固定|收录|以.{0,3}术语)|非国服|非官方/.test(m.domainMeaning + m.source);
    });
    ok(`[${nd.id}] unverified 条目均写明「待确认」措辞`, badUnv.length === 0, badUnv.join(', '));

    /* imageUrl 要么为空，要么是 https 链接（不许编造无效链接） */
    const badImg = keys.filter((k) => {
      const u = raw.materials[k].imageUrl;
      return u && !/^https:\/\//.test(u);
    });
    ok(`[${nd.id}] imageUrl 为空或 https（不编造）`, badImg.length === 0, badImg.join(', '));
  }

  /* 术语表 + 主题 */
  const termCount = Object.keys(d?.domainTerms || {}).length;
  ok(`[${nd.id}] 术语表条数 >= 30`, termCount >= 30, `${termCount} 条`);
  ok(`[${nd.id}] 有视觉主题 label`, Boolean(d?.theme?.label), d?.theme?.label || '缺失');
  ok(`[${nd.id}] 主题符合要求（含「${nd.themeHint}」）`, String(d?.theme?.label || '').includes(nd.themeHint), d?.theme?.label);
  ok(`[${nd.id}] 有 generationPrompt`, Boolean(d?.generationPrompt), '');
  ok(`[${nd.id}] 有 excludedTerms 黑名单`, Array.isArray(d?.excludedTerms) && d.excludedTerms.length > 0, `${(d?.excludedTerms || []).length} 条`);
  ok(`[${nd.id}] 术语权重分级已配置`, Boolean(d?.domainTermTiers), '');
}

/* 王者荣耀官方译名抽查（来源：pvp.qq.com / 游戏内中文界面） */
const hok = wb.getDomainDetail('honor_of_kings');
const HOK_EXPECT = {
  lane: '分路', clashLane: '对抗路', midLane: '中路', farmLane: '发育路',
  jungle: '野区', jungler: '打野', tank: '坦克', fighter: '战士',
  assassin: '刺客', mage: '法师', marksman: '射手', support: '辅助',
  turret: '防御塔', minion: '小兵', lord: '主宰', tyrant: '暴君',
  crystal: '水晶', stun: '眩晕', silence: '沉默', knockUp: '击飞',
};
const hokBad = Object.entries(HOK_EXPECT).filter(([k, v]) => hok?.domainTerms?.[k] !== v);
ok('王者荣耀官方译名抽查（20 项）', hokBad.length === 0, hokBad.map(([k, v]) => `${k}≠${v}`).join(', '));

/* 无畏契约官方译名抽查（来源：val.qq.com 国服官网特工编号表） */
const val = wb.getDomainDetail('valorant');
const VAL_EXPECT = {
  duelist: '决斗', initiator: '先锋', controller: '控场', sentinel: '哨卫',
  breach: '铁臂', jett: '捷风', raze: '雷兹', omen: '幽影', brimstone: '炼狱',
  phoenix: '不死鸟', sage: '贤者', sova: '猎枭', viper: '蝰蛇', cypher: '零',
  reyna: '芮娜', killjoy: '奇乐', skye: '斯凯', yoru: '夜露', astra: '星礈',
  chamber: '尚勃勒', neon: '霓虹', fade: '黑梦', harbor: '海神', gekko: '盖可',
  deadlock: '钢锁', iso: '壹决', clove: '暮蝶', vyse: '维斯', tejo: '钛狐',
  waylay: '幻棱', veto: '禁灭', miks: '迷核',
  spike: '爆能器', plant: '安放', defuse: '拆除', site: '据点',
};
const valBad = Object.entries(VAL_EXPECT).filter(([k, v]) => val?.domainTerms?.[k] !== v);
ok(`无畏契约官方译名抽查（${Object.keys(VAL_EXPECT).length} 项）`, valBad.length === 0, valBad.map(([k, v]) => `${k}≠${v}`).join(', '));

/* 中国台湾地区译名不得混入（特战英豪体系与国服完全不同） */
const TW_LEAK = ['苏法', '瑟符', '布史东', '圣祈', '薇蝮', '叛奇', '欧门', '钱博尔', '亚星卓'];
const twLeak = TW_LEAK.filter((t) => Object.values(val?.domainTerms || {}).includes(t));
ok('无畏契约未混入中国台湾地区译名', twLeak.length === 0, twLeak.join(', '));

/* 两个领域能正常筛选相关词 + 挂载材料 */
for (const nd of NEW_DOMAINS) {
  const { words } = await study.buildRelatedWords(nd.id, { localLimit: 600 });
  ok(`[${nd.id}] 相关词筛选有结果`, words.length >= 10, `${words.length} 词`);

  const sample = words.slice(0, 60);
  const hydrated = await study.hydrateCards(nd.id, sample);
  const withDomains = hydrated.filter((w) => Array.isArray(w.domains) && w.domains.length);
  const withMatField = hydrated.filter((w) => 'material' in w);
  ok(`[${nd.id}] 卡片挂载 domains`, withDomains.length === hydrated.length, `${withDomains.length}/${hydrated.length}`);
  ok(`[${nd.id}] 卡片挂载 material 字段`, withMatField.length === hydrated.length, `${withMatField.length}/${hydrated.length}`);

  const stats = await dms.getMaterialStats(nd.id);
  ok(`[${nd.id}] 材料统计可用（total/source/unverified）`,
    stats.total > 0 && typeof stats.unverified === 'number' && typeof stats.sourced === 'number',
    `total=${stats.total} sourced=${stats.sourced} unverified=${stats.unverified}`);
  ok(`[${nd.id}] 全部材料都写了 source`, stats.sourced === stats.total, `${stats.sourced}/${stats.total}`);
}

/* 领域主题不得重复（各自独立配色） */
const themeIds = new Set(allDomains.map((d) => d.theme?.id));
ok('领域主题互不重复（各自独立配色）', themeIds.size === allDomains.length, `${themeIds.size}/${allDomains.length}`);

/* ==========================================================================
 * 任务二：复习模式 = 收藏夹专属 + 预生成例句
 * ======================================================================= */
console.log('\n—— 任务二：收藏夹专属复习 ——');

/* 准备：往收藏夹里放几张卡（跨领域，验证多领域聚合） */
await ds.clearAll();
const F = [
  ['slay_the_spire', 'ascension'],
  ['slay_the_spire', 'barrier'],
  ['hollow_knight', 'ritual'],
  ['honor_of_kings', 'arena'],
  ['valorant', 'lethal'],
];
for (const [d, w] of F) await ds.setFavorite(d, w, true);

const favKeys = await ds.getFavoriteKeys();
ok('收藏夹已准备 5 张跨领域卡', favKeys.length === 5, favKeys.join(', '));

/* 2.1 题目池只来自收藏夹 */
const pool = await quiz.getQuestionPool(quiz.QUIZ_SOURCES.FAVORITES);
ok('收藏夹题目池条数 = 收藏数', pool.length === 5, `${pool.length} 条`);
const poolWords = pool.map((p) => p.word.toLowerCase()).sort();
const favWords = F.map(([, w]) => w).sort();
ok('题目池 = 收藏的词（不多不少）', JSON.stringify(poolWords) === JSON.stringify(favWords), poolWords.join(', '));
ok('题目池每条都带 material', pool.every((p) => p.material && typeof p.material === 'object'), '');
ok('题目池每条都带 domainId', pool.every((p) => Boolean(p.domainId)), pool.map((p) => p.domainId).join(', '));

/* 2.2 出题：选择题 + 每题恰好 1 个正确项 */
const favWordSet = new Set(favWords);
let allChoice = true;
let exactlyOneCorrect = true;
let promptInFav = true;
let optsOk = true;
let typeCount = { en2zh: 0, zh2en: 0 };
let rounds = 0;
for (let i = 0; i < 12; i++) {
  const qs = await quiz.buildQuiz(
    { source: quiz.QUIZ_SOURCES.FAVORITES, type: quiz.QUIZ_TYPES.MIXED, count: 5 },
    {},
  );
  rounds += 1;
  for (const q of qs) {
    if (!['en2zh', 'zh2en'].includes(q.type)) { allChoice = false; }
    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    const correct = q.options.filter((o) => o.correct);
    if (correct.length !== 1) exactlyOneCorrect = false;
    if (q.options.length !== 4) optsOk = false;
    if (!favWordSet.has(String(q.word).toLowerCase())) promptInFav = false;
  }
}
ok(`出题 12 轮共题目均来自收藏夹`, promptInFav, `收藏词: ${favWords.join(', ')}`);
ok('题型均为选择题（en2zh / zh2en）', allChoice, JSON.stringify(typeCount));
ok('两种题型都出现过', typeCount.en2zh > 0 && typeCount.zh2en > 0, `en2zh=${typeCount.en2zh} zh2en=${typeCount.zh2en}`);
ok('每题恰好 1 个正确选项', exactlyOneCorrect, '');
ok('每题 4 个选项', optsOk, '');

/* 2.3 干扰项：优先收藏夹，不足时回退全量词库 */
const q1 = (await quiz.buildQuiz(
  { source: quiz.QUIZ_SOURCES.FAVORITES, type: quiz.QUIZ_TYPES.EN_TO_ZH, count: 5 }, {},
)).find((q) => q.type === 'en2zh');
ok('英译中题干为英文单词', q1 && q1.prompt === q1.word, q1 ? `${q1.prompt} → ${q1.word}` : '');
const wrongOpts = q1.options.filter((o) => !o.correct).map((o) => o.text);
ok('干扰项不含正确项文案', !wrongOpts.includes(q1.options.find((o) => o.correct)?.text), '');
ok('干扰项有 3 个且互不相同', new Set(wrongOpts).size === 3, wrongOpts.join(' | '));

/* 收藏夹只有 5 张时，中译英题目的干扰项必须能靠回退池补齐（否则出不了题） */
let zh2enOk = 0;
for (let i = 0; i < 8; i++) {
  const qs = await quiz.buildQuiz(
    { source: quiz.QUIZ_SOURCES.FAVORITES, type: quiz.QUIZ_TYPES.ZH_TO_EN, count: 5 }, {},
  );
  if (qs.length > 0 && qs.every((q) => q.options.length === 4)) zh2enOk += 1;
}
ok('收藏夹规模较小时中译英仍能出满 4 选项', zh2enOk === 8, `${zh2enOk}/8 轮`);

/* 2.4 例句来自预生成材料，不是运行时生成 */
const EXAMPLE_CHECK = {
  slay_the_spire: 'ascension',
  hollow_knight: 'ritual',
  honor_of_kings: 'arena',
  valorant: 'lethal',
};
let exOk = 0;
for (const [dId, w] of Object.entries(EXAMPLE_CHECK)) {
  const mat = (await dms.getMaterials(dId))[w];
  const hit = pool.find((p) => p.word.toLowerCase() === w && p.domainId === dId);
  if (mat?.example && hit?.material?.example === mat.example) exOk += 1;
}
ok('题目携带的例句 === 材料文件里的例句', exOk === Object.keys(EXAMPLE_CHECK).length,
  `${exOk}/${Object.keys(EXAMPLE_CHECK).length} 条一致`);

/* 材料里同时有英文例句与中文翻译（供卡片直出） */
const matArena = (await dms.getMaterials('honor_of_kings')).arena;
ok('材料含英文例句 example', Boolean(matArena?.example), matArena?.example);
ok('材料含例句中文 exampleZh', Boolean(matArena?.exampleZh), matArena?.exampleZh);
ok('材料含 imageUrl 字段（可为空串）', 'imageUrl' in (matArena || {}), JSON.stringify(matArena?.imageUrl));

/* 2.5 全程零网络请求（复习出题 / 判分 / 查历史 都不应 fetch） */
await dms.getMaterials('valorant');           // 预热材料缓存
await dms.getMaterials('honor_of_kings');
await dms.getMaterials('slay_the_spire');
const before = fetchCount;
for (let i = 0; i < 5; i++) {
  const qs = await quiz.buildQuiz({ source: quiz.QUIZ_SOURCES.FAVORITES, type: quiz.QUIZ_TYPES.MIXED, count: 5 }, {});
  for (const q of qs) {
    const correct = q.options.find((o) => o.correct);
    await quiz.submitQuizAnswer(q, correct.text);
  }
}
await quiz.getWordHistory('ascension');
await quiz.getHistorySummaryMap(pool);
const after = fetchCount;
ok('复习出题 + 判分 + 查历史全程零网络请求', after === before, `fetch 增加 ${after - before} 次`);

/* 2.6 答题历史：可记录、可按词查、可汇总 */
const hist = await quiz.getWordHistory('ascension');
ok('getWordHistory 返回该词统计', hist.total > 0, `total=${hist.total} correct=${hist.correct} accuracy=${Math.round(hist.accuracy * 100)}%`);
ok('getWordHistory 带逐条记录（含时间与对错）',
  hist.records.length > 0 && hist.records.every((r) => typeof r.correct === 'boolean' && r.at > 0),
  `${hist.records.length} 条`);
ok('getWordHistory lastAt 存在', hist.lastAt > 0, new Date(hist.lastAt).toISOString());

const summaryMap = await quiz.getHistorySummaryMap(pool);
/* 返回的是 Map（key = `${domainId}::${word}`），不是普通对象 */
ok('getHistorySummaryMap 覆盖作答过的词',
  summaryMap instanceof Map && summaryMap.size > 0,
  [...(summaryMap.keys?.() || [])].join(', '));

/* 历史按领域隔离（同词不同领域不互相污染）—— 显式按签名 (domainId, word, correct) 落库 */
await quiz.submitQuizAnswer(
  { word: 'ascension', type: quiz.QUIZ_TYPES.EN_TO_ZH, domainId: 'hollow_knight', options: [{ text: '错', correct: false }] },
  '错',
);
const histSlay = await quiz.getWordHistory('ascension', { domainId: 'slay_the_spire' });
const histHK = await quiz.getWordHistory('ascension', { domainId: 'hollow_knight' });
ok('答题历史按领域隔离', histSlay.total >= 1 && histHK.total >= 1 && histHK.wrong >= 1,
  `slay=${histSlay.total} hk=${histHK.total}/wrong=${histHK.wrong}`);
ok('同词跨领域查询互不串台',
  histSlay.records.every((r) => r.domainId === 'slay_the_spire') &&
  histHK.records.every((r) => r.domainId === 'hollow_knight'),
  '');

/* 2.7 复习模式的边界：收藏夹 < 2 张时不出题（由 homePage 提示，服务层返回空池） */
await ds.clearFavorites();
await ds.setFavorite('slay_the_spire', 'ascension', true);
const thinPool = await quiz.getQuestionPool(quiz.QUIZ_SOURCES.FAVORITES);
const thinQuiz = await quiz.buildQuiz({ source: quiz.QUIZ_SOURCES.FAVORITES, type: quiz.QUIZ_TYPES.MIXED, count: 10 }, {});
ok('收藏仅 1 张时题目池只有 1 条', thinPool.length === 1, `${thinPool.length} 条`);
ok('收藏不足时不会硬凑出题目', thinQuiz.length <= 2, `${thinQuiz.length} 题（可容忍 0~2）`);

/* 2.8 收藏夹里「不在词库」的词也能出题（不被静默丢弃） */
await ds.clearFavorites();
await ds.setFavorite('slay_the_spire', 'ascension', true);
await ds.setFavorite('slay_the_spire', 'notarealword', true);
const poolWithGhost = await quiz.getQuestionPool(quiz.QUIZ_SOURCES.FAVORITES);
ok('不在词库的收藏词仍保留在题目池', poolWithGhost.some((p) => p.word === 'notarealword'),
  poolWithGhost.map((p) => p.word).join(', '));
ok('不在词库的收藏词标记 __missingInBank',
  poolWithGhost.find((p) => p.word === 'notarealword')?.__missingInBank === true, '');

/* ==========================================================================
 * 汇总
 * ======================================================================= */
console.log('\n================ 结果 ================');
for (const line of pass) console.log(line);
if (fail.length) {
  console.log('\n--- 失败项 ---');
  for (const line of fail) console.log(line);
}
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
