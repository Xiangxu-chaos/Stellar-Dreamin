/**
 * 卡片背面「英文例句」区域渲染契约（已随兜底逻辑下线而更新）。
 *
 * 历史：曾用 `if (material?.example)` 藏起整块例句区 → 补成「造句练习」/「暂无例句」
 *       兜底 → 再改为 localDomainHint 领域提示。这些兜底全部是废话，已彻底删除。
 *
 * 现行契约（不可回退）：
 *   有 material.example → 渲染「英文例句」标签 + 真实例句 + 中文翻译
 *   无 material         → 「英文例句」「领域关联」区块**整块隐藏**，
 *                         且不得出现「暂无例句」等任何占位 / 兜底话术
 *
 * 本测试直接驱动真实 WordCard 组件，断言：
 *   A. 有材料的词（lane）→ 渲染「英文例句」标签 + 真实例句
 *   B. 无材料的词（basement）→ 不渲染例句区、不渲染领域关联区、无任何兜底文案
 *   C. 四个领域各取样本 → 例句区均存在且包含该单词
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

/* ---------- 最小 DOM shim（够 WordCard 用） ---------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.childNodes = this.children;
    this.attributes = {};
    this.style = new Proxy({ setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; } });
    this.dataset = {};
    this._text = null;
    this._cls = new Set();
    this.nodeType = 1;
    this.parentNode = null;
    this._ev = {};
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
  cloneNode() { return new El(this.tagName); }
  contains(n) { if (n === this) return true; return this.children.some((c) => c.nodeType === 1 && c.contains(n)); }
  closest(sel) { let n = this; while (n) { if (n.nodeType === 1) { const m = sel.startsWith('.') ? n._cls.has(sel.slice(1)) : n.tagName === sel.toUpperCase(); if (m) return n; } n = n.parentNode || n.parentEl; } return null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); }
  removeEventListener() {}
  dispatchEvent(e) { (this._ev[e.type] || []).forEach((f) => f(e)); return true; }
  get textContent() { if (this._text != null) return this._text; return this.children.map((c) => c.textContent || '').join(''); }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get innerHTML() { return this._html || this.textContent; }
  set innerHTML(v) { this._html = String(v); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.nodeType !== 1) continue; if (match(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  matches(sel) { return match(this, sel); }
}
class TextNode {
  constructor(t) { this.nodeType = 3; this._t = String(t); this.parentNode = null; }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); }
}
function match(el, sel) {
  return sel.split(',').map((s) => s.trim()).some((s) => {
    if (s.startsWith('.')) return el._cls.has(s.slice(1));
    if (s.startsWith('[')) { const k = s.slice(1, -1).split('=')[0]; return k in el.attributes; }
    return el.tagName === s.toUpperCase();
  });
}

globalThis.Node = El; globalThis.HTMLElement = El; globalThis.Element = El; globalThis.Text = TextNode;
globalThis.document = {
  createElement: (t) => new El(t),
  createElementNS: (_ns, t) => new El(t),
  createTextNode: (t) => new TextNode(t),
  body: new El('body'), documentElement: new El('html'),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404 ' + p); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};

/* ---------- 驱动真实组件 ---------- */
const { createWordCard } = await import('../src/components/wordCard.js');
const dms = await import('../src/services/domainMaterialService.js');

const DOMAINS = {
  honor_of_kings: 'honorOfKings',
  valorant: 'valorant',
  slay_the_spire: 'slayTheSpire',
  hollow_knight: 'hollowKnight',
};
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'src/data/domainMaterials', f + '.json'), 'utf8'));

/* A. 有材料（lane @ honor_of_kings）：同领域内“有材料”的对照组 */
const hokJson = load('honorOfKings');
const laneMaterial = hokJson.materials.lane;
ok('A. honorOfKings.json 中 lane 确有预生成材料', Boolean(laneMaterial) && Boolean(laneMaterial.example), laneMaterial?.example);
const laneCard = await createWordCard({
  word: { word: 'lane', translation: 'n. 小巷，车道', domainId: 'honor_of_kings' },
  material: laneMaterial,
  domain: { id: 'honor_of_kings', name: '王者荣耀', subtitle: 'Honor of Kings' },
});
const laneText = laneCard.textContent;
ok('A. lane(有材料) 渲染「英文例句」标签', laneText.includes('英文例句'));
ok('A. lane 显示真实例句（非造句提示）', !laneText.includes('造句练习') && /lane/i.test(laneText));
console.log('   [lane 例句区]', (laneCard.querySelector('.mat__value--example') || {}).textContent);

