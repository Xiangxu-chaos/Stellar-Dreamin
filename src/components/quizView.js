/**
 * quizView.js —— 复习 / 做题模式（选择题）
 * ============================================================================
 * 流程（与需求一致）：
 *   1. 题目来源：默认「收藏夹」（复习模式）；也支持 全部卡片 / 当前领域
 *   2. 系统抽题，题型为选择题（英译中 / 中译英 / 混合），4 个选项
 *   3. 用户点击选项 → 立即显示对错
 *   4. 展开该单词的完整卡片（正面单词 + 背面预生成材料 + 配图）
 *   5. 例句直接来自预生成材料（material.example / exampleZh），绝不在运行时调 AI
 *   6. 显示「下一题」按钮
 *   7. 答题历史（对错 / 时间 / 单词）经 quizService → dataService 落 localStorage
 *
 * 数据流全部经由 service 层，本组件不碰 localStorage / fetch / 词库 JSON / AI。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import quizService from '../services/quizService.js';
import domainMaterialService from '../services/domainMaterialService.js';
import { createWordCard } from './wordCard.js';
import { showToast } from './toast.js';

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * @param {object} props
 * @param {object} props.domain       当前领域配置（收藏夹模式为 null）
 * @param {string} props.source       quizService.QUIZ_SOURCES.*（默认 FAVORITES）
 * @param {string} props.type         quizService.QUIZ_TYPES.*
 * @param {number} props.count        题量
 * @param {Array}  props.words        题目池来源（source='all' 时使用）
 * @param {object} props.domainMap    { [domainId]: domainConfig } 跨领域卡片着色
 * @param {boolean} props.showHistory 是否显示「该词答题记录」（收藏夹复习用）
 * @param {boolean} props.showSummary 是否显示内置总结页（功能二：分组复习时传 false，交由组间小结展示）
 * @param {Function} props.onExit
 * @param {Function} props.onRoundEnd (answers) 整轮结束回调（功能二：分组复习落库用）
 * @param {Function} props.onToggleFavorite (word, next, domainId)
 * @param {Function} props.onMoveToMastered (word, domainId, next) 标记熟词 + 从收藏夹移除
 * @param {Function} props.isMastered (word, domainId) => boolean 查询是否已是熟词
 */
