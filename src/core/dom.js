/**
 * dom.js —— 极简 DOM 工具
 * ============================================================================
 * 为什么不用框架：
 *   本项目为「小实验 + 后续大改」而设计。为了避免构建链和框架版本成为
 *   后续扩展的负担，视图层采用原生 DOM + 轻量辅助函数。
 *   所有组件都写成 createXxx(props) 返回 HTMLElement 的纯函数，
 *   未来迁移到 React/Vue 时，组件边界已经天然存在，替换成本低。
 *
 * 后续若引入框架，只需替换本文件与 components/，services/ 与 config/ 不变。
 * ============================================================================
 */

/**
 * 创建元素
 * @param {string} tag 支持 'div.cls1.cls2#id' 简写
 * @param {object} [attrs] 属性；class/text/html/dataset/on* 特殊处理
 * @param {Array|Node|string} [children]
 */
export function h(tag, attrs = {}, children = []) {
  const parts = String(tag).split(/(?=[.#])/);
  const el = document.createElement(parts[0] || 'div');

  for (const p of parts.slice(1)) {
    if (p.startsWith('.')) el.classList.add(p.slice(1));
    else if (p.startsWith('#')) el.id = p.slice(1);
  }

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') {
      String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'value') {
      el.value = v;
    } else if (k === 'checked' || k === 'disabled' || k === 'selected') {
      el[k] = Boolean(v);
    } else if (k === 'ref' && typeof v === 'function') {
      v(el);
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else if (c instanceof Node) parent.appendChild(c);
    else parent.appendChild(document.createTextNode(String(c)));
  }
  return parent;
}

export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** SVG 图标容器（图标内容见 icons.js） */
export function svgIcon(inner, { size = 16, viewBox = '0 0 24 24', cls = '' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function debounce(fn, wait = 260) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remain = wait - (now - last);
    if (remain <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remain);
    }
  };
}

/** HTML 转义（用于用户输入回显） */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 相对时间：刚刚 / n分钟前 / n小时前 / 日期 */
export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr} 小时前`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
