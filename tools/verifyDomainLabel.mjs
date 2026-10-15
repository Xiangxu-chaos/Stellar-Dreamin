#!/usr/bin/env node
/**
 * verifyDomainLabel.mjs —— 领域名称书名号规则（体育项目不加《》）
 * ============================================================================
 * 锁死：
 *   A. domainLabel() / isTitleQuoted() 的判定逻辑
 *   B. 真实配置：篮球 / 羽毛球 → 无书名号；游戏 / 影视 → 有书名号
 *   C. wordBankService.getDomains() 透传 titleQuoted / category
 *   D. 静态源码：除 core/domainLabel.js 外不得再出现硬编码 `《${`
 *   E. 动态渲染：「领域关联」区块标题遵守书名号规则；
 *      无材料时该区块与「英文例句」区块整块隐藏（不得出现任何兜底废话）
 *   F. 材料 JSON 的 domainName 不含书名号
 *
 * 运行：node tools/verifyDomainLabel.mjs
 * ============================================================================
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, e = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${e ? ' — ' + e : ''}`);

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
    this.style = { setProperty() {} };
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
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 };

/* ==========================================================================
 * A. domainLabel() 单元断言
 * ======================================================================= */
console.log('—— A. domainLabel() 单元断言 ——');
const { domainLabel, isTitleQuoted } = await import('../src/core/domainLabel.js');

ok('A1. 作品（无声明）→ 加书名号', domainLabel({ name: '原神' }) === '《原神》', domainLabel({ name: '原神' }));
ok('A2. titleQuoted:false → 不加书名号', domainLabel({ name: '篮球', titleQuoted: false }) === '篮球', domainLabel({ name: '篮球', titleQuoted: false }));
ok('A3. category=体育 → 不加书名号', domainLabel({ name: '羽毛球', category: '体育' }) === '羽毛球', domainLabel({ name: '羽毛球', category: '体育' }));
ok('A4. category=游戏 → 加书名号', domainLabel({ name: '原神', category: '游戏' }) === '《原神》');
ok('A5. titleQuoted 优先级高于 category', domainLabel({ name: '测试', category: '体育', titleQuoted: true }) === '《测试》');
ok('A6. 裁剪版对象（仅 id/name）按 id 回查板块', domainLabel({ id: 'badminton', name: '羽毛球' }) === '羽毛球', domainLabel({ id: 'badminton', name: '羽毛球' }));
ok('A7. 空领域 → 空串', domainLabel(null) === '' && domainLabel({}) === '');
ok('A8. isTitleQuoted 对 null 返回 false', isTitleQuoted(null) === false);

/* ==========================================================================
 * B. 真实配置
 * ======================================================================= */
console.log('—— B. 真实配置 ——');
const { INTEREST_DOMAINS, DOMAIN_CATEGORY } = await import('../src/config/interestsConfig.js');

const sports = ['basketball', 'badminton', 'football', 'billiard'];
for (const id of sports) {
  const d = INTEREST_DOMAINS[id];
  ok(`B1.${id} 配置存在`, Boolean(d));
  if (!d) continue;
  ok(`B2.${id} 的 name 是纯文字（无书名号）`, !/[《》]/.test(d.name), d.name);
  ok(`B3.${id} 的 category 为体育`, d.category === DOMAIN_CATEGORY.SPORTS, d.category);
  ok(`B4.${id} 的 titleQuoted === false`, d.titleQuoted === false, String(d.titleQuoted));
  ok(`B5.${id} 的 domainLabel 无书名号`, domainLabel(d) === d.name, domainLabel(d));
}

/* 游戏 / 影视领域必须保留书名号 */
const titleIds = Object.keys(INTEREST_DOMAINS).filter((id) => !sports.includes(id));
ok('B6. 非体育领域数量 ≥ 8', titleIds.length >= 8, `${titleIds.length} 个`);
let titled = 0;
for (const id of titleIds) {
  const d = INTEREST_DOMAINS[id];
  if (domainLabel(d) === `《${d.name}》`) titled++;
  else fail.push(`✘ B7.${id} 应为《${d.name}》，实际「${domainLabel(d)}」`);
}
ok(`B7. 全部 ${titleIds.length} 个非体育领域仍带书名号`, titled === titleIds.length, `${titled}/${titleIds.length}`);

/* ==========================================================================
 * C. getDomains() 透传
 * ======================================================================= */
console.log('—— C. getDomains() 透传 ——');
const wordBankService = await import('../src/services/wordBankService.js');
const list = wordBankService.getDomains();
const bk = list.find((d) => d.id === 'basketball');
const bd = list.find((d) => d.id === 'badminton');
ok('C1. getDomains() 透传 titleQuoted', bk && bk.titleQuoted === false, String(bk && bk.titleQuoted));
ok('C2. getDomains() 透传 category', bk && bk.category === '体育', String(bk && bk.category));
ok('C3. getDomains() 结果上 domainLabel 仍不加书名号', domainLabel(bk) === '篮球', domainLabel(bk));
ok('C4. 羽毛球同理', domainLabel(bd) === '羽毛球', domainLabel(bd));

/* ==========================================================================
 * D. 静态源码：不得再有硬编码动态书名号
 * ======================================================================= */
console.log('—— D. 静态源码扫描 ——');
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function walkJs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const jsFiles = walkJs(path.join(ROOT, 'src'));
const offenders = [];
for (const f of jsFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel === 'src/core/domainLabel.js') continue;   // 唯一允许定义处
  const code = stripComments(readFileSync(f, 'utf8'));
  if (/《\$\{/.test(code)) offenders.push(rel);
}
ok('D1. 除 domainLabel.js 外无硬编码 `《${`', offenders.length === 0, offenders.join(', '));