export function createQuizView(props) {
  const {
    domain, source = quizService.QUIZ_SOURCES.FAVORITES, type = quizService.QUIZ_TYPES.MIXED,
    count = 10, words = [], domainMap = {}, showHistory = false,
    showSummary = true,
    onExit, onToggleFavorite, onRoundEnd,
    onMoveToMastered, isMastered,
  } = props;

  const root = h('div.quiz-view');
  let questions = [];
  let index = 0;
  let answers = [];      // [{correct, choice}]
  let loading = true;
  let error = null;
  let summaryNotified = false;   // 功能二：整轮结束回调只触发一次

  const progressFill = h('i');
  const counter = h('span.quiz-view__counter');
  const host = h('div');

  root.append(
    h('div.quiz-view__bar', {}, [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        onClick: () => onExit?.(),
      }, [svgIcon(iconPath('arrowLeft'), { size: 12, cls: 'btn__icon' }), '返回']),
      h('div.quiz-view__progress', {}, [progressFill]),
      counter,
    ]),
    host,
  );

  boot();

  async function boot() {
    renderLoading();
    try {
      questions = await quizService.buildQuiz(
        { source, type, count },
        { domainId: domain?.id || null, words },
      );
      loading = false;
      if (!questions.length) {
        renderEmpty();
        return;
      }
      renderCurrent();
    } catch (e) {
      loading = false;
      error = e;
      renderError(e);
    }
  }

  /* ------------------------------------------------------------------ */
  function renderLoading() {
    host.replaceChildren(h('div.loading-block', {}, [
      h('span.spinner'), '正在出题…',
    ]));
  }

  function renderError(e) {
    host.replaceChildren(h('div.empty', {}, [
      h('div.empty__icon', {}, [svgIcon(iconPath('alert'), { size: 28 })]),
      h('div.empty__title', { text: '出题失败' }),
      h('div.empty__desc', { text: e?.message || String(e) }),
      h('button.btn.btn--primary', { type: 'button', onClick: () => boot() }, '重试'),
    ]));
  }

  function renderEmpty() {
    progressFill.style.width = '0%';
    counter.textContent = '';
    host.replaceChildren(h('div.empty', {}, [
      h('div.empty__icon', {}, [svgIcon(iconPath('quiz'), { size: 28 })]),
      h('div.empty__title', {
        text: source === quizService.QUIZ_SOURCES.FAVORITES ? '收藏夹里的词还不够' : '题库不足，无法出题',
      }),
      h('div.empty__desc', {
        text: source === quizService.QUIZ_SOURCES.FAVORITES
          ? '复习模式只从收藏夹取词，至少需要 2 张已收藏的卡片。先去卡片库点星标收藏几张吧。'
          : '当前领域的专有术语不足 2 个。可以切换到「全部卡片」作为题目来源。',
      }),
      h('button.btn', { type: 'button', onClick: () => onExit?.() }, '返回'),
    ]));
  }

  /* ------------------------------------------------------------------ */
  function updateBar() {
    const total = questions.length;
    const pct = total ? Math.round((index / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    const done = answers.length;
    const ok = answers.filter((a) => a.correct).length;
    counter.textContent = `第 ${Math.min(index + 1, total)} / ${total} 题　正确 ${ok}${done ? ` / ${done}` : ''}`;
  }

  function renderCurrent() {
    updateBar();
    if (index >= questions.length) return renderSummary();

    const q = questions[index];
    let answered = false;
    let actionButtons = null;   // 「下一题」按钮引用（移入熟词库后自动滚动到它）

    const optionButtons = [];
    const revealHost = h('div.quiz-reveal');

    const optionsWrap = h('div.quiz-options');
    q.options.forEach((opt, i) => {
      const btn = h('button.quiz-option', {
        type: 'button',
        onClick: () => choose(opt.text),
      }, [
        h('span.quiz-option__key', { text: OPTION_KEYS[i] || String(i + 1) }),
        h('span', { text: opt.text }),
      ]);
      optionButtons.push(btn);
      optionsWrap.appendChild(btn);
    });

    const promptText = q.type === quizService.QUIZ_TYPES.EN_TO_ZH ? q.prompt : q.prompt;
    const isZhPrompt = q.type === quizService.QUIZ_TYPES.ZH_TO_EN;

    const card = h('div.quiz-card', {}, [
      h('div.quiz-card__prompt-label', {
        text: isZhPrompt ? '中译英 · ' + q.promptHint : '英译中 · ' + q.promptHint,
      }),
      h('div.quiz-card__prompt', {
        class: isZhPrompt ? 'quiz-card__prompt--zh' : '',
        text: promptText,
      }),
      !isZhPrompt && q.phonetic ? h('div.quiz-card__phonetic', { text: q.phonetic }) : null,
      optionsWrap,
    ]);

    host.replaceChildren(card, revealHost);
    updateBar();

    /** 用户点选某个选项 */
    async function choose(text) {
      if (answered) return;
      answered = true;

      const correctOpt = q.options.find((o) => o.correct);
      const isCorrect = correctOpt && correctOpt.text === text;

      // 选项视觉反馈
      q.options.forEach((opt, i) => {
        const btn = optionButtons[i];
        btn.disabled = true;
        if (opt.correct) btn.classList.add('quiz-option--correct');
        else if (opt.text === text) btn.classList.add('quiz-option--wrong');
        else btn.classList.add('quiz-option--dim');
      });

      // 落库（判分 + 历史 + 统计）
      try {
        await quizService.submitQuizAnswer(q, text);
      } catch (e) {
        console.warn('[quizView] 记录答题失败', e);
      }

      answers.push({ correct: Boolean(isCorrect), choice: text, word: q.word });
      updateBar();

      // 反馈条
      const verdict = h('div.quiz-verdict', {
        class: isCorrect ? 'quiz-verdict--ok' : 'quiz-verdict--no',
      }, [
        svgIcon(iconPath(isCorrect ? 'checkCircle' : 'xCircle'), { size: 19 }),
        isCorrect ? '回答正确' : `回答错误 · 正确答案：${correctOpt?.text || '—'}`,
      ]);

      // 展开完整卡片（正面 + 背面材料）
      const cardDomain = domainMap[q.domainId] || domain || null;
      const expandedCard = createWordCard({
        word: { ...(q.wordInfo || {}), word: q.word, phonetic: q.phonetic, translation: q.translation },
        material: q.material,
        domain: cardDomain,
        domains: q.domains,
        relevance: q.relevance,
        expanded: true,     // 默认展开背面，直接看到记忆材料
        compact: true,
        onToggleFavorite: onToggleFavorite
          ? (w, next) => onToggleFavorite(w, next, q.domainId)
          : undefined,
        onExpand: () => { /* 结果页不重复弹详情，避免模态嵌套 */ },
      });

      const isLast = index >= questions.length - 1;
      const revealNodes = [
        verdict,
        h('div.quiz-reveal__head', {}, [
          svgIcon(iconPath('layers'), { size: 13 }),
          '完整记忆卡片',
        ]),
        h('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            maxWidth: '340px',
            margin: '0 auto',
          },
        }, [expandedCard]),
      ];

      // 例句区：直接展示预生成材料里已有的例句（不在运行时生成）
      const ex = buildExampleBlock(q.material);
      if (ex) revealNodes.push(ex);

      // 答题记录（收藏夹复习模式）
      if (showHistory) {
        const histBlock = buildHistoryBlock(q.word, q.domainId);
        if (histBlock) revealNodes.push(histBlock);
      }

      const nextBtn = h('button.btn.btn--primary', {
        type: 'button',
        onClick: () => { index += 1; renderCurrent(); },
      }, isLast
        ? [svgIcon(iconPath('trophy'), { size: 14, cls: 'btn__icon' }), '查看成绩']
        : [svgIcon(iconPath('arrowRight'), { size: 14, cls: 'btn__icon' }), '下一题']);
      actionButtons = nextBtn;

      /* ---- 「移入熟词库」按钮（任务二） ----
       * 语义：把该词标记为熟词 → 自动从收藏夹移除（离开收藏夹、进入熟词库）。
       * 已经是熟词时直接把按钮置为「已在熟词库」并禁用，不重复写入。 */
      const already = typeof isMastered === 'function'
        ? Boolean(isMastered(q.word, q.domainId))
        : false;

      const moveBtn = h('button.btn.btn--ghost', {
        type: 'button',
        disabled: already,
        title: already ? '该词已在熟词库中' : '标记为熟词，并从收藏夹移除',
        onClick: async () => {
          if (moveBtn.disabled) return;
          moveBtn.disabled = true;
          try {
            if (typeof onMoveToMastered === 'function') {
              await onMoveToMastered(q.word, q.domainId, true);
            }
            setMoved();
            showToast(`已移入熟词库「${q.word}」`, { type: 'ok', duration: 1800 });
            // 自动滚动到「下一题」，让用户顺畅继续复习
            if (actionButtons) actionButtons.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (e) {
            moveBtn.disabled = false;
            showToast('移入失败', { desc: e?.message || String(e), type: 'err' });
          }
        },
      }, already
        ? [svgIcon(iconPath('checkCircle'), { size: 14, cls: 'btn__icon' }), '已在熟词库']
        : [svgIcon(iconPath('brain'), { size: 14, cls: 'btn__icon' }), '移入熟词库']);

      /** 点击成功后把按钮固定为「已在熟词库」态 */
      function setMoved() {
        moveBtn.disabled = true;
        moveBtn.classList.add('is-on');
        moveBtn.replaceChildren(
          svgIcon(iconPath('checkCircle'), { size: 14, cls: 'btn__icon' }),
          document.createTextNode('已在熟词库'),
        );
      }

      revealNodes.push(h('div', {
        style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '22px', flexWrap: 'wrap' },
      }, [
        nextBtn,
        moveBtn,
        !isLast
          ? h('button.btn.btn--ghost', {
              type: 'button',
              onClick: () => { index += 1; renderCurrent(); },
            }, '跳过')
          : null,
      ]));

      revealHost.replaceChildren(...revealNodes);
      revealHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // 该词历史记录是异步读取的，拿到后再补进 DOM（避免阻塞判定反馈）
      if (showHistory) {
        quizService.getWordHistory(q.word, { domainId: q.domainId || undefined })
          .then((h2) => paintHistory(h2, revealHost))
          .catch(() => { /* 历史读取失败不影响答题 */ });
      }
    }
  }

  /* ------------------------------------------------------------------
   * 例句块：数据来自预生成材料（静态），不在运行时调 AI
   * ---------------------------------------------------------------- */
  function buildExampleBlock(material) {
    const en = material?.example;
    if (!en) return null;
    return h('div.quiz-example', {}, [
      h('div.quiz-example__head', {}, [
        svgIcon(iconPath('quill'), { size: 12 }),
        '英文例句',
        h('span.quiz-example__badge', { text: '来自预生成材料' }),
      ]),
      h('div.quiz-example__en', { text: en }),
      material.exampleZh ? h('div.quiz-example__zh', { text: material.exampleZh }) : null,
    ]);
  }

  /* ------------------------------------------------------------------
   * 答题记录块：容器先占位，异步填充
   * ---------------------------------------------------------------- */
  function buildHistoryBlock(word, domainId) {
    return h('div.quiz-history', { dataset: { word } }, [
      h('div.quiz-history__head', {}, [
        svgIcon(iconPath('history'), { size: 12 }),
        `「${word}」的答题记录`,
      ]),
      h('div.quiz-history__body', {}, [h('div.form-hint', { text: '读取中…' })]),
    ]);
  }

  function paintHistory(hist, hostEl) {
    const box = hostEl.querySelectorAll('.quiz-history__body')[0];
    if (!box) return;
    if (!hist.total) {
      box.replaceChildren(h('div.form-hint', { text: '这是该词的第一次作答。' }));
      return;
    }
    const recent = hist.records.slice(0, 5);
    box.replaceChildren(
      h('div.quiz-history__stats', {}, [
        h('span.chip', {}, `共答 ${hist.total} 次`),
        h('span.chip.chip--source', {}, `对 ${hist.correct} 次`),
        h('span.chip', { class: hist.wrong ? 'chip--warn' : '' }, `错 ${hist.wrong} 次`),
        h('span.chip', {}, `正确率 ${Math.round(hist.accuracy * 100)}%`),
        hist.lastAt ? h('span.chip', {}, `最近 ${formatTime(hist.lastAt)}`) : null,
      ]),
      h('div.quiz-history__list', {}, recent.map((r) => h('div.quiz-history__row', {
        class: r.correct ? 'is-ok' : 'is-no',
      }, [
        svgIcon(iconPath(r.correct ? 'checkCircle' : 'xCircle'), { size: 12 }),
        h('span', { text: formatTime(r.at) }),
        h('span.quiz-history__note', { text: r.note || (r.method === 'choice' ? '选择题' : '输入') }),
        h('span.quiz-history__ans', { text: r.correct ? '答对' : `答错（你选：${r.answer || '—'}）` }),
      ]))),
    );
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ------------------------------------------------------------------ */
  function renderSummary() {
    // 功能二：分组复习时关闭内置总结页，由组间小结（父层）接管
    if (!showSummary) {
      progressFill.style.width = '100%';
      counter.textContent = '已完成';
      if (typeof onRoundEnd === 'function') {
        // 只回调一次，避免父层重复落库
        if (!summaryNotified) {
          summaryNotified = true;
          onRoundEnd(answers.slice());
        }
      }
      host.replaceChildren(h('div.loading-block', {}, [
        h('span.spinner'), '正在统计本组结果…',
      ]));
      return;
    }
    const s = quizService.summarizeQuiz(answers);
    progressFill.style.width = '100%';
    counter.textContent = '已完成';

    const wrongList = answers.filter((a) => !a.correct);

    host.replaceChildren(h('div.quiz-card', {}, [
      h('div.empty', {}, [
        h('div.empty__icon', {}, [
          svgIcon(iconPath(s.accuracy >= 0.8 ? 'trophy' : s.accuracy >= 0.5 ? 'flag' : 'refresh'), { size: 28 }),
        ]),
        h('div.empty__title', {
          text: s.accuracy >= 0.8 ? '表现优秀' : s.accuracy >= 0.5 ? '继续加油' : '再练一轮',
        }),
        h('div.empty__desc', {
          text: `共作答 ${s.total} 题，正确 ${s.correct} 题，正确率 ${Math.round(s.accuracy * 100)}%。答题记录已保存。`,
        }),
      ]),
      h('div.stats-grid', { style: { marginTop: '20px' } }, [
        statBox(s.total, '总题数'),
        statBox(s.correct, '答对'),
        statBox(s.wrong, '答错'),
        statBox(`${Math.round(s.accuracy * 100)}%`, '正确率'),
      ]),
      wrongList.length
        ? h('div', { style: { marginTop: '22px' } }, [
            h('div.detail__section-title', {}, [
              svgIcon(iconPath('xCircle'), { size: 13 }), `答错的 ${wrongList.length} 个词`,
            ]),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' } },
              wrongList.map((a) => h('span.chip.chip--warn', { text: a.word }))),
          ])
        : null,
      h('div', {
        style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '26px', flexWrap: 'wrap' },
      }, [
        h('button.btn.btn--primary', { type: 'button', onClick: () => boot() }, [
          svgIcon(iconPath('refresh'), { size: 14, cls: 'btn__icon' }), '再来一轮',
        ]),
        h('button.btn', { type: 'button', onClick: () => onExit?.() }, '返回'),
      ]),
    ]));
  }

  function statBox(num, label) {
    return h('div.stat-box', {}, [
      h('div.stat-box__num', { text: String(num) }),
      h('div.stat-box__label', { text: label }),
    ]);
  }

  /** 功能二：供分组复习在切换分组时卸载本视图 */
  root.__destroy = () => { summaryNotified = true; };
  root.__answers = () => answers.slice();

  return root;
}

export default createQuizView;
