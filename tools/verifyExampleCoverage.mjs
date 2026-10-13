/**
 * 补全后验收：随机抽查 50 个词，验证每个词都能显示「包含该单词本身」的真实英文例句。
 * 用法：node tools/verifyExampleCoverage.mjs
 *
 * 断言：
 *   A. 四个领域「被筛选命中」的每一个词，都必须在材料文件里有条目（零缺口）
 *   B. 每个条目的 example 非空、且包含该单词（或合法词形变化）
 *   C. 每个条目 exampleZh 非空
 *   D. 从四个领域随机抽 50 个词做端到端渲染（真实 WordCard），例句区必须出现该词
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL_DIR = path.join(ROOT, 'src/data/domainMaterials');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404'); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};

/* 词形匹配：把单词与例句都按「可能的变化」比较。
 * 规则（宽松但不易误报）：把例句切成 token，若某 token 与目标词满足下列任一：
 *   1. 完全相同
 *   2. token 以词干开头（词干 = 去掉常见后缀 -s/-es/-ed/-ing/-d）
 *   3. 目标词以 token 开头（少见，但覆盖示例里的截断）
 * 例：defuse ↔ defusing，lane ↔ lanes，ban ↔ banned/banning，slash ↔ slashing
 */
function exampleHasWord(example, word) {
  const ex = String(example || '').toLowerCase();
  const w = String(word || '').toLowerCase().trim();
  if (!w) return false;
  if (ex.includes(w)) return true;
  const stems = new Set([w]);
  for (const suf of ['ing', 'edly', 'ied', 'ed', 'es', 's', 'd']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) stems.add(w.slice(0, w.length - suf.length));
  }
  // 去尾 e：defuse → defus（覆盖 defusing / defused）
  if (w.endsWith('e')) stems.add(w.slice(0, -1));
  // 双写辅音：banned -> ban, banning -> ban
  for (const s of [...stems]) {
    if (/([bdfglmnprt])\1$/.test(s)) stems.add(s.slice(0, -1));
  }
  const tokens = ex.split(/[^a-z']+/).filter(Boolean);
  for (const t of tokens) {
    if (stems.has(t)) return true;
    for (const s of stems) {
      if (s.length >= 4 && (t.startsWith(s) || s.startsWith(t))) return true;
    }
  }
  return false;
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.childNodes = this.children;
    this.attributes = {}; this.style = new Proxy({ setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; } });
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

const wb = await import('../src/services/wordBankService.js');
await wb.ensureLoaded();
const { createWordCard } = await import('../src/components/wordCard.js');

const DOMAINS = { honor_of_kings: 'honorOfKings', slay_the_spire: 'slayTheSpire', hollow_knight: 'hollowKnight', valorant: 'valorant' };

/* --- A/B/C. 逐领域全量核对（不只抽 50） --- */
let grandTotal = 0;
const allEntries = [];  // {domainId, file, word, ex}
for (const [domainId, file] of Object.entries(DOMAINS)) {
  const json = JSON.parse(readFileSync(path.join(MATERIAL_DIR, file + '.json'), 'utf8'));
  const mats = json.materials || {};
  const matched = wb.filterByDomainSync(domainId, { limit: 100000 });
  const haveSet = new Set(Object.keys(mats).map((w) => w.toLowerCase()));

  // A. 零缺口
  const missing = matched.filter((w) => !haveSet.has(w.word.toLowerCase()));
  ok(`A. [${domainId}] 命中词全部有材料（零缺口）`, missing.length === 0,
    missing.length ? `仍缺 ${missing.length}：${missing.slice(0, 8).map((m) => m.word).join(', ')}` : `${matched.length} 词`);

  // B/C. 每条材料 example 含词 + exampleZh 非空
  let badEx = [];
  let badZh = [];
  for (const [word, m] of Object.entries(mats)) {
    if (!String(m.example || '').trim() || !exampleHasWord(m.example, word)) badEx.push(word);
    if (!String(m.exampleZh || '').trim()) badZh.push(word);
    allEntries.push({ domainId, file, word, ex: m.example, m });
  }
  ok(`B. [${domainId}] 所有材料 example 含该词`, badEx.length === 0, badEx.length ? `${badEx.length} 条：${badEx.slice(0, 8).join(', ')}` : `${Object.keys(mats).length} 条`);
  ok(`C. [${domainId}] 所有材料 exampleZh 非空`, badZh.length === 0, badZh.length ? `${badZh.length} 条` : `${Object.keys(mats).length} 条`);
  grandTotal += Object.keys(mats).length;
}
ok(`材料总量`, grandTotal > 0, `${grandTotal} 条`);

/* --- D. 随机 50 词端到端渲染 --- */
const SAMPLE_N = 50;
const shuffled = allEntries.slice().sort(() => Math.random() - 0.5);
const sample = shuffled.slice(0, SAMPLE_N);
let renderFail = 0;
for (const it of sample) {
  const card = await createWordCard({
    word: { word: it.word, domainId: it.domainId },
    material: it.m,
    domain: { id: it.domainId, name: it.domainId },
  });
  const el = card.querySelector('.mat__value--example');
  const text = (el || {}).textContent || '';
  const okWord = exampleHasWord(text, it.word);
  const notFallback = !/暂无语例|造句|Your turn/.test(text);
  if (!okWord || !notFallback) {
    renderFail++;
    if (renderFail <= 5) console.log(`   ✗ ${it.domainId}/${it.word}: "${text}"`);
  }
}
ok(`D. 随机 ${sample.length} 词端到端渲染均含该词且无兜底`, renderFail === 0, renderFail ? `${renderFail} 个不合格` : `全部通过`);

console.log('=== 补全后验收：例句覆盖率 ===\n');
console.log(pass.join('\n'));
if (fail.length) console.log('\n--- 失败 ---\n' + fail.join('\n'));
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
