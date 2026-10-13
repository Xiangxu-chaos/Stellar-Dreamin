/**
 * modal.js —— 模态框容器
 * 提供 openModal({ title, subtitle, body, footer, width }) → { close, setBody, setFooter }
 * 支持：ESC 关闭、点击遮罩关闭、焦点回收、滚动锁定、移动端底部抽屉。
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';

let activeModal = null;

export function openModal(options = {}) {
  // 同一时间只保留一个模态，避免堆叠
  if (activeModal) activeModal.close();

  const {
    title = '',
    subtitle = '',
    body = null,
    footer = null,
    width = 'normal', // normal | wide | narrow
    closable = true,
    onClose = null,
  } = options;

  const prevOverflow = document.body.style.overflow;
  const prevFocus = document.activeElement;

  const bodyEl = h('div.modal__body');
  const footerEl = h('div.modal__foot');
  if (body) append2(bodyEl, body);
  if (footer) append2(footerEl, footer);
  if (!footer) footerEl.style.display = 'none';

  const panel = h('div.modal__panel', {
    class: width === 'wide' ? 'modal__panel--wide' : width === 'narrow' ? 'modal__panel--narrow' : '',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || '对话框',
  }, [
    h('div.modal__head', {}, [
      h('div', { style: { flex: '1', minWidth: '0' } }, [
        h('h2.modal__title', { text: title }),
        subtitle ? h('div.modal__subtitle', { text: subtitle }) : null,
      ]),
      closable ? h('button.modal__close', {
        type: 'button',
        'aria-label': '关闭',
        onClick: () => close(),
      }, [svgIcon(iconPath('close'), { size: 16 })]) : null,
    ]),
    bodyEl,
    footerEl,
  ]);

  const backdrop = h('div.modal__backdrop', {
    onClick: () => { if (closable) close(); },
  });

  const root = h('div.modal', { role: 'presentation' }, [backdrop, panel]);
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';

  const onKey = (e) => {
    if (e.key === 'Escape' && closable) close();
  };
  document.addEventListener('keydown', onKey);

  function close() {
    if (!root.isConnected) return;
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    root.remove();
    activeModal = null;
    try { prevFocus?.focus?.(); } catch (e) { /* ignore */ }
    if (typeof onClose === 'function') onClose();
  }

  // 初始焦点：优先第一个可交互元素
  requestAnimationFrame(() => {
    const first = panel.querySelector('input, textarea, select, button:not(.modal__close)');
    first?.focus?.();
  });

  activeModal = {
    close,
    root,
    panel,
    setBody(node) { bodyEl.replaceChildren(); append2(bodyEl, node); },
    setFooter(node) {
      footerEl.replaceChildren();
      append2(footerEl, node);
      footerEl.style.display = node ? '' : 'none';
    },
    setTitle(t) { panel.querySelector('.modal__title').textContent = t; },
    setSubtitle(t) {
      const el = panel.querySelector('.modal__subtitle');
      if (el) el.textContent = t;
      else panel.querySelector('.modal__title').insertAdjacentElement('afterend', h('div.modal__subtitle', { text: t }));
    },
  };
  return activeModal;
}

function append2(parent, node) {
  if (!node) return;
  if (Array.isArray(node)) node.forEach((n) => append2(parent, n));
  else if (node instanceof Node) parent.appendChild(node);
  else parent.appendChild(document.createTextNode(String(node)));
}

/** 确认对话框（Promise 化） */
export function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal({
      title,
      width: 'narrow',
      body: h('p.detail__text--soft', { style: { fontSize: '14px', lineHeight: '1.7' }, text: message }),
      footer: [
        h('div.spacer'),
        h('button.btn', { type: 'button', text: cancelText, onClick: () => { done(false); m.close(); } }),
        h('button.btn', {
          type: 'button',
          class: danger ? 'btn--primary' : 'btn--accent',
          style: danger ? { background: 'linear-gradient(160deg, rgba(var(--c-danger-rgb),0.9), rgba(var(--c-danger-rgb),0.7))', borderColor: 'rgba(var(--c-danger-rgb),0.8)' } : {},
          text: confirmText,
          onClick: () => { done(true); m.close(); },
        }),
      ],
      onClose: () => done(false),
    });
  });
}

export default { openModal, confirmDialog };
