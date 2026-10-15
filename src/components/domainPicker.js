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
 *   3. 板块分组（本轮增量）
 *      - 领域按 category 字段分组：游戏 / 影视 / 体育 / 其他，每组一个标题，
 *        组内仍是原来的网格。超过 6 个领域时用户才不会「一屏看不出归属」。
 *      - 缺失或拼错的 category 一律归入「其他」，保证卡片不会消失。
 *
 * ⚠️ 本组件不碰 localStorage —— 落库由传入的 onConfirm(ids) 回调负责，
 *    回调内部走 studyService/dataService。符合「页面/组件禁止直接触碰存储」的分层铁律。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { DOMAIN_CATEGORY, DOMAIN_CATEGORY_ORDER } from '../config/interestsConfig.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

/** 板块标题左侧的小图标（图标名必须存在于 core/icons.js） */
const CATEGORY_ICON = {
  [DOMAIN_CATEGORY.GAME]: 'swords',
  [DOMAIN_CATEGORY.FILM]: 'play',
  [DOMAIN_CATEGORY.SPORTS]: 'target',
  [DOMAIN_CATEGORY.OTHER]: 'layers',
};

/** 归一化板块名：只认四个已知板块，其余（含空值）归入「其他」 */
function normalizeCategory(raw) {
  const v = String(raw == null ? '' : raw).trim();
  return DOMAIN_CATEGORY_ORDER.includes(v) ? v : DOMAIN_CATEGORY.OTHER;
}

/**
 * 按板块分组，并保持 DOMAIN_CATEGORY_ORDER 的顺序；空板块不渲染。
 * @returns {Array<{category:string, domains:Array}>}
 */
function groupByCategory(domains) {
  const buckets = new Map(DOMAIN_CATEGORY_ORDER.map((c) => [c, []]));
  for (const d of domains) buckets.get(normalizeCategory(d.category)).push(d);
  return DOMAIN_CATEGORY_ORDER
    .map((category) => ({ category, domains: buckets.get(category) }))
    .filter((g) => g.domains.length > 0);
}

/**
 * @param {object} options
 * @param {Array<{id,name,subtitle,description,icon,theme,recallCount}>} options.domains 全部领域
 * @param {string[]} [options.selected]  已选中的领域 id
 * @param {boolean} [options.onboarding] 是否首次引导模式
 * @param {(ids:string[]) => Promise<any>} options.onConfirm 确认回调（落库）
 * @param {Record<string, number>|null} [options.counts]        已预计算的「相关词」数量
 * @param {Promise<Record<string, number>>|null} [options.countsPromise] 数量就绪后回填文案
 * @param {Function} [options.onClose]
 */
export function openDomainPicker(options = {}) {
  const {
    domains = [],
    selected = [],
    onboarding = false,
    onConfirm,
    onClose,
    counts = null,
    countsPromise = null,
  } = options;

  const chosen = new Set(selected.filter(Boolean));
  const cardRefs = [];
  /** domainId → 「相关词 X 条」文案节点（数量预计算完成后回填） */
  const metaRefs = new Map();

  /**
   * 卡片上的数字采用**本领域召回总数**（buildRelatedWords 的长度，与卡片数一致），
   * 来自 wordBankService.ensureRecallCounts() 的一次性预计算缓存；
   * 尚未算好时显示「统计中…」，算好后原地回填，不重新渲染整块面板。
   */
  function countTextOf(d) {
    const n = typeof d.recallCount === 'number'
      ? d.recallCount
      : (counts && typeof counts[d.id] === 'number' ? counts[d.id] : null);
    return n == null ? '统计中…' : `相关词 ${n} 条`;
  }

  /** 全部领域卡片：按板块分组渲染，每组一个标题 */
  const groupsHost = h('div.dp-groups');

  for (const group of groupByCategory(domains)) {
    const grid = h('div.dp-grid');

    for (const d of group.domains) {
      const isOn = chosen.has(d.id);
      const card = h('button.dp-card', {
        type: 'button',
        class: isOn ? 'is-on' : '',
        'aria-pressed': String(isOn),
        'aria-label': `${d.name || d.id}${isOn ? '（已勾选）' : '（未勾选）'}`,
        dataset: { domainId: d.id, category: group.category },
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
      ]);

      const meta = h('span.dp-card__meta', { text: countTextOf(d) });
      metaRefs.set(d.id, meta);
      card.appendChild(meta);

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

    groupsHost.appendChild(h('section.dp-group', {
      dataset: { category: group.category },
      'aria-label': `${group.category}板块`,
    }, [
      h('div.dp-group__head', {}, [
        h('span.dp-group__icon', {}, [svgIcon(iconPath(CATEGORY_ICON[group.category] || 'grid'), { size: 14 })]),
        h('span.dp-group__title', { text: group.category }),
        h('span.dp-group__count', { text: `${group.domains.length} 个领域` }),
      ]),
      grid,
    ]));
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
    groupsHost,
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

  /* 数量若稍后才算好 → 原地回填卡片文案（不重渲染整块面板） */
  if (countsPromise && typeof countsPromise.then === 'function') {
    Promise.resolve(countsPromise).then((ready) => {
      if (!ready || typeof ready !== 'object') return;
      for (const [id, el] of metaRefs) {
        if (typeof ready[id] === 'number') el.textContent = `相关词 ${ready[id]} 条`;
      }
    }).catch(() => { /* 统计失败不影响选择领域 */ });
  }

  return modal;
}

export default { openDomainPicker };
