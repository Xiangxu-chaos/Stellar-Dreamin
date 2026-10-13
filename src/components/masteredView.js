/**
 * masteredView.js —— 功能三：熟词库列表（掌握进度详情页）
 * ============================================================================
 * 展示已标记为「熟词」的词，并支持逐条「取消掌握」。
 * 顶部显示「六级词汇掌握进度：X / 总数」进度条（与主界面同口径）。
 *
 * ⚠️ 不碰 localStorage；取消掌握走 studyService/dataService。
 * ============================================================================
 */

import { h, clear, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { showToast } from './toast.js';
import studyService from '../services/studyService.js';

/**
 * @param {object} options
 * @param {object} options.domainMap
 * @param {(w:object)=>void} [options.onOpenWord]
 * @param {Function} [options.onProgressChange] 掌握数量变化回调（主界面同步进度条）
 */
export function createMasteredView(options = {}) {
  const { domainMap = {}, onOpenWord, onProgressChange } = options;

  const root = h('div.mastered-view');
  const headHost = h('div');
  const listHost = h('div');
  root.append(headHost, listHost);

  boot();

  async function boot() {
    listHost.replaceChildren(h('div.loading-block', {}, [h('span.spinner'), '正在读取熟词库…']));
    let list = [];
    let progress = { mastered: 0, total: 0, ratio: 0 };
    try {
      [list, progress] = await Promise.all([
        studyService.buildMasteredWords(),
        studyService.getMasteryProgress(),
      ]);
    } catch (e) {
      console.warn('[masteredView] 读取失败', e);
      listHost.replaceChildren(h('div.empty', {}, [
        h('div.empty__title', { text: '读取失败' }),
        h('div.empty__desc', { text: e?.message || String(e) }),
      ]));
      return;
    }
    renderHead(list, progress);
    renderList(list, progress);
  }

  function renderHead(list, progress) {
    const pct = Math.round((progress.ratio || 0) * 100);
    clear(headHost);
    headHost.appendChild(h('div.fav-head', {}, [
      h('div.fav-head__title', {}, [
        svgIcon(iconPath('brain'), { size: 15 }),
        h('span', { text: '熟词库' }),
        h('span.chip', { text: `${list.length} 个词` }),
      ]),
      h('div.fav-head__actions', {}, [
        h('div', { style: { minWidth: '230px' } }, [
          h('div.mastery-bar', { style: { cursor: 'default' } }, [
            h('span.mastery-bar__label', {}, [
              h('span', { text: '六级掌握进度：' }),
              h('b.mastery-bar__num', { text: `${progress.mastered} / ${progress.total}` }),
            ]),
            h('span.mastery-bar__track', {}, [
              h('i.mastery-bar__fill', { style: { width: `${pct}%` } }),
            ]),
            h('span.mastery-bar__pct', { text: `${pct}%` }),
          ]),
        ]),
      ]),
    ]));
  }

  function renderList(list, progress) {
    if (!list.length) {
      listHost.replaceChildren(h('div.empty', {}, [
        h('div.empty__icon', {}, [svgIcon(iconPath('brain'), { size: 30 })]),
        h('div.empty__title', { text: '还没有标记熟词' }),
        h('div.empty__desc', {
          text: '在卡片背面点击「标记为熟词」，就表示这个词你已经掌握了。熟词默认不会出现在复习里。',
        }),
      ]));
      return;
    }

    const rows = list.map((w) => {
      const dom = domainMap[w.domainId] || null;
      return h('div.mastered-row', {}, [
        h('span.mastered-row__word', { text: w.word }),
        h('span.mastered-row__meta', {}, [
          dom ? svgIcon(iconPath(dom.icon || 'domain'), { size: 11, cls: 'btn__icon' }) : null,
          h('span', { text: dom ? dom.name : w.domainId }),
        ]),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onClick: async (e) => {
            e.stopPropagation();
            await studyService.setMastered(w.domainId, w.word, false);
            showToast(`已取消掌握：${w.word}`, { type: 'success' });
            if (typeof onProgressChange === 'function') onProgressChange();
            boot();
          },
        }, [svgIcon(iconPath('close'), { size: 12, cls: 'btn__icon' }), '取消掌握']),
        typeof onOpenWord === 'function'
          ? h('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              onClick: (e) => { e.stopPropagation(); onOpenWord(w); },
            }, [svgIcon(iconPath('expand'), { size: 12, cls: 'btn__icon' }), '查看'])
          : null,
      ]);
    });

    listHost.replaceChildren(...rows);
  }

  root.__refresh = boot;
  return root;
}

export default { createMasteredView };
