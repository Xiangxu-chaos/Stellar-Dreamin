/**
 * verifyFeatures4.mjs —— 四大新增功能的数据层与组件层校验
 * ============================================================================
 * 覆盖：
 *   功能一：我的库（userDomains 增删读写 + 首次判定 + getMyDomains 门控）
 *   功能二：复习分组（buildReviewGroups 切分 + quizSessions 落库结构）
 *   功能三：熟词库（toggleMastered / isMastered / getMasteryProgress / 卡片徽标）
 *   功能四：错题本（recordAnswer 计数、错误率、连续答对移出、错误率排序）
 *   分层边界：新增组件不得触碰 localStorage
 * ============================================================================
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pass = [];
const fail = [];
function ok(name, cond, extra = '') {
  (cond ? pass : fail).push(`${cond ? '\u2714' : '\u2718'} ${name}${extra ? ' — ' + extra : ''}`);
}

/* ---------------- DOM / BOM 最小 shim（与 smokeDom 一致的精简版） ---------------- */
class TextNode { constructor(t) { this.nodeType = 3; this._t = String(t); } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    this._ev = {};
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    const self = this;
    this.classList = {
      add(...c) { c.forEach((x) => self._cls.add(x)); },
      remove(...c) { c.forEach((x) => self._cls.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !self._cls.has(c) : !!f; if (on) self._cls.add(c); else self._cls.delete(c); return on; },
      contains(c) { return self._cls.has(c); },
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
  addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); }
  removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  dispatch(t, ev = {}) {
    let node = this;
    while (node) {
      const list = (node._ev && node._ev[t]) || [];
      for (const fn of list) {
        let stopped = false;
        fn({ target: this, currentTarget: node, stopPropagation() { stopped = true; }, preventDefault() {}, ...ev });
        if (stopped) return;
      }
      node = node.parentNode;
    }
  }
  click() { this.dispatch('click', {}); }
  get textContent() { if (this._text !== undefined) return this._text; return this.children.map((c) => c.textContent || '').join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
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
  querySelector(s) { return this._find(s, true); }
  querySelectorAll(s) { return this._find(s, false); }
  contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
  get firstChild() { return this.children[0] || null; }
  insertAdjacentElement(_pos, n) { return this.appendChild(n); }
}

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

/* ---------------- 载入被测模块 ---------------- */
const ds = (await import('../src/services/dataService.js')).default;
const study = (await import('../src/services/studyService.js')).default;
const wb = (await import('../src/services/wordBankService.js')).default;
const { createWordCard } = await import('../src/components/wordCard.js');

/* ==========================================================================
 * 功能一：我的库
 * ======================================================================= */
ok('userDomains 初始为空', (await ds.getUserDomains()).length === 0);

await ds.addUserDomain('honor_of_kings');
await ds.addUserDomain('slay_the_spire');
let mine = await ds.getUserDomains();
ok('addUserDomain 追加两个领域', mine.length === 2 && mine.includes('honor_of_kings'), JSON.stringify(mine));

await ds.addUserDomain('honor_of_kings');   // 重复添加
mine = await ds.getUserDomains();
ok('addUserDomain 幂等（不重复）', mine.length === 2, JSON.stringify(mine));

await ds.removeUserDomain('slay_the_spire');
mine = await ds.getUserDomains();
ok('removeUserDomain 移除生效', mine.length === 1 && mine[0] === 'honor_of_kings', JSON.stringify(mine));

await ds.setUserDomains(['hollow_knight', 'valorant', 'hollow_knight']);
mine = await ds.getUserDomains();
ok('setUserDomains 去重并覆盖', mine.length === 2, JSON.stringify(mine));

const choices = await study.getDomainChoices();
/* 领域数量随扩展兴趣库持续增加，这里断言「等于全部已注册领域」而不是写死数字 */
const registeredDomains = wb.getDomains();
ok('getDomainChoices 返回全部领域并带 inMyLibrary 标记',
  choices.length === registeredDomains.length && choices.length >= 4
    && choices.every((c) => typeof c.inMyLibrary === 'boolean'),
  `${choices.length}/${registeredDomains.length} — ` + choices.map((c) => `${c.id}:${c.inMyLibrary}`).join(', '));

const myDomains = await study.getMyDomains();
ok('getMyDomains 只返回我的库里的领域', myDomains.length === 2
  && myDomains.every((d) => mine.includes(d.id)), myDomains.map((d) => d.id).join(','));

ok('hasChosenDomains 为 true', (await study.hasChosenDomains()) === true);
await ds.setUserDomains([]);
ok('清空后 hasChosenDomains 为 false', (await study.hasChosenDomains()) === false);

/* ==========================================================================
 * 功能三：熟词库与掌握进度
 * ======================================================================= */
await ds.setUserDomains(['slay_the_spire']);

ok('初始未标记熟词', (await ds.isMastered('slay_the_spire', 'barrier')) === false);
let m = await ds.toggleMastered('slay_the_spire', 'barrier');
ok('toggleMastered 打开 → true', m === true);
ok('isMastered 现在为 true', (await ds.isMastered('slay_the_spire', 'barrier')) === true);
m = await ds.toggleMastered('slay_the_spire', 'barrier');
ok('toggleMastered 再切 → false', m === false);
ok('isMastered 回到 false', (await ds.isMastered('slay_the_spire', 'barrier')) === false);

/* 大小写不敏感 */
await ds.setMastered('slay_the_spire', 'Barrier', true);
ok('熟词键大小写不敏感', (await ds.isMastered('slay_the_spire', 'barrier')) === true);

let masteredList = await ds.getMasteredWords();
ok('getMasteredWords 返回 1 条且带 masteredAt',
  masteredList.length === 1 && typeof masteredList[0].masteredAt === 'number',
  JSON.stringify(masteredList[0]));

/* 掌握进度：分子只计词库内单词 */
await ds.setMastered('slay_the_spire', 'zzzznotaword', true);
const prog = await study.getMasteryProgress();
ok('掌握进度分子不含词库外的词', prog.mastered === 1, `mastered=${prog.mastered}`);
ok('掌握进度分母 = 六级词库总数', prog.total > 5000, `total=${prog.total}`);
ok('掌握进度 ratio 在 0~1 之间', prog.ratio >= 0 && prog.ratio <= 1, String(prog.ratio));

/* 熟词库列表构建 */
const masteredWords = await study.buildMasteredWords();
ok('buildMasteredWords 返回词条（含材料挂载字段）', masteredWords.length === 2,
  `${masteredWords.length} 条`);

/* 卡片徽标：标记熟词后渲染「已掌握」 */
const sampleWord = { word: 'barrier', phonetic: '/ˈbæriə/', translation: 'n. 屏障；障碍', root: '核心词', type: 'core', bank: 'cet6', domainId: 'slay_the_spire' };
const masteredCard = createWordCard({ word: sampleWord, material: null, image: '', domain: null, domains: [], mastered: true });
ok('熟词卡片带 is-mastered 类', masteredCard._cls.has('is-mastered'));
ok('熟词卡片渲染「已掌握」徽标', Boolean(masteredCard.querySelector('.wordcard__mastered-badge')));
ok('熟词卡片暴露 __setMastered / __isMastered',
  typeof masteredCard.__setMastered === 'function' && masteredCard.__isMastered() === true);

const plainCard = createWordCard({ word: { ...sampleWord, word: 'frosting' }, material: null, image: '', domain: null, domains: [] });
ok('普通卡片不带 is-mastered', !plainCard._cls.has('is-mastered'));
plainCard.__setMastered(true);
ok('__setMastered(true) 后动态插入徽标', Boolean(plainCard.querySelector('.wordcard__mastered-badge')));
plainCard.__setMastered(false);
ok('__setMastered(false) 后徽标移除', !plainCard.querySelector('.wordcard__mastered-badge'));

/* 卡片背面有「标记为熟词」按钮（传 onToggleMastered 时） */
const withBtn = createWordCard({
  word: { ...sampleWord, word: 'ascension' }, material: null, image: '', domain: null, domains: [],
  onToggleMastered: () => {},
});
ok('卡片背面有「标记为熟词」按钮', Boolean(withBtn.querySelector('.wordcard__master-btn')));

/* 清理熟词，避免影响后续 */
await ds.clearMastered();
ok('clearMastered 清空熟词库', (await ds.getMasteredKeys()).length === 0);

/* ==========================================================================
 * 功能四：错题本与错误统计
 * ======================================================================= */
ok('初始错题本为空', (await ds.getWrongWords()).length === 0);

/* 答错 → 建立记录 */
let r = await ds.recordAnswer('slay_the_spire', 'ascension', false);
ok('答错后记录 wrongCount=1 / totalAttempts=1',
  r.record && r.record.wrongCount === 1 && r.record.totalAttempts === 1,
  JSON.stringify(r.record && { w: r.record.wrongCount, t: r.record.totalAttempts }));

/* 答对 → 只增加 totalAttempts，稀释错误率 */
await ds.recordAnswer('slay_the_spire', 'ascension', true);
let rec = await ds.getWrongRecord('slay_the_spire', 'ascension');
ok('答对后 totalAttempts=2、wrongCount 仍为 1', rec.totalAttempts === 2 && rec.wrongCount === 1,
  JSON.stringify({ w: rec.wrongCount, t: rec.totalAttempts }));
ok('错误率 = 1/2 = 0.5', Math.abs(rec.ratio - 0.5) < 1e-9, String(rec.ratio));

/* 未错过的词答对 → 不进入错题本 */
await ds.recordAnswer('slay_the_spire', 'frosting', true);
ok('从未答错的词不进入错题本', (await ds.isWrongWord('slay_the_spire', 'frosting')) === false);

/* 连续答对 3 次 → 自动移出 */
await ds.recordAnswer('slay_the_spire', 'ascension', true);   // streak 2
ok('连续答对 2 次后仍在', (await ds.isWrongWord('slay_the_spire', 'ascension')) === true);
let r3 = await ds.recordAnswer('slay_the_spire', 'ascension', true);  // streak 3 → 移出
ok('连续答对 3 次返回 removed=true', r3.removed === true);
ok('连续答对 3 次后移出错题本', (await ds.isWrongWord('slay_the_spire', 'ascension')) === false);

/* 答错会重置连续计数（注意：上一步已把记录移出，这里重新累计） */
await ds.recordAnswer('slay_the_spire', 'ascension', false);   // 新记录 wrongCount=1
await ds.recordAnswer('slay_the_spire', 'ascension', true);    // streak=1
await ds.recordAnswer('slay_the_spire', 'ascension', false);   // 重置 streak
rec = await ds.getWrongRecord('slay_the_spire', 'ascension');
ok('答错会重置连续答对计数', (rec.correctStreak || 0) === 0, `streak=${rec.correctStreak}`);
ok('错次累加正确（两次答错 → wrongCount=2）', rec.wrongCount === 2, String(rec.wrongCount));

/* 错误率排序：造一个错误率更高的词 */
await ds.recordAnswer('slay_the_spire', 'barrier', false);
await ds.recordAnswer('slay_the_spire', 'barrier', false);
const sorted = await ds.getWrongWords();
ok('错题本按错误率降序', sorted.length >= 2
  && sorted[0].ratio >= sorted[sorted.length - 1].ratio,
  sorted.map((w) => `${w.word}:${w.ratio.toFixed(2)}`).join(' > '));
ok('barrier（100% 错误率）排在最前', sorted[0].word === 'barrier', sorted[0].word);
ok('每条记录含 ratio 字段', sorted.every((w) => typeof w.ratio === 'number'));

/* 显式移出 */
const removed = await ds.removeFromWrongWords('slay_the_spire', 'barrier');
ok('removeFromWrongWords 返回 true', removed === true);
ok('移出后不在错题本', (await ds.isWrongWord('slay_the_spire', 'barrier')) === false);
const removedAgain = await ds.removeFromWrongWords('slay_the_spire', 'barrier');
ok('重复移出返回 false', removedAgain === false);

/* 错题词条构建（供错题本复习出题） */
const wrongWords = await study.buildWrongWords();
ok('buildWrongWords 返回词条', wrongWords.length >= 1, `${wrongWords.length} 条`);
ok('错题词条带 errorRatio 字段', typeof wrongWords[0].errorRatio === 'number');

/* ==========================================================================
 * 功能二：复习分组
 * ======================================================================= */
/* 准备 5 个收藏词，按每组 2 词切分。
 * ⚠️ 复习现在**按档位过滤**（默认「相关」），所以这里取这 5 个词里词数最多的那一档来验证切分逻辑，
 *    分组规则本身（每组 ≤ N、末组余数、无重复）与档位无关。 */
await ds.clearFavorites();
const PICK = ['ascension', 'barrier', 'frosting', 'escalate', 'ascend'];
for (const w of PICK) await ds.setFavorite('slay_the_spire', w, true);

const wbs = (await import('../src/services/wordBankService.js')).default;
const tiered = await wbs.attachTiers(PICK.map((w) => ({ word: w, domainId: 'slay_the_spire' })));
const tierHist = tiered.reduce((m, x) => { m[x.tier] = (m[x.tier] || 0) + 1; return m; }, {});
const pickTier = Object.entries(tierHist).sort((a, b) => b[1] - a[1])[0][0];
const pickCount = tierHist[pickTier];

ok('未指定档位时默认「相关」',
  (await study.buildReviewGroups({ groupSize: 10 })).tier === 'related');

const prep = await study.buildReviewGroups({ groupSize: 2, includeMastered: true, tier: pickTier });
ok('buildReviewGroups 按档切分出 ceil(n/2) 组',
  prep.totalGroups === Math.ceil(pickCount / 2),
  `tier=${pickTier} n=${pickCount} totalGroups=${prep.totalGroups}`);
ok('每组 ≤ 2 词且首组满员',
  prep.groups.every((g) => g.length <= 2) && prep.groups[0].length === 2,
  prep.groups.map((g) => g.length).join(','));
ok('分组总数 = 该档收藏词数', prep.groups.flat().length === pickCount, `${prep.groups.flat().length}/${pickCount}`);
ok('分组结果无重复词',
  new Set(prep.groups.flat().map((w) => `${w.domainId}::${w.word}`)).size === pickCount);
ok('按档过滤：tier=core 的结果只含 core 档',
  (await study.buildReviewGroups({ groupSize: 50, includeMastered: true, tier: 'core' }))
    .groups.flat().every((w) => w.tier === 'core'));

/* 默认排除熟词 */
const masteredWord = prep.groups.flat()[0].word;
await ds.setMastered('slay_the_spire', masteredWord, true);
const prepNoMastered = await study.buildReviewGroups({ groupSize: 10, includeMastered: false, tier: pickTier });
ok('默认排除熟词', prepNoMastered.excludedMastered === 1, `excluded=${prepNoMastered.excludedMastered}`);
const prepWithMastered = await study.buildReviewGroups({ groupSize: 10, includeMastered: true, tier: pickTier });
ok('勾选「包含熟词」后纳入', prepWithMastered.total === pickCount, `total=${prepWithMastered.total}/${pickCount}`);
await ds.clearMastered();

/* 会话落库结构 */
const sessionRecord = await study.saveGroupResult({
  sessionId: 'qs_test_0001',
  startedAt: 1000,
  finishedAt: 2000,
  groupIndex: 1,
  totalGroups: 3,
  words: [
    { word: 'ascension', domainId: 'slay_the_spire', correct: true },
    { word: 'barrier', domainId: 'slay_the_spire', correct: false },
  ],
});
ok('saveQuizSession 自动补全 wordCount/correctCount/wrongCount',
  sessionRecord.wordCount === 2 && sessionRecord.correctCount === 1 && sessionRecord.wrongCount === 1,
  JSON.stringify({ w: sessionRecord.wordCount, c: sessionRecord.correctCount, x: sessionRecord.wrongCount }));

await study.saveGroupResult({
  sessionId: 'qs_test_0001', startedAt: 2000, finishedAt: 3000, groupIndex: 2, totalGroups: 3,
  words: [{ word: 'frosting', domainId: 'slay_the_spire', correct: true }],
});

const sessions = await ds.getQuizSessions({ sessionId: 'qs_test_0001' });
ok('getQuizSessions 按 sessionId 取回 2 条', sessions.length === 2, `${sessions.length} 条`);
ok('会话按 groupIndex 有序', sessions[0].groupIndex === 1 && sessions[1].groupIndex === 2);
ok('会话记录含 words[] 明细',
  Array.isArray(sessions[0].words) && sessions[0].words.every((x) => 'word' in x && 'correct' in x));

const summary = await study.getSessionSummary('qs_test_0001');
ok('getQuizSessionSummary 聚合正确（3 词 2 对）',
  summary.total === 3 && summary.correct === 2 && summary.wrong === 1 && Math.abs(summary.accuracy - 2 / 3) < 1e-9,
  JSON.stringify(summary));

/* ==========================================================================
 * 导出 / 导入 覆盖新键；clearAll 覆盖新键
 * ======================================================================= */
await ds.setUserDomains(['hollow_knight']);
const dump = await ds.exportAll();
ok('exportAll 含 userDomains', Array.isArray(dump.userDomains) && dump.userDomains.length === 1, JSON.stringify(dump.userDomains));
ok('exportAll 含 quizSessions', Array.isArray(dump.quizSessions) && dump.quizSessions.length === 2, `${(dump.quizSessions || []).length}`);
ok('exportAll 含 masteredWords', dump.masteredWords !== undefined && typeof dump.masteredWords === 'object');
ok('exportAll 含 wrongWords', dump.wrongWords !== undefined && typeof dump.wrongWords === 'object');

await ds.clearAll();
ok('clearAll 清空 userDomains', (await ds.getUserDomains()).length === 0);
ok('clearAll 清空 quizSessions', (await ds.getQuizSessions()).length === 0);
ok('clearAll 清空 wrongWords', (await ds.getWrongWords()).length === 0);
ok('clearAll 清空 masteredWords', (await ds.getMasteredKeys()).length === 0);

/* 旧备份（无新字段）导入不应报错（向后兼容） */
await ds.importAll({ settings: {}, ui: {} });
ok('importAll 兼容旧备份（无新字段）', true);

/* ==========================================================================
 * 分层边界：新增组件不得触碰 localStorage / fetch
 * ======================================================================= */
const newComponents = [
  'src/components/domainPicker.js',
  'src/components/reviewGroupView.js',
  'src/components/wrongWordsView.js',
  'src/components/masteredView.js',
];
const boundaryViolations = [];
for (const rel of newComponents) {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) { boundaryViolations.push(`${rel}: 文件缺失`); continue; }
  const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/localStorage\s*\./.test(code)) boundaryViolations.push(`${rel}: localStorage`);
  if (/[^.\w]fetch\s*\(/.test(code)) boundaryViolations.push(`${rel}: fetch`);
}
ok('新增组件零越界（不碰 localStorage / fetch）', boundaryViolations.length === 0, boundaryViolations.join('; '));

/* homePage 也不得触碰 localStorage */
const homeCode = readFileSync(path.join(ROOT, 'src/pages/homePage.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('homePage 不碰 localStorage', !/localStorage\s*\./.test(homeCode));

/* ---------------- 输出 ---------------- */
console.log('=========== 四大功能校验 ===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
