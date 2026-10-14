/**
 * verifyExampleSource.mjs —— 空洞骑士例句出处与关联度回归校验（本轮增量）
 * ============================================================================
 * 对应反馈：空洞骑士领域部分例句来自 Fandom Wiki，内容是泛化剧情描述，
 *           通篇没有游戏专有名词，用户看不出「这跟空洞骑士有什么关系」。
 *
 * 校验内容：
 *  A. src/data/domainMaterials/hollowKnight.json
 *     1. 每条材料都有非空 exampleSource，取值在允许集合内
 *     2. Fandom 来源的条目：exampleSource ∈ {Fandom Wiki, AI重写}，不可能是别值
 *     3. exampleSource === 'Fandom Wiki' 的条目：例句必须含空洞骑士专有名词
 *     4. exampleSource === 'AI重写' 的条目：例句必须含专有名词 **且** 含该单词
 *     5. example / exampleZh 均非空
 *  B. 与重写脚本工具表的一致性（tools/addExampleSource.mjs）
 *     6. 重写表每条都在 JSON 里真实生效（example === REWRITES[word].en）
 *     7. JSON 中 AI重写 条数 === 重写表条数
 *     8. 重写表本身每条都含专名、含该词（防止未来往表里塞坏句子）
 *  C. 数据层与渲染层
 *     9. domainMaterialService.normalizeMaterial 保留 exampleSource 字段
 *    10. wordCard 背面 / detailModal 例句区渲染「例句来源：xxx」
 *    11. 对应 CSS 类 .mat__example-src / .detail__example-src 有定义
 *    12. 动态：用真实材料建卡片，DOM 里能读到 .mat__example-src
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MATERIAL_FILE = 'src/data/domainMaterials/hollowKnight.json';
const ALLOWED = new Set(['Fandom Wiki', 'AI重写', '游戏内文本', 'AI 生成']);

/* 直接复用 addExampleSource.mjs 导出的白名单与重写表，避免两份定义漂移。
 * 该脚本已做「仅在直接执行时跑主流程」的守卫，import 不会写盘。 */
const tool = await import('./addExampleSource.mjs');
const NOUNS = tool.HK_PROPER_NOUNS;
const TABLE = tool.REWRITES;

/** 空洞骑士专有名词判定（与 addExampleSource.mjs 共用同一份白名单） */
function hasProperNounIn(text) {
  return NOUNS.some((n) => String(text || '').includes(n));
}

/* ==========================================================================
   一、数据层断言
   ========================================================================== */
const json = JSON.parse(read(MATERIAL_FILE));
const materials = json.materials || {};
const words = Object.keys(materials);
ok('hollowKnight.json 可解析且材料非空', words.length > 0, `${words.length} 条`);

const noSource = [];
const badValue = [];
const badZh = [];
const badEn = [];
const fandomBadMark = [];
const fandomNoNoun = [];
const rewrittenNoNoun = [];
const rewrittenNoWord = [];
const srcStats = {};

for (const w of words) {
  const m = materials[w];
  const es = m.exampleSource;
  if (typeof es !== 'string' || !es.trim()) noSource.push(w);
  else {
    srcStats[es] = (srcStats[es] || 0) + 1;
    if (!ALLOWED.has(es)) badValue.push(`${w}:${es}`);
  }
  if (!String(m.example || '').trim()) badEn.push(w);
  if (!String(m.exampleZh || '').trim()) badZh.push(w);

  const isFandom = /Fandom/i.test(String(m.source || ''));
  if (isFandom && !(es === 'Fandom Wiki' || es === 'AI重写')) fandomBadMark.push(`${w}:${es}`);
  if (es === 'Fandom Wiki' && !hasProperNounIn(m.example)) fandomNoNoun.push(w);
  if (es === 'AI重写') {
    if (!hasProperNounIn(m.example)) rewrittenNoNoun.push(w);
    if (!String(m.example).toLowerCase().includes(w.toLowerCase())) rewrittenNoWord.push(w);
  }
}

ok('1. 每条材料都有非空 exampleSource', noSource.length === 0,
  noSource.length ? `${noSource.length} 条缺失：${noSource.slice(0, 8).join(', ')}` : `${words.length} 条`);