/* B. 无材料（basement @ honor_of_kings）：整块隐藏，且不得有任何兜底废话 */
const hok = load('honorOfKings');
const hadMaterial = Boolean(hok.materials.basement);
delete hok.materials.basement; // 模拟“没有预生成材料”
const basementCard = await createWordCard({
  word: { word: 'basement', translation: 'n. 地下室', domainId: 'honor_of_kings' },
  domain: { id: 'honor_of_kings', name: '王者荣耀', subtitle: 'Honor of Kings' },
});
const basementText = basementCard.textContent;
ok('B. basement(无材料) 不渲染「英文例句」区块', !basementText.includes('英文例句'), basementText.slice(0, 120));
ok('B. basement(无材料) 不渲染「领域关联」区块', !basementText.includes('领域关联'), basementText.slice(0, 120));
const BANNED = ['暂无例句', '暂无预生成材料', '造句练习', 'Your turn', '自己造一句',
  '较为常见', '较常见', '可联想', '可以建立', '可结合场景', '可用以', '与之相关',
  '该词与当前领域暂无直接对应关系'];
ok('B. basement 无任何占位 / 兜底废话文案',
  !BANNED.some((b) => basementText.includes(b)), BANNED.filter((b) => basementText.includes(b)).join(', '));
ok('B. basement(无材料) 仍保留通用释义等真实字段', basementText.includes('通用释义'));
if (hadMaterial) hok.materials.basement; // 还原（不改磁盘）

/* C. 四个领域各取一个真实词，例句必须真实存在且包含该词 */
for (const [domainId, file] of Object.entries(DOMAINS)) {
  const j = load(file);
  const word = Object.keys(j.materials)[0];
  const m = j.materials[word];
  const card = await createWordCard({
    word: { word, domainId },
    material: m,
    domain: { id: domainId, name: j.domainName, subtitle: j.gameNameEn },
  });
  const ex = card.querySelector('.mat__value--example');
  const exText = (ex || {}).textContent || '';
  ok(`C. ${j.gameNameEn} (${word}) 例句区存在且有文本`, exText.length > 5, exText);
  ok(`C. ${j.gameNameEn} (${word}) 例句包含该单词本身`,
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(exText), exText);
}

/* D. 翻转卡片（flipCard）同一条契约：无材料 → 只留生成入口，不显示任何兜底 */
const { createFlipCard } = await import('../src/components/flipCard.js');
const flipProps = (material) => ({
  word: { word: 'basement', translation: '地下室', type: 'core' },
  material,
  domain: { id: 'honor_of_kings', name: '王者荣耀' },
  relevance: { level: 'vocab', score: 60 },
});
const flipNoMat = createFlipCard(flipProps(null)).textContent;
ok('D. flipCard 无材料时不渲染「领域关联」', !flipNoMat.includes('领域关联'), flipNoMat.slice(0, 120));
ok('D. flipCard 无材料时不渲染「英文例句」', !flipNoMat.includes('英文例句'), flipNoMat.slice(0, 120));
ok('D. flipCard 无材料时无占位 / 兜底废话',
  !BANNED.some((b) => flipNoMat.includes(b)), BANNED.filter((b) => flipNoMat.includes(b)).join(', '));
ok('D. flipCard 无材料时仍保留「生成记忆材料」入口', flipNoMat.includes('生成记忆材料'));

const flipWithMat = createFlipCard(flipProps({
  root: 'base', generalMeaning: 'n. 地下室', domainMeaning: '（材料）领域释义',
  story: '（材料）一段足够长的具体场景微故事，用来触发区块渲染。',
  example: 'The basement of the base hid a secret passage.', exampleZh: '基地的地下室藏着一条密道。',
})).textContent;
ok('D. flipCard 有材料时渲染「领域关联」与「英文例句」',
  flipWithMat.includes('领域关联') && flipWithMat.includes('英文例句'), flipWithMat.slice(0, 120));

/* ---------- 结果 ---------- */
console.log('=== 问题二回归：卡片英文例句区 ===\n');
console.log(pass.join('\n'));
if (fail.length) console.log('\n--- 失败 ---\n' + fail.join('\n'));
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
