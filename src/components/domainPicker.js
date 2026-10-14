/**
 * domainPicker.js —— 功能一：兴趣领域选择面板
 * ============================================================================
 * 同一个组件服务两种场景（需求：首次引导 + 随时增删「我的库」）：
 *
 *   1. 首次引导（onboarding = true）
 *      - 全屏遮罩、不可关闭（必须选至少 1 个才能继续）
 *      - 标题「选择你感兴趣的领域」，每张领域卡显示：名称 / 简短描述 / 主题色
 *
 *   2. 我的库管理（onboarding = false）
 *      - 普通模态：随时增删，点「确定」落库
 *
 * ⚠️ 本组件不碰 localStorage —— 落库由传入的 onConfirm(ids) 回调负责，
 *    回调内部走 studyService/dataService。符合「页面/组件禁止直接触碰存储」的分层铁律。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

/**
 * @param {object} options
 * @param {Array<{id,name,subtitle,description,icon,theme,termCount}>} options.domains 全部领域
 * @param {string[]} [options.selected]  已选中的领域 id
 * @param {boolean} [options.onboarding] 是否首次引导模式
 * @param {(ids:string[]) => Promise<any>} options.onConfirm 确认回调（落库）
 * @param {Function} [options.onClose]
 */
export function openDomainPicker(options = {}) {
  const {
    domains = [],
    selected = [],
    onboarding = false,
    onConfirm,
    onClose,
  } = options;

  const chosen = new Set(selected.filter(Boolean));
  const cardRefs = [];

  const grid = h('div.dp-grid');

  for (const d of domains) {
    const isOn = chosen.has(d.id);
    const card = h('button.dp-card', {
      type: 'button',
      class: isOn ? 'is-on' : '',
      'aria-pressed': String(isOn),
      'aria-label': `${d.name || d.id}${isOn ? '（已勾选）' : '（未勾选）'}`,
      dataset: { domainId: d.id },
      style: {
        '--dp-primary': d.theme?.primary || 'var(--c-primary)',
        '--dp-accent': d.theme?.accent || 'var(--c-accent)',
        '--dp-soft': d.theme?.primarySoft || 'rgba(var(--c-primary-rgb), 0.14)',
      },
    }, [
      h('span.dp-card__check', {}, [svgIcon(iconPath('check'), { size: 14, cls: 'dp-card__tick' })]),
      h('span.dp-card__icon', {}, [svgIcon(iconPath(d.icon || 'domain'), { size: 20 })]),
      h('span.dp-card__name', { text: d.name || d.id }),
      d.subtitle ? h('span.dp-card__sub', { text: d.subtitle }) : null,
      h('span.dp-card__desc', { text: d.description || '' }),
      h('span.dp-card__meta', {}, [
        d.termCount ? `${d.termCount} 个领域词` : '领域词库',
      ]),
    ]);

    card.addEventListener('click', () => {
      if (chosen.has(d.id)) chosen.delete(d.id);
      else chosen.add(d.id);
      const on = chosen.has(d.id);
      card.classList.toggle('is-on', on);
      card.setAttribute('aria-pressed', String(on));
      card.setAttribute('aria-label', `${d.name || d.id}${on ? '（已勾选）' : '（未勾选）'}`);
      syncHint();
    });

    cardRefs.push(card);
    grid.appendChild(card);
  }

  const hint = h('div.dp-hint', { role: 'status' });

  function syncHint() {
    if (chosen.size === 0) {
      hint.textContent = onboarding
        ? '请至少选择 1 个领域，才能进入卡片库'
        : '至少保留 1 个领域，否则卡片库为空';
      hint.classList.add('is-warn');
    } else {
      hint.textContent = `已选择 ${chosen.size} 个领域`;
      hint.classList.remove('is-warn');
    }
  }
  syncHint();

  const confirmBtn = h('button.btn.btn--accent', {
    type: 'button',
    onClick: async () => {
      if (chosen.size === 0) {
        showToast(onboarding ? '请至少选择 1 个领域' : '请至少保留 1 个领域', { type: 'warn' });
        return;
      }
      const ids = domains.map((d) => d.id).filter((id) => chosen.has(id));
      confirmBtn.disabled = true;
      try {
        if (typeof onConfirm === 'function') await onConfirm(ids);
        modal.close();
      } catch (e) {
        console.warn('[domainPicker] 保存失败', e);
        showToast('保存失败，请重试', { type: 'error' });
        confirmBtn.disabled = false;
      }
    },
  }, [
    svgIcon(iconPath(onboarding ? 'sparkles' : 'check'), { size: 13, cls: 'btn__icon' }),
    onboarding ? '确认，开始学习' : '保存我的库',
  ]);

  const footer = h('div.dp-foot', {}, [
    onboarding ? h('div.dp-foot__tip', { text: '之后可随时在顶部「我的库」里增删领域' }) : h('div.spacer'),
    confirmBtn,
  ]);

  const body = h('div.dp-body', {}, [
    onboarding
      ? h('p.dp-lead', {
          text: '勾选你感兴趣的游戏领域。系统会围绕这些领域的场景，为六级词汇生成专属记忆卡片——只有你选的领域会出现在卡片库里。',
        })
      : h('p.dp-lead', {
          text: '勾选要保留在「我的库」里的领域。取消勾选后，该领域会从卡片库与筛选中移除（已收藏的卡片不受影响）。',
        }),
    grid,
    hint,
  ]);

  const modal = openModal({
    title: onboarding ? '选择你感兴趣的领域' : '管理我的库',
    subtitle: onboarding ? 'Step 1 · 打造属于你的兴趣词库' : `${domains.length} 个可选领域`,
    width: 'wide',
    closable: !onboarding,   // 首次引导不可关闭，必须做出选择
    body,
    footer,
    onClose: () => { if (typeof onClose === 'function') onClose(); },
  });

  return modal;
}

export default { openDomainPicker };
