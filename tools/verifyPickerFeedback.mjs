/**
 * verifyPickerFeedback.mjs —— 「勾选兴趣库」视觉反馈回归校验（本轮增量）
 * ============================================================================
 * 对应反馈：领域选择界面里，勾选与未勾选的卡片视觉区分不够明显，
 *           用户一眼看不出哪些库已经选中。
 *
 * 校验内容：
 *  一、静态（CSS）
 *   1. 未选中态：低饱和（filter: saturate）+ 压暗（opacity），明确「灰下去」
 *   2. 悬停态：未选中卡片微上浮 + 边框变亮（--c-border-strong）
 *   3. 选中态：背景使用领域主题色（--domain-primary = --dp-primary）
 *   4. 选中态：边框加粗加深（border-color + 2px 同色外环）
 *   5. 选中态：右上角勾选图标实心高亮（白勾 + 主题色圆底）
 *   6. 所有状态切换统一 0.2s 过渡，无 0.22s 等旧值残留
 *   7. 触摸设备关闭 hover 位移（避免「粘住」）
 *  二、静态（JS）
 *   8. domainPicker 点击切换 is-on / aria-pressed / aria-label
 *   9. 勾选图标尺寸已放大（14）
 *  三、动态（真实组件 + DOM shim）
 *  10. 初始选中态与传入 selected 一致
 *  11. 点击未选中卡片 → 进入 is-on；再点 → 退出 is-on
 *  12. 每张卡片都有 .dp-card__check（勾选图标挂点）
 *  13. 每张卡片注入了该领域自己的 --dp-primary（保证用「该领域的」主题色）
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

/* ==========================================================================
   一、CSS 静态断言
   ========================================================================== */
const cssRaw = read('src/styles/components.css');
/* 先剥注释再匹配：注释里提到选择器名不会造成假通过 / 假失败 */
const css = code(cssRaw);
/** 取出某条选择器的规则体（扁平匹配，够用） */
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)[ \\t]*${esc}[ \\t]*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

const rBase = rule('.dp-card');
const rHover = rule('.dp-card:hover');
const rOn = rule('.dp-card.is-on');
const rCheck = rule('.dp-card__check');
const rOnCheck = rule('.dp-card.is-on .dp-card__check');
const rOnIcon = rule('.dp-card.is-on .dp-card__icon');

ok('1. 未选中态低饱和（filter: saturate）', /filter:\s*saturate\(\s*0?\.\d+\s*\)/.test(rBase), rBase.match(/filter:[^;]*/)?.[0] || '');
ok('1b. 未选中态压暗（opacity < 1）', /opacity:\s*0?\.\d+/.test(rBase), rBase.match(/opacity:[^;]*/)?.[0] || '');
ok('1c. 未选中态是默认灰色边框', /border:\s*1px solid var\(--c-border\)/.test(rBase));
ok('2. 悬停态微上浮', /transform:\s*translateY\(-\d+px\)/.test(rHover), rHover.match(/transform:[^;]*/)?.[0] || '');
ok('2b. 悬停态边框变亮（--c-border-strong）', /border-color:\s*var\(--c-border-strong\)/.test(rHover));

