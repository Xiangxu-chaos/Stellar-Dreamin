/**
 * reviewGroupView.js —— 功能二：复习分组
 * ============================================================================
 * 复习模式的完整流程外壳：
 *
 *   ① 设置页 group-setup
 *        - 选择每组词数（10 / 20 / 30 / 50，默认 20）
 *        - 勾选「包含熟词」（默认排除熟词）
 *        - 显示「共 X 组，每组 Y 词」→ 按钮「开始第 1 组」
 *
 *   ② 组内答题：复用已有 createQuizView（不重写做题 UI）
 *        每组结束后不显示 quizView 自带的总结页，而是回调出来展示「组间小结」。
 *
 *   ③ 组间小结 group-summary
 *        - 本组正确率 / 正确数 / 错误数
 *        - 进度「已完成 2 / 5 组」+ 圆点指示
 *        - 按钮「继续下一组」「返回收藏夹」
 *
 *   ④ 全部完成 → 总结页（所有组累计）
 *
 * 落库：每组结束调用 dataService.saveQuizSession（经 studyService.saveGroupResult 转发），
 *       不在此组件内直接触碰 localStorage。
 * ============================================================================
 */

import { h, clear, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { showToast } from './toast.js';
import { createQuizView } from './quizView.js';
import studyService from '../services/studyService.js';

const SIZES = studyService.REVIEW_GROUP_SIZES || [10, 20, 30, 50];
const DEFAULT_SIZE = studyService.DEFAULT_REVIEW_GROUP_SIZE || 20;

/**
 * @param {object} options
 * @param {string|null} options.domainId     可选：只看某个收藏领域
 * @param {object|null} options.domain       当前领域（设置页标题用）
 * @param {object} options.domainMap         domainId → domain（卡片标签用）
 * @param {Function} options.onExit          退出复习（回收藏夹/主界面）
 * @param {Function} [options.onToggleFavorite]
 * @param {Function} [options.onMoveToMastered] (word, domainId, next) 移入熟词库（功能：复习流转）
 * @param {Function} [options.isMastered]      (word, domainId) => boolean
 * @param {(state:object)=>void} [options.onProgress] 进度回调（供父层展示）
 */
export function createReviewGroupView(options = {}) {
  const {
    domainId = null,
    domain = null,
    domainMap = {},
    onExit,
    onToggleFavorite,
    onMoveToMastered,
    isMastered,
    onProgress,
  } = options;

  const root = h('div.review-group');

  /** 会话级状态 */
  let sessionId = null;
  let sessionStartedAt = 0;
  let groups = [];
  let groupSize = DEFAULT_SIZE;
  let includeMastered = false;
  let currentGroup = 0;        // 0-based
  /** 已落盘的分组统计 [{groupIndex, words, correctCount, wrongCount}] */
  const finishedGroups = [];

  let mountedChild = null;     // 当前挂载的 quizView（便于卸载）

  boot();

  /* ---------------------------------------------------------------------
   * ① 设置页
   * ------------------------------------------------------------------ */
  async function boot() {
    clear(root);
    root.appendChild(buildSetupLoading());
    try {
      const prep = await studyService.buildReviewGroups({ domainId, groupSize, includeMastered });
      groups = prep.groups;
      groupSize = prep.groupSize;
      includeMastered = prep.includeMastered;
      renderSetup(prep);
    } catch (e) {
      console.warn('[reviewGroupView] 准备分组失败', e);
      renderSetupError(e);
    }
  }

  function buildSetupLoading() {
    return h('div.quiz-view__loading', {}, [
      h('div.spinner'),
      h('span', { text: '正在整理收藏夹并分组…' }),
    ]);
  }

  function renderSetupError(e) {
    clear(root);
    root.appendChild(h('div.empty', {}, [
      h('div.empty__title', { text: '无法开始复习' }),
      h('div.empty__desc', { text: (e && e.message) || '收藏夹读取失败，请稍后重试' }),
      h('div', { style: { marginTop: '14px' } }, [
        h('button.btn.btn--accent', {
          type: 'button', text: '返回收藏夹',
          onClick: () => { if (typeof onExit === 'function') onExit(); },
        }),
      ]),
    ]));
  }

  /**
   * 设置页：每组词数 + 是否包含熟词 + 分组预览
   * 不重新请求数据 —— 改「每组词数」只重新切分本地池，交互更快。
   */
  function renderSetup(prep) {
    clear(root);

    const pool = prep ? prep.groups.flat() : groups.flat();
    const excluded = prep ? prep.excludedMastered : 0;

    const hint = h('div.group-setup__summary');
    const sizeOpts = h('div.group-setup__opts');
    let pendingIncludeMastered = includeMastered;

    const sizeButtons = SIZES.map((n) => {
      const btn = h('button.btn.btn--sm', {
        type: 'button',
        class: n === groupSize ? 'btn--accent' : '',
        text: `${n} 词`,
        onClick: () => {
          if (n === groupSize) return;
          groupSize = n;
          sizeButtons.forEach((b) => b.classList.remove('btn--accent'));
          btn.classList.add('btn--accent');
          paintHint();
        },
      });
      return btn;
    });
    sizeOpts.append(...sizeButtons);

    const includeBox = h('input', {
      type: 'checkbox',
      checked: pendingIncludeMastered,
      onChange: async (e) => {
        const next = Boolean(e.target.checked);
        if (next === pendingIncludeMastered) return;
        pendingIncludeMastered = next;
        includeMastered = next;
        // 包含熟词会改变参与复习的词集合 → 需要重新分组
        const keepSize = groupSize;
        const rePrep = await studyService.buildReviewGroups({ domainId, groupSize: keepSize, includeMastered });
        groups = rePrep.groups;
        paintHint();
      },
    });

    /** 根据当前 groupSize 重新计算分组预览（本地切分，无需再读存储） */
    function recount() {
      const size = groupSize;
      const n = Math.max(1, Math.ceil(pool.length / size));
      return { groups: n, size, total: pool.length };
    }

    function paintHint() {
      const { groups: g, size, total } = recount();
      if (total === 0) {
        hint.replaceChildren(h('span', {
          text: pendingIncludeMastered
            ? '收藏夹还是空的。先去卡片库收藏一些单词，再回来复习。'
            : '收藏夹里没有可复习的词（熟词已被排除，可勾选「包含熟词」）。',
        }));
        startBtn.disabled = true;
        return;
      }
      startBtn.disabled = false;
      hint.replaceChildren(
        h('span', { text: '共 ' }),
        h('b', { text: String(g) }),
        h('span', { text: ' 组，每组最多 ' }),
        h('b', { text: String(size) }),
        h('span', { text: ' 词，合计 ' }),
        h('b', { text: String(total) }),
        h('span', { text: ' 词' }),
        excluded > 0 && !pendingIncludeMastered
          ? h('span', { text: `（已自动排除 ${excluded} 个熟词）` })
          : null,
      );
    }

    const startBtn = h('button.btn.btn--accent', {
      type: 'button',
      onClick: () => {
        if (!pool.length) {
          showToast('收藏夹为空，无法开始复习', { type: 'warn' });
          return;
        }
        // 用最新 groupSize 重新切分
        const reshuffled = shuffle(pool);
        const size = groupSize;
        const gs = [];
        for (let i = 0; i < reshuffled.length; i += size) gs.push(reshuffled.slice(i, i + size));
        groups = gs;
        beginSession();
      },
    }, [
      svgIcon(iconPath('play'), { size: 13, cls: 'btn__icon' }),
      '开始第 1 组',
    ]);

    const backBtn = h('button.btn.btn--ghost', {
      type: 'button',
      text: '返回收藏夹',
      onClick: () => { if (typeof onExit === 'function') onExit(); },
    });

    paintHint();

    root.appendChild(h('div.group-setup', {}, [
      h('div.group-setup__row', {}, [
        h('div.group-setup__label', {}, [
          h('span', { text: '每组多少个词？' }),
        ]),
        sizeOpts,
      ]),
      h('label.check-line', {}, [
        includeBox,
        h('span.check-line__text', {}, [
          h('span.check-line__title', { text: '包含熟词' }),
          h('span.check-line__hint', {
            text: '默认跳过已标记为「熟词」的卡片；勾选后可一起复习。',
          }),
        ]),
      ]),
      hint,
      h('div.dp-foot', {}, [
        backBtn,
        h('div.spacer'),
        startBtn,
      ]),
    ]));
  }

  /* ---------------------------------------------------------------------
   * ② 会话开始 / 组内答题
   * ------------------------------------------------------------------ */
  function beginSession() {
    sessionId = newSessionId();
    sessionStartedAt = Date.now();
    finishedGroups.length = 0;
    currentGroup = 0;
    emitProgress();
    renderGroup(currentGroup);
  }

  function newSessionId() {
    return `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function emitProgress() {
    if (typeof onProgress === 'function') {
      onProgress({
        sessionId,
        currentGroup: currentGroup + 1,
        totalGroups: groups.length,
        finished: finishedGroups.length,
      });
    }
  }

  function unmountChild() {
    if (mountedChild && mountedChild.__destroy) mountedChild.__destroy();
    mountedChild = null;
  }

  /** 渲染第 idx 组（0-based），用已有 quizView 做题 */
  function renderGroup(idx) {
    unmountChild();
    clear(root);
    currentGroup = idx;

    const words = groups[idx] || [];
    if (!words.length) { renderFinalSummary(); return; }

    // 复用现有做题组件：domain 传 null 让它从 words 取材
    const view = createQuizView({
      domain: null,
      source: 'favorites',
      type: 'mixed',
      count: words.length,
      words,
      domainMap,
      showHistory: false,
      showSummary: false,          // 关键：关掉自带总结页，交给组间小结
      onExit: () => renderGroupSummary(idx, null, true),
      onToggleFavorite,
      onMoveToMastered,
      isMastered,
      onRoundEnd: (answers) => handleGroupFinished(idx, answers),
    });

    mountedChild = view;
    root.appendChild(buildGroupBar(idx));
    root.appendChild(view);
    emitProgress();
  }

  /** 组顶部条：第 X 组 / 共 Y 组 + 进度圆点 */
  function buildGroupBar(idx) {
    const dots = h('div.group-dots');
    for (let i = 0; i < groups.length; i += 1) {
      dots.appendChild(h('span.group-dot', {
        class: i < idx ? 'is-done' : i === idx ? 'is-current' : '',
        title: `第 ${i + 1} 组`,
      }));
    }
    return h('div.quiz-view__bar', {}, [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        onClick: () => renderGroupSummary(idx, null, true),
      }, [svgIcon(iconPath('arrowLeft'), { size: 12, cls: 'btn__icon' }), '结束本轮']),
      h('div', { style: { flex: '1' } }, []),
      h('span.quiz-view__counter', { text: `第 ${idx + 1} / ${groups.length} 组` }),
      dots,
    ]);
  }

  /** 一组作答完成 → 落库 + 展示组间小结 */
  async function handleGroupFinished(idx, answers) {
    const list = Array.isArray(answers) ? answers : [];
    // 防止重复落库（quizView 可能同时触发 onAnswer 与 onRoundEnd）
    if (finishedGroups.some((g) => g.groupIndex === idx + 1)) return;

    const words = list.map((a) => ({
      word: a.word && a.word.word ? a.word.word : (a.word || ''),
      domainId: (a.word && a.word.domainId) || domainId || 'unknown',
      correct: Boolean(a.correct),
    }));
    const correctCount = words.filter((w) => w.correct).length;
    const record = {
      sessionId,
      startedAt: sessionStartedAt,
      finishedAt: Date.now(),
      groupIndex: idx + 1,
      totalGroups: groups.length,
      wordCount: words.length,
      correctCount,
      wrongCount: words.length - correctCount,
      words,
    };

    try {
      await studyService.saveGroupResult(record);
    } catch (e) {
      console.warn('[reviewGroupView] 保存分组结果失败', e);
    }
    finishedGroups.push(record);
    emitProgress();
    renderGroupSummary(idx, record);
  }

  /* ---------------------------------------------------------------------
   * ③ 组间小结
   * ------------------------------------------------------------------ */
  function renderGroupSummary(idx, record, aborted = false) {
    unmountChild();
    clear(root);

    const rec = record || finishedGroups.find((g) => g.groupIndex === idx + 1) || null;
    const total = rec ? rec.wordCount : 0;
    const correct = rec ? rec.correctCount : 0;
    const wrong = rec ? rec.wrongCount : 0;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    const isLast = idx + 1 >= groups.length;
    const isFirst = idx === 0;

    const dots = h('div.group-dots', { style: { justifyContent: 'center' } });
    for (let i = 0; i < groups.length; i += 1) {
      const done = finishedGroups.some((g) => g.groupIndex === i + 1);
      dots.appendChild(h('span.group-dot', {
        class: done ? 'is-done' : i === idx ? 'is-current' : '',
        title: `第 ${i + 1} 组`,
      }));
    }

    const actions = [];
    if (aborted && isFirst) {
      actions.push(h('button.btn.btn--accent', {
        type: 'button', text: '返回设置', onClick: () => boot(),
      }));
      actions.push(h('button.btn.btn--ghost', {
        type: 'button', text: '返回收藏夹',
        onClick: () => { if (typeof onExit === 'function') onExit(); },
      }));
      root.appendChild(h('div.empty', {}, [
        h('div.empty__title', { text: '本轮已结束' }),
        h('div.empty__desc', { text: '尚未完成任何分组，本次进度未记录。' }),
        h('div', { style: { marginTop: '16px', display: 'flex', gap: '10px' } }, actions),
      ]));
      return;
    }

    actions.push(
      h('button.btn.btn--ghost', {
        type: 'button', text: '返回收藏夹',
        onClick: () => { if (typeof onExit === 'function') onExit(); },
      }),
    );
    if (!isLast) {
      actions.push(h('button.btn.btn--accent', {
        type: 'button',
        onClick: () => renderGroup(idx + 1),
      }, [
        svgIcon(iconPath('arrowRight'), { size: 13, cls: 'btn__icon' }),
        `继续第 ${idx + 2} 组`,
      ]));
    } else {
      actions.push(h('button.btn.btn--accent', {
        type: 'button',
        onClick: () => renderFinalSummary(),
      }, [
        svgIcon(iconPath('trophy'), { size: 13, cls: 'btn__icon' }),
        '查看本轮总结',
      ]));
    }

    root.appendChild(h('div.empty', {}, [
      h('div.empty__title', { text: `第 ${idx + 1} 组完成` }),
      h('div.empty__desc', {
        text: `已完成 ${finishedGroups.length} / ${groups.length} 组`,
      }),
      dots,
      h('div.group-stats', { style: { marginTop: '18px', width: '100%', maxWidth: '460px' } }, [
        statBox(`${accuracy}%`, '本组正确率', ''),
        statBox(String(correct), '答对', 'ok'),
        statBox(String(wrong), '答错', 'bad'),
      ]),
      h('div', { style: { marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' } }, actions),
    ]));
  }

  function statBox(num, label, variant) {
    return h('div.group-stats__box', {}, [
      h('div.group-stats__num', { class: variant ? `group-stats__num--${variant}` : '', text: num }),
      h('div.group-stats__label', { text: label }),
    ]);
  }

  /* ---------------------------------------------------------------------
   * ④ 全部完成总结
   * ------------------------------------------------------------------ */
  function renderFinalSummary() {
    unmountChild();
    clear(root);

    const total = finishedGroups.reduce((n, g) => n + g.wordCount, 0);
    const correct = finishedGroups.reduce((n, g) => n + g.correctCount, 0);
    const wrong = total - correct;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;

    root.appendChild(h('div.empty', {}, [
      h('div.empty__icon', {}, [svgIcon(iconPath('trophy'), { size: 34 })]),
      h('div.empty__title', { text: '本轮复习完成' }),
      h('div.empty__desc', {
        text: `共 ${finishedGroups.length} 组、${total} 词，错词已自动进入错题本。`,
      }),
      h('div.group-stats', { style: { marginTop: '18px', width: '100%', maxWidth: '460px' } }, [
        statBox(`${accuracy}%`, '总正确率', ''),
        statBox(String(correct), '答对', 'ok'),
        statBox(String(wrong), '答错', 'bad'),
      ]),
      h('div', { style: { marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' } }, [
        h('button.btn.btn--ghost', {
          type: 'button', text: '再复习一轮', onClick: () => boot(),
        }),
        h('button.btn.btn--accent', {
          type: 'button', text: '返回收藏夹',
          onClick: () => { if (typeof onExit === 'function') onExit(); },
        }),
      ]),
    ]));
  }

  /* 外部接口 */
  root.__destroy = () => unmountChild();
  root.__state = () => ({
    sessionId,
    currentGroup: currentGroup + 1,
    totalGroups: groups.length,
    finished: finishedGroups.length,
  });

  return root;
}

/** Fisher–Yates（局部副本，避免依赖外部） */
function shuffle(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default { createReviewGroupView };