ok('1b. exampleSource 取值均在允许集合内', badValue.length === 0, badValue.slice(0, 6).join(', '));
ok('5. 每条材料 example 非空', badEn.length === 0, badEn.length ? `${badEn.length} 条` : `${words.length} 条`);
ok('5b. 每条材料 exampleZh 非空', badZh.length === 0, badZh.length ? `${badZh.length} 条` : `${words.length} 条`);

ok('2. Fandom 来源条目的 exampleSource 只能是「Fandom Wiki / AI重写」', fandomBadMark.length === 0,
  fandomBadMark.slice(0, 8).join(', '));
ok('3. 标为 Fandom Wiki 的例句必须含空洞骑士专有名词', fandomNoNoun.length === 0,
  fandomNoNoun.length ? `${fandomNoNoun.length} 条：${fandomNoNoun.slice(0, 8).join(', ')}` : '全部通过');
ok('4. 标为 AI重写 的例句必须含专有名词', rewrittenNoNoun.length === 0,
  rewrittenNoNoun.length ? `${rewrittenNoNoun.length} 条：${rewrittenNoNoun.slice(0, 8).join(', ')}` : '全部通过');
ok('4b. 标为 AI重写 的例句必须包含该单词本身', rewrittenNoWord.length === 0,
  rewrittenNoWord.length ? `${rewrittenNoWord.length} 条：${rewrittenNoWord.slice(0, 8).join(', ')}` : '全部通过');

