/**
 * verifyCardLayout.mjs —— 卡片布局回归校验（修复「领域标签 / 单词重叠 + 尺寸不统一」）
 * ============================================================================
 * 背景：此前在《王者荣耀 / 空洞骑士 / 无畏契约》下，卡片正面的「领域标签」
 * 与「英文单词」发生重叠，且卡片大小观感不统一。根因是正面内容高度超出
 * 固定卡片高度，而单词区被压缩后向上溢出。
 *
 * 本脚本从两个层面锁死该问题：
 *   一、静态校验 CSS：卡片等高、正面纵向 flex、无绝对定位摆标签/单词、
 *       徽标行与底部不参与伸缩、单词区可收缩且 overflow: hidden。
 *   二、动态渲染：为四个领域各生成一张卡片，断言正面子节点顺序为
 *       [图, 徽标, 单词区, 底部] 且不存在绝对定位的标签/单词节点。
 * ============================================================================
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, e = '') => (c ? pass : fail).push(`${c ? '\u2714' : '\u2718'} ${n}${e ? ' — ' + e : ''}`);

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
  requestAnimationFrame: (f) => setTimeout(() => f(0), 0),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 };

/* ==========================================================================
 * 一、静态 CSS 校验
 * ======================================================================= */
const CSS = readFileSync(path.join(ROOT, 'src/styles/components.css'), 'utf8');

/* 1. 卡片高度：**只用 min-height，不写死 height**
 *    铁律（任务一）：标签换行时卡片必须能被自然撑高，绝不压缩单词。 */
const cardBlock = CSS.match(/(?:^|\n)\.wordcard\s*\{[\s\S]*?\}/);
ok('.wordcard 定义存在', Boolean(cardBlock));
ok('.wordcard 只用 min-height、不写死 height',
  Boolean(cardBlock) && /min-height:\s*\d+px/.test(cardBlock[0]) && !/(^|[^-])height:\s*\d+px/.test(cardBlock[0]),
  cardBlock ? cardBlock[0].replace(/\s+/g, ' ').slice(0, 120) : '');
ok('.wordcard--compact 只用 min-height、不写死 height',
  /\.wordcard--compact\s*\{[^}]*min-height:\s*\d+px[^}]*\}/.test(CSS)
  && !/\.wordcard--compact\s*\{[^}]*[^-]height:\s*\d+px/.test(CSS));

/* 1b. 单词不能被压缩（flex-shrink: 0）—— 修复 chamber → cnamber */
const wordBlock = CSS.match(/(?:^|\n)\.wordcard__word\s*\{[\s\S]*?\}/);
ok('.wordcard__word 设置 flex-shrink: 0（绝不压缩变形）',
  Boolean(wordBlock) && /flex-shrink:\s*0/.test(wordBlock[0]));

/* 2. 正面纵向 flex */
const faceBlock = CSS.match(/(?:^|\n)\.wordcard__face\s*\{[\s\S]*?\}/);
ok('.wordcard__face 使用 flex 纵向布局',
  Boolean(faceBlock) && /display:\s*flex/.test(faceBlock[0]) && /flex-direction:\s*column/.test(faceBlock[0]));

/* 3. 徽标区 / 单词区 不得用绝对定位摆放 */
const badgesBlock = CSS.match(/(?:^|\n)\.wordcard__badges\s*\{[\s\S]*?\}/);
const wordwrapBlock = CSS.match(/(?:^|\n)\.wordcard__wordwrap\s*\{[\s\S]*?\}/);
ok('.wordcard__badges 不以 position: absolute 摆放', Boolean(badgesBlock) && !/position:\s*absolute/.test(badgesBlock[0]));
ok('.wordcard__wordwrap 不以 position: absolute 摆放', Boolean(wordwrapBlock) && !/position:\s*absolute/.test(wordwrapBlock[0]));

/* 4. 徽标行 / 底部不参与伸缩（flex: none），单词区可收缩 + 裁切 */
ok('.wordcard__badges flex: none（不被压缩）', Boolean(badgesBlock) && /flex:\s*none/.test(badgesBlock[0]));
const footBlock = CSS.match(/(?:^|\n)\.wordcard__foot\s*\{[\s\S]*?\}/);
ok('.wordcard__foot flex: none（不被压缩）', Boolean(footBlock) && /flex:\s*none/.test(footBlock[0]));
ok('.wordcard__wordwrap 可伸缩且有 overflow: hidden',
  Boolean(wordwrapBlock) && /flex:\s*1/.test(wordwrapBlock[0]) && /overflow:\s*hidden/.test(wordwrapBlock[0]));

/* 5. 配图区可收缩（给长标签让位），且 overflow: hidden */
const figBlock = CSS.match(/(?:^|\n)\.wordcard__figure\s*\{[\s\S]*?\}/);
ok('.wordcard__figure 可收缩（flex 0 1 auto / 含 shrink）',
  Boolean(figBlock) && /flex:\s*0\s+1/.test(figBlock[0]));
ok('.wordcard__figure 保持 overflow: hidden 与 16/9',
  Boolean(figBlock) && /overflow:\s*hidden/.test(figBlock[0]) && /aspect-ratio:\s*16\s*\/\s*9/.test(figBlock[0]));