ok('3. 选中态背景使用领域主题色 --domain-primary',
  /color-mix\(in srgb,\s*var\(--domain-primary\)/.test(rOn),
  (rOn.match(/background:\s*\n?\s*linear-gradient\([\s\S]{0,90}/) || [''])[0].replace(/\s+/g, ' '));
ok('3b. 选中态把 --dp-primary 映射为 --domain-primary',
  /--domain-primary:\s*var\(--dp-primary\)/.test(rBase));
ok('3c. 选中态恢复满饱和、完全不透明', /filter:\s*none/.test(rOn) && /opacity:\s*1\b/.test(rOn));
ok('4. 选中态边框加深（border-color: var(--domain-primary)）',
  /border-color:\s*var\(--domain-primary\)/.test(rOn));
ok('4b. 选中态边框加粗（2px 同色外环）',
  /box-shadow:\s*0 0 0 2px var\(--domain-primary\)/.test(rOn));

ok('5. 勾选图标固定右上角', /top:\s*\d+px;\s*right:\s*\d+px/.test(rCheck));
ok('5b. 选中态勾选图标为「白勾 + 主题色实心圆底」',
  /color:\s*#fff/.test(rOnCheck) && /background:\s*var\(--domain-primary\)/.test(rOnCheck));
ok('5c. 选中态图标反相（实心主题色底）', /background:\s*var\(--domain-primary\)/.test(rOnIcon));

const dpBlock = rule('.dp-card');
const transDurations = [...dpBlock.matchAll(/([\d.]+)s\s+var\(--ease-out\)/g)].map((m) => Number(m[1]));
ok('6. 状态切换统一 0.2s 过渡',
  transDurations.length >= 5 && transDurations.every((d) => d === 0.2),
  `共 ${transDurations.length} 项：${[...new Set(transDurations)].join('/')}s`);
const dpAll = css.slice(css.indexOf('.dp-card {'), css.indexOf('.dp-hint'));
ok('6b. .dp-card 区域无 0.22s 旧过渡残留', !/\.2[23]s/.test(dpAll));

const resp = read('src/styles/responsive.css');
ok('7. 触摸设备关闭 hover 位移', /\.dp-card:hover\s*\{\s*transform:\s*none/.test(resp));

/* ==========================================================================
   二、JS 静态断言
   ========================================================================== */
const pickerSrc = code(read('src/components/domainPicker.js'));
ok('8. 点击切换 is-on 类', /classList\.toggle\(\s*'is-on'/.test(pickerSrc));
ok('8b. 点击同步 aria-pressed', /setAttribute\(\s*'aria-pressed'/.test(pickerSrc));
ok('8c. 卡片带「已勾选 / 未勾选」无障碍标签', /aria-label/.test(pickerSrc) && /已勾选/.test(pickerSrc));
ok('9. 勾选图标尺寸已放大到 14', /iconPath\(\s*'check'\s*\)\s*,\s*\{\s*size:\s*14/.test(pickerSrc),
  (pickerSrc.match(/iconPath\(\s*'check'\s*\)[^)]*\)/) || [''])[0]);
ok('9b. 勾选图标有独立类名便于加粗', /dp-card__tick/.test(pickerSrc));
ok('9c. CSS 对勾本体加粗描边', /\.dp-card__check[\s\S]{0,80}stroke-width:\s*2\.8/.test(css));

/* ==========================================================================
   三、动态断言（真实组件）
   ========================================================================== */
installShim();

const { INTEREST_DOMAINS } = await import('../src/config/interestsConfig.js');
const { openDomainPicker } = await import('../src/components/domainPicker.js');

const domains = Object.values(INTEREST_DOMAINS).map((d) => ({
  id: d.id, name: d.name, subtitle: d.subtitle || '', description: d.description || '',
  icon: d.icon, theme: d.theme, termCount: d.termCount || 0,
}));
ok('动态用例准备：领域数量 ≥ 4', domains.length >= 4, `${domains.length} 个`);

openDomainPicker({
  domains,
  selected: ['hollow_knight'],
  onboarding: true,
  onConfirm: async () => {},
});

const cards = globalThis.document.body.querySelectorAll('.dp-card');
ok('10. 渲染出全部领域卡片', cards.length === domains.length, `${cards.length} 张`);

const byId = (id) => cards.find((c) => c.dataset.domainId === id);
ok('10b. 传入 selected 的卡片初始即为选中态',
  byId('hollow_knight')?._cls.has('is-on') === true);
ok('10c. 未传入的卡片初始为未选中态',
  domains.filter((d) => d.id !== 'hollow_knight').every((d) => !byId(d.id)._cls.has('is-on')));
ok('10d. 选中态 aria-pressed=true', byId('hollow_knight').getAttribute('aria-pressed') === 'true');
ok('10e. 未选中态 aria-pressed=false', byId('valorant').getAttribute('aria-pressed') === 'false');

ok('12. 每张卡片都有勾选图标挂点 .dp-card__check',
  cards.every((c) => Boolean(c.querySelector('.dp-card__check'))));
ok('13. 每张卡片都注入了自己的 --dp-primary',
  domains.every((d) => {
    const c = byId(d.id);
    const v = c.style['--dp-primary'] || c.style.getPropertyValue?.('--dp-primary');
    return Boolean(v && v === (d.theme?.primary || 'var(--c-primary)'));
  }), domains.map((d) => `${d.id}:${byId(d.id).style['--dp-primary']}`).join(' '));

const target = byId('valorant');
target._ev.click?.forEach((fn) => fn({}));
ok('11. 点击未选中卡片 → 进入选中态', target._cls.has('is-on'));
ok('11b. 点击后 aria-pressed=true', target.getAttribute('aria-pressed') === 'true');

target._ev.click?.forEach((fn) => fn({}));
ok('11c. 再次点击 → 退回未选中态', !target._cls.has('is-on'));
ok('11d. 再次点击后 aria-pressed=false', target.getAttribute('aria-pressed') === 'false');

/* ==========================================================================
   最小 DOM shim（只为本脚本的服务，独立于其他校验脚本）
   ========================================================================== */
function installShim() {
  if (globalThis.__pickerShim) return;
  globalThis.__pickerShim = true;

  const styleObj = () => new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (k === 'setProperty' ? (n, v) => { t[n] = v; } : (k === 'removeProperty' ? (n) => { delete t[n]; } : (k === 'getPropertyValue' ? (n) => t[n] ?? '' : '')))),
    set: (t, k, v) => { t[k] = v; return true; },
  });

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.childNodes = this.children;
      this.attributes = {}; this.style = styleObj(); this.dataset = {};
      this._text = null; this._cls = new Set(); this.nodeType = 1; this.parentNode = null; this._ev = {};
      this.classList = {
        add: (...c) => c.filter(Boolean).forEach((x) => String(x).split(/\s+/).filter(Boolean).forEach((y) => this._cls.add(y))),
        remove: (...c) => c.forEach((x) => this._cls.delete(x)),
        contains: (c) => this._cls.has(c),
        toggle: (c, f) => { const on = f === undefined ? !this._cls.has(c) : !!f; on ? this._cls.add(c) : this._cls.delete(c); return on; },
        get length() { return this._cls.size; },
      };
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    appendChild(c) { if (c == null) return c; this.children.push(c); if (c.nodeType === 1) c.parentNode = this; return c; }
    append(...cs) { cs.forEach((c) => { if (c == null) return; this.appendChild(typeof c === 'string' ? new TN(c) : c); }); }
    replaceChildren(...cs) { this.children.length = 0; this.append(...cs); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i >= 0) { this.children.splice(i, 0, c); c.parentNode = this; } else this.appendChild(c); return c; }
    cloneNode() { return new El(this.tagName); }
    contains(n) { if (n === this) return true; return this.children.some((c) => c.nodeType === 1 && c.contains(n)); }
    closest(sel) { let n = this; while (n) { if (n.nodeType === 1) { const m = sel.startsWith('.') ? n._cls.has(sel.slice(1)) : n.tagName === sel.toUpperCase(); if (m) return n; } n = n.parentNode; } return null; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; }
    hasAttribute(k) { return k in this.attributes; }
    addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); }
    removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    focus() { globalThis.document.activeElement = this; }
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
  const body = new El('body');
  globalThis.document = {
    createElement: (t) => new El(t),
    createElementNS: (_n, t) => new El(t),
    createTextNode: (t) => new TN(t),
    body,
    documentElement: new El('html'),
    activeElement: body,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}

/* ---------------- 输出 ---------------- */
console.log('=========== 勾选兴趣库视觉反馈校验 ===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