const dist = Object.entries(srcStats).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k}=${v}`).join(' · ');
ok('例句出处分布已落在四类里', Object.keys(srcStats).length <= 4, dist);

/* ==========================================================================
   二、与重写脚本的一致性（复用 0 节导入的 TABLE）
   ========================================================================== */
const tableKeys = Object.entries(TABLE).map(([word, v]) => ({ word, en: v.en, zh: v.zh }));

const aiRewriteWords = words.filter((w) => materials[w].exampleSource === 'AI重写');
ok('7. 重写表条数与 JSON 中 AI重写 条数一致',
  tableKeys.length === aiRewriteWords.length, `表 ${tableKeys.length} / JSON ${aiRewriteWords.length}`);

const tableMismatch = [];
const tableBadSentence = [];
for (const t of tableKeys) {
  const m = materials[t.word];
  if (!m || m.example !== t.en) tableMismatch.push(t.word);
  if (!hasProperNounIn(t.en)) tableBadSentence.push(`${t.word}(缺专名)`);
  if (!t.en.toLowerCase().includes(t.word.toLowerCase())) tableBadSentence.push(`${t.word}(缺该词)`);
  if (!String(t.zh || '').trim()) tableBadSentence.push(`${t.word}(缺中文)`);
}
ok('6. 重写表每条都在 JSON 中真实生效', tableMismatch.length === 0,
  tableMismatch.slice(0, 8).join(', '));
ok('8. 重写表本身每条都含专名且含该词', tableBadSentence.length === 0,
  tableBadSentence.slice(0, 8).join(', '));

/* ==========================================================================
   三、数据层 / 渲染层
   ========================================================================== */
const svcSrc = read('src/services/domainMaterialService.js');
const hasField = /exampleSource:\s*m\.exampleSource\s*\|\|\s*''/.test(code(svcSrc));
ok('9. normalizeMaterial 保留 exampleSource 字段', hasField, hasField ? '已归一化' : '未找到 exampleSource 归一化');

const cardSrc = code(read('src/components/wordCard.js'));
const detailSrc = code(read('src/components/detailModal.js'));
ok('10. wordCard 例句区渲染「例句来源」', /mat__example-src/.test(cardSrc) && /例句来源：/.test(cardSrc));
ok('10b. detailModal 例句区渲染「例句来源」', /detail__example-src/.test(detailSrc) && /例句来源：/.test(detailSrc));

const css = read('src/styles/components.css');
ok('11. .mat__example-src 有样式定义', /\.mat__example-src\s*\{/.test(css));
ok('11b. .detail__example-src 有样式定义', /\.detail__example-src\s*\{/.test(css));

/* ---- 动态：真实材料 → 卡片 DOM 能读到「例句来源」 ---- */
installShim();
const { createWordCard } = await import('../src/components/wordCard.js');
const sample = ['blight', 'throne', 'legacy'].filter((w) => materials[w]);
let domMiss = [];
for (const w of sample) {
  const m = materials[w];
  const card = createWordCard({
    word: { word: w, domainId: 'hollow_knight' },
    material: m,
    domain: { id: 'hollow_knight', name: '空洞骑士' },
  });
  const el = card.querySelector('.mat__example-src');
  const txt = el ? el.textContent : '';
  if (!el || !txt.includes(m.exampleSource)) domMiss.push(`${w}(缺渲染)`);
}
ok('12. 卡片 DOM 中能读到「例句来源：xxx」', domMiss.length === 0, domMiss.join(', '));

/* ==========================================================================
   最小 DOM shim（只为本脚本的动态断言服务）
   ========================================================================== */
function installShim() {
  if (globalThis.__exSrcShim) return;
  globalThis.__exSrcShim = true;

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.childNodes = this.children;
      this.attributes = {};
      this.style = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'setProperty' || k === 'removeProperty' ? () => {} : '')), set: (t, k, v) => { t[k] = v; return true; } });
      this.dataset = {}; this._text = null; this._cls = new Set(); this.nodeType = 1; this.parentNode = null; this._ev = {};
      this.classList = { add: (...c) => c.filter(Boolean).forEach((x) => String(x).split(/\s+/).filter(Boolean).forEach((y) => this._cls.add(y))), remove: (...c) => c.forEach((x) => this._cls.delete(x)), contains: (c) => this._cls.has(c), toggle: (c, f) => { const on = f === undefined ? !this._cls.has(c) : !!f; on ? this._cls.add(c) : this._cls.delete(c); return on; }, get length() { return this._cls.size; } };
    }
    get className() { return [...this._cls].join(' '); } set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    appendChild(c) { if (c == null) return c; this.children.push(c); if (c.nodeType === 1) c.parentNode = this; return c; }
    append(...cs) { cs.forEach((c) => { if (c == null) return; this.appendChild(typeof c === 'string' ? new TN(c) : c); }); }
    replaceChildren(...cs) { this.children.length = 0; this.append(...cs); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i >= 0) { this.children.splice(i, 0, c); c.parentNode = this; } else this.appendChild(c); return c; }
    cloneNode() { return new El(this.tagName); }
    contains(n) { if (n === this) return true; return this.children.some((c) => c.nodeType === 1 && c.contains(n)); }
    closest(sel) { let n = this; while (n) { if (n.nodeType === 1) { const m = sel.startsWith('.') ? n._cls.has(sel.slice(1)) : n.tagName === sel.toUpperCase(); if (m) return n; } n = n.parentNode; } return null; }
    setAttribute(k, v) { this.attributes[k] = String(v); } getAttribute(k) { return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; } hasAttribute(k) { return k in this.attributes; }
    addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); } removeEventListener() {}
    get textContent() { if (this._text != null) return this._text; return this.children.map((c) => c.textContent || '').join(''); }
    set textContent(v) { this._text = String(v); this.children.length = 0; }
    get innerHTML() { return this._text || ''; } set innerHTML(v) { this._text = String(v); }
    get firstChild() { return this.children[0] || null; }
    querySelector(sel) { return this._qa(sel)[0] || null; }
    querySelectorAll(sel) { return this._qa(sel); }
    _qa(sel) { const out = []; const test = (n) => { if (sel.startsWith('.')) return n._cls.has(sel.slice(1)); return n.tagName === sel.toUpperCase(); }; const w = (n) => { for (const c of n.children) { if (c.nodeType !== 1) continue; if (test(c)) out.push(c); w(c); } }; w(this); return out; }
  }
  class TN { constructor(t) { this.nodeType = 3; this._t = String(t); } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }
  globalThis.Node = El; globalThis.HTMLElement = El; globalThis.Element = El; globalThis.Text = TN;
  globalThis.document = { createElement: (t) => new El(t), createElementNS: (_n, t) => new El(t), createTextNode: (t) => new TN(t), body: new El('body'), documentElement: new El('html'), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}

/* ---------------- 输出 ---------------- */
console.log('=========== 空洞骑士例句出处校验 ===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n例句出处分布：${dist}`);
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