const labelSrc = readFileSync(path.join(ROOT, 'src/core/domainLabel.js'), 'utf8');
ok('D2. domainLabel.js 内部使用 category=体育 判定', /NON_TITLE_CATEGORY\s*=\s*'体育'/.test(labelSrc));
ok('D3. 5 个渲染点均已接入 domainLabel',
  ['components/wordCard.js', 'components/flipCard.js', 'components/detailModal.js', 'pages/homePage.js', 'services/aiService.js']
    .every((r) => /domainLabel/.test(readFileSync(path.join(ROOT, 'src', r), 'utf8'))));

/* ==========================================================================
 * E. 动态渲染：领域名称格式 + 无材料时整块隐藏
 * ======================================================================= */
console.log('—— E. 动态渲染 ——');
const { createWordCard } = await import('../src/components/wordCard.js');

const MATERIAL = {
  root: 'defend', generalMeaning: 'n. 防守', domainMeaning: '（材料）该词在领域中的具体含义',
  story: '（材料）这是一段足够长的具体场景微故事，用来触发区块渲染。',
  example: 'The defense held the line until the final whistle.',
  exampleZh: '防守坚持到了终场哨响。', exampleSource: 'AI 生成',
  source: '测试来源', unverified: false, imageUrl: '',
};

function cardText(domainObj, material) {
  const card = createWordCard({
    word: { word: 'defense', translation: 'n. 防守', type: 'core' },
    material,
    domain: domainObj,
    relevance: { level: 'vocab', score: 70 },
    onToggleFavorite: () => {},
    onToggleSelect: () => {},
  });
  return card.textContent;
}

/* E1~E4：有材料 → 「领域关联」区块标题遵守书名号规则 */
const bkText = cardText({ id: 'basketball', name: '篮球', category: '体育', titleQuoted: false, theme: {} }, MATERIAL);
ok('E1. 篮球「领域关联」区块标题不含《篮球》', !bkText.includes('《篮球》'), bkText.slice(0, 80));
ok('E2. 篮球区块标题显示「领域关联 · 篮球」纯文字', bkText.includes('领域关联 · 篮球'), bkText.slice(0, 80));

const bdText = cardText({ id: 'badminton', name: '羽毛球', category: '体育', titleQuoted: false, theme: {} }, MATERIAL);
ok('E3. 羽毛球区块标题不含《羽毛球》', !bdText.includes('《羽毛球》'), bdText.slice(0, 80));

const giText = cardText({ id: 'genshin_impact', name: '原神', category: '游戏', theme: {} }, MATERIAL);
ok('E4. 原神区块标题保留《原神》', giText.includes('《原神》'), giText.slice(0, 80));

/* E5~E7：无材料 → 领域关联 / 英文例句 区块整块隐藏，且无任何兜底废话 */
const BANNED = [
  '暂无例句', '暂无预生成材料', '该词与当前领域暂无直接对应关系',
  '较为常见', '较常见', '可联想', '可以建立', '可结合场景', '可用以', '与之相关',
];
const noMatText = cardText({ id: 'basketball', name: '篮球', category: '体育', titleQuoted: false, theme: {} }, null);
ok('E5. 无材料时不渲染「领域关联」区块', !noMatText.includes('领域关联'), noMatText.slice(0, 120));
ok('E6. 无材料时不渲染「英文例句」区块', !noMatText.includes('英文例句'), noMatText.slice(0, 120));
ok('E7. 无材料时不出现任何兜底废话文案',
  !BANNED.some((b) => noMatText.includes(b)), BANNED.filter((b) => noMatText.includes(b)).join(', '));

/* E8：静态源码里 localDomainHint / hint() 必须已彻底删除 */
const srcOf = (rel) => readFileSync(path.join(ROOT, 'src', rel), 'utf8');
const stripped = (rel) => srcOf(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('E8. wordCard.js 已删除 localDomainHint', !/localDomainHint/.test(stripped('components/wordCard.js')));
ok('E9. flipCard.js 已删除 localDomainHint', !/localDomainHint/.test(stripped('components/flipCard.js')));
ok('E10. detailModal.js 已删除 hint()', !/function\s+hint\s*\(/.test(stripped('components/detailModal.js')));
ok('E11. 三个组件源码均无「暂无例句」兜底',
  ['components/wordCard.js', 'components/flipCard.js', 'components/detailModal.js']
    .every((r) => !/暂无例句/.test(stripped(r))));

/* ==========================================================================
 * F. 材料 JSON 的 domainName
 * ======================================================================= */
console.log('—— F. 材料 JSON domainName ——');
const DIR = path.join(ROOT, 'src/data/domainMaterials');
let jsonBad = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
  if (!j.domainName) continue;
  if (/[《》]/.test(j.domainName)) jsonBad.push(`${f}:${j.domainName}`);
}
ok('F1. 所有材料 JSON 的 domainName 均无书名号', jsonBad.length === 0, jsonBad.join(', '));

/* ==========================================================================
 * 汇总
 * ======================================================================= */
console.log('\n===== verifyDomainLabel =====');
for (const line of pass) console.log(line);
for (const line of fail) console.log(line);
console.log(`\n通过 ${pass.length} / ${pass.length + fail.length}`);
if (fail.length) { console.error(`\n❌ 有 ${fail.length} 条断言失败`); process.exit(1); }
console.log('✅ 全部通过');
