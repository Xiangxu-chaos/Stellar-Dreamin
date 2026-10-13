/**
 * toast.js —— 轻量提示
 * 页面通过 showToast() 调用，不直接操作 DOM。
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';

let stack = null;

function ensureStack() {
  if (!stack) {
    stack = h('div.toast-stack', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * @param {string} title
 * @param {{desc?: string, type?: 'ok'|'err'|'info', duration?: number}} [options]
 */
export function showToast(title, options = {}) {
  const { desc = '', type = 'info', duration = 3600 } = options;
  const el = h('div.toast', { class: `toast--${type}` }, [
    svgIcon(iconPath(type === 'ok' ? 'checkCircle' : type === 'err' ? 'xCircle' : 'info'), { size: 17, cls: 'toast__icon' }),
    h('div.toast__body', {}, [
      h('div.toast__title', { text: title }),
      desc ? h('div.toast__desc', { text: desc }) : null,
    ]),
  ]);

  ensureStack().appendChild(el);

  const dismiss = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 280);
  };

  el.addEventListener('click', dismiss);
  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}

export default { showToast };
