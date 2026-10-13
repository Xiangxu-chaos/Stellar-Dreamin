/**
 * wrongWordsView.js —— 功能四：错题本
 * ============================================================================
 * 列表默认按「错误率」降序（同率则错得多、错得近的排前）。
 * 每行：单词 / 所属领域 / 错次 / 总作答 / 错误率条 + 移除按钮。
 *
 * 点击某一行 → 由父层打开完整卡片（onOpenWord）。
 * 顶部按钮「从错题本开始复习」→ 只考题库里的错题（onStartReview）。
 *
 * ⚠️ 不碰 localStorage；移除走 dataService（经 studyService 转发）。
 * ============================================================================
 */

import { h, clear, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { showToast } from './toast.js';
import { confirmDialog } from './modal.js';
import studyService from '../services/studyService.js';
import dataService from '../services/dataService.js';

/**
 * @param {object} options
 * @param {object} options.domainMap        domainId → domain
 * @param {(w:object)=>void} options.onOpenWord 点词打开完整卡片
 * @param {(list:Array)=>void} options.onStartReview 用错题开始复习
 * @param {Function} [options.onToggleFavorite]
 */
export function createWrongWordsView(options = {}) {
  const { domainMap = {}, onOpenWord, onStartReview } = options;

  const root = h('div.wrong-view');
  const headHost = h('div');
  const listHost = h('div');
  root.append(headHost, listHost);

  boot();

  async function boot() {
    listHost.replaceChildren(h('div.loading-block', {}, [h('span.spinner'), '正在读取错题本…']));
    let list = [];
    try {
      list = await studyService.buildWrongWords();
    } catch (e) {
      console.warn('[wrongWordsView] 读取失败', e);
      listHost.replaceChildren(h('div.empty', {}, [
        h('div.empty__title', { text: '读取失败' }),
        h('div.empty__desc', { text: e?.message || String(e) }),
      ]));
      return;
    }
    renderHead(list);
    renderList(list);
  }

  function renderHead(list) {
    const totalWrong = list.reduce((n, w) => n + (w.wrongCount || 0), 0);
    clear(headHost);
    headHost.appendChild(h('div.fav-head', {}, [
      h('div.fav-head__title', {}, [
        svgIcon(iconPath('xCircle'), { size: 15 }),
        h('span', { text: '错题本' }),
        h('span.chip', { text: `${list.length} 个词` }),
        h('span.chip', { text: `累计错 ${totalWrong} 次` }),
      ]),
      h('div.fav-head__actions', {}, [
        list.length
          ? h('button.btn.btn--accent', {
              type: 'button',
              onClick: () => {
                if (typeof onStartReview === 'function') onStartReview(list);
              },
            }, [
              svgIcon(iconPath('play'), { size: 13, cls: 'btn__icon' }),
              '从错题本开始复习',
            ])
          : null,
        list.length
          ? h('button.btn.btn--ghost', {
              type: 'button',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: '清空错题本',
                  message: '将删除全部错题记录与作答统计，且无法恢复。确定继续吗？',
                  confirmText: '清空',
                  danger: true,
                });
                if (!ok) return;
                await dataService.clearWrongWords();
                showToast('错题本已清空', { type: 'success' });
                boot();
              },
            }, [svgIcon(iconPath('trash'), { size: 12, cls: 'btn__icon' }), '清空'])
          : null,
      ]),
    ]));
  }

  function renderList(list) {
    if (!list.length) {
      listHost.replaceChildren(h('div.empty', {}, [
        h('div.empty__icon', {}, [svgIcon(iconPath('trophy'), { size: 30 })]),
        h('div.empty__title', { text: '错题本是空的' }),
        h('div.empty__desc', {
          text: '复习时答错的词会自动进入这里，并按错误率排序。连续答对 3 次后会自动移出。',
        }),
      ]));
      return;
    }

    const head = h('div.wrong-head', {}, [
      h('span', { text: '单词' }),
      h('span', { text: '领域' }),
      h('span', { text: '错次' }),
      h('span', { text: '作答' }),
      h('span', { text: '错误率' }),
      h('span', { text: '' }),
    ]);

    const rows = list.map((w) => {
      const dom = domainMap[w.domainId] || null;
      const ratio = Math.round((w.errorRatio || 0) * 100);

      const removeBtn = h('button.wordcard__fav.wrong-row__remove', {
        type: 'button',
        title: '移出错题本',
        'aria-label': '移出错题本',
        style: { position: 'static', opacity: '1' },
        onClick: async (e) => {
          e.stopPropagation();
          await studyService.removeFromWrongWords(w.domainId, w.word);
          showToast(`已移出：${w.word}`, { type: 'success' });
          boot();
        },
      }, [svgIcon(iconPath('trash'), { size: 13 })]);

      return h('button.wrong-row', {
        type: 'button',
        onClick: () => { if (typeof onOpenWord === 'function') onOpenWord(w); },
      }, [
        h('span.wrong-row__word', { text: w.word }),
        h('span.wrong-row__domain', {}, [
          dom ? svgIcon(iconPath(dom.icon || 'domain'), { size: 11, cls: 'btn__icon' }) : null,
          h('span', { text: dom ? dom.name : w.domainId }),
        ]),
        h('span.wrong-row__num', { text: String(w.wrongCount) }),
        h('span.wrong-row__num', { text: String(w.totalAttempts) }),
        h('span.wrong-row__ratio', {}, [
          h('span.wrong-row__ratio-track', {}, [
            h('i.wrong-row__ratio-fill', { style: { width: `${ratio}%` } }),
          ]),
          h('span.wrong-row__ratio-text', { text: `${ratio}%` }),
        ]),
        removeBtn,
      ]);
    });

    listHost.replaceChildren(head, ...rows);
  }

  root.__refresh = boot;
  return root;
}

export default { createWrongWordsView };