/* 6. 长领域标签允许换行（不被强制 nowrap 撑破行） */
ok('.wordcard__badges .chip--domain 允许换行（white-space: normal）',
  /\.wordcard__badges\s+\.chip--domain\s*\{[\s\S]*?white-space:\s*normal/.test(CSS));

/* ==========================================================================
 * 二、动态渲染：四个领域各渲染一张卡片
 * ======================================================================= */
const { INTEREST_DOMAINS } = await import('../src/config/interestsConfig.js');
const { createWordCard } = await import('../src/components/wordCard.js');

const DOMAINS = Object.entries(INTEREST_DOMAINS);
ok('存在四个兴趣领域', DOMAINS.length === 4, `${DOMAINS.length} 个`);

for (const [id, dom] of DOMAINS) {
  const card = createWordCard({
    word: { word: 'ascension', translation: 'n. 上升；进阶；耶稣升天节', type: 'core' },
    material: {
      root: '核心词', generalMeaning: 'n. 上升，登高', domainMeaning: '领域释义测试',
      story: '一个故事。', example: 'Ascension 20 is brutal.', exampleZh: '进阶 20 很残酷。',
      source: 'Steam 官方中文',
    },
    domain: { id, name: dom.name, icon: dom.icon, theme: dom.theme },
    relevance: { level: 'exact', domainTermZh: '进阶', score: 80, evidence: 'evidence' },
    onToggleFavorite: () => {},
    onToggleSelect: () => {},
  });

  const front = card.querySelector('.wordcard__face--front');
  ok(`[${id} ${dom.name}] 正面存在`, Boolean(front));
  if (!front) continue;

  const figure = front.querySelector('.wordcard__figure');
  const badges = front.querySelector('.wordcard__badges');
  const wordwrap = front.querySelector('.wordcard__wordwrap');
  const foot = front.querySelector('.wordcard__foot');
  const wordEl = front.querySelector('.wordcard__word');

  ok(`[${id}] 正面包含 图 / 徽标 / 单词区 / 底部`,
    Boolean(figure && badges && wordwrap && foot));
  ok(`[${id}] 单词元素存在`, Boolean(wordEl));

  // 顺序：图 < 徽标 < 单词区 < 底部
  const order = [figure, badges, wordwrap, foot].map((el) => (el ? front.children.indexOf(el) : -1));
  const ascending = order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
  ok(`[${id}] 正面纵向顺序 图→徽标→单词区→底部`, ascending, order.join(','));

  // 徽标与单词均非绝对定位
  const absBadge = Boolean(badges && badges.style && badges.style.position === 'absolute');
  const absWord = Boolean(wordEl && wordEl.style && wordEl.style.position === 'absolute');
  ok(`[${id}] 徽标与单词均非绝对定位（走 flex 流式排版）`, !absBadge && !absWord);

  // 单词区必须排在徽标之后（保证标签在上、单词在下，绝不重叠）
  ok(`[${id}] 单词区在徽标行之后`,
    badges && wordwrap && front.children.indexOf(wordwrap) > front.children.indexOf(badges));

  /* 任务一：正面**只允许三类标签** —— 领域 / 认证 / 词性。
   * 且认证标签文案必须是「官方认证」，绝不能出现长译名 / 来源 / 待确认等啰嗦文本。 */
  const chipEls = badges ? collectByClass(badges, 'chip') : [];
  const chips = chipEls.map((el) => el.textContent.trim());
  ok(`[${id}] 正面徽标数量 ≤ 3`, chips.length <= 3, `实际 ${chips.length} 个：${chips.join(' | ')}`);

  const domainChip = chipEls.find((el) => el._cls.has('chip--domain'));
  ok(`[${id}] 存在领域标签且只显示领域名`,
    Boolean(domainChip) && domainChip.textContent.trim() === dom.name,
    domainChip ? `「${domainChip.textContent.trim()}」 vs 期望「${dom.name}」` : '缺失');

  const termChip = chipEls.find((el) => el._cls.has('chip--term'));
  ok(`[${id}] 认证标签文案为「官方认证」`,
    Boolean(termChip) && termChip.textContent.trim() === '官方认证',
    termChip ? termChip.textContent.trim() : '缺失');

  const posChip = chipEls.find((el) => el._cls.has('chip--core') || el._cls.has('chip--derived'));
  ok(`[${id}] 词性标签为「核心词」/「派生词」`,
    Boolean(posChip) && /^(核心词|派生词)$/.test(posChip.textContent.trim()),
    posChip ? posChip.textContent.trim() : '缺失');

  ok(`[${id}] 正面不得出现来源徽标 / 待确认徽标`,
    !chipEls.some((el) => el._cls.has('chip--source') || el._cls.has('chip--warn')));

  // 背面不受影响：例句区仍存在
  const back = card.querySelector('.wordcard__face--back');
  ok(`[${id}] 背面例句区不受影响`, Boolean(back && back.querySelector('.mat__value--example')));

  // 背面仍保留来源严谨性标注（来源徽标从正面移到背面是允许的）
  ok(`[${id}] 背面仍保留来源徽标`,
    Boolean(back && collectByClass(back, 'chip--source').length > 0));
}

/** 递归收集带指定 class 的元素（shim 的 querySelector 不支持后代组合器） */
function collectByClass(node, cls) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.nodeType === 1 && c._cls && c._cls.has(cls)) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/* ==========================================================================
 * 汇总
 * ======================================================================= */
console.log('\n===== verifyCardLayout =====');
for (const line of pass) console.log(line);
for (const line of fail) console.log(line);
console.log(`\n通过 ${pass.length} / ${pass.length + fail.length}`);
if (fail.length) { console.error(`\n❌ 有 ${fail.length} 条断言失败`); process.exit(1); }
console.log('✅ 全部通过');
