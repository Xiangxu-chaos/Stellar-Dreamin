/**
 * reviewView.js —— 【已停用】旧版「输入式」复习视图
 * ============================================================================
 * ⚠️ 本轮增量变更（需求二）后，复习模式已改为：
 *     「收藏夹专属选择题」→ 由 components/quizView.js 承担
 *     （source = quizService.QUIZ_SOURCES.FAVORITES，例句直接取自预生成材料）。
 *
 * 本文件已不再被任何页面引用（homePage.startReview 已改走 createQuizView），
 * 保留它只为：
 *   1. 不破坏既有代码结构（增量修改原则：不重写整个项目）；
 *   2. 若未来需要「默写式」复习（看英文 → 手写中文 → 判分），可重新启用。
 *
 * 若要重新启用，请在 homePage 中显式 import 并传入已完成 hydrate 的 words。
 *
 * 原功能：看英文 → 输入中文意思 → 判分 → 展示完整记忆材料 + 答题历史
 * 数据流全部经由 studyService / dataService，本组件不做任何存储访问。
 * ============================================================================
 */

import { h, svgIcon, esc, timeAgo } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import studyService from '../services/studyService.js';
import dataService from '../services/dataService.js';
import { showToast } from './toast.js';

/**
 * @param {object} props
 * @param {object} props.domain    当前领域配置
 * @param {Array} props.words      会话词表（已含 material）
 * @param {Function} props.onExit  退出复习
 * @param {Function} props.onGenerate (word, opts) 按需生成材料（当前版本不使用）
 */
export function createReviewView(props) {
  const { domain, words, onExit, onGenerate } = props;

  const root = h('div.review');
  let index = 0;
  let sessionCorrect = 0;
  let answered = false;

  const progressFill = h('div.progress-fill', { style: { width: '0%' } });
  const progressText = h('span');
  const quizHost = h('div');
  const historyHost = h('div', { style: { marginTop: '8px' } });

  root.append(
    h('div.review__progress', {}, [progressFill, progressText]),
    quizHost,
    h('div', { style: { display: 'flex', justifyContent: 'center' } }, [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        onClick: () => onExit?.(),
      }, [svgIcon(iconPath('arrowLeft'), { size: 13, cls: 'btn__icon' }), '返回词表']),
    ]),
    h('div.detail__section', {}, [
      h('div.detail__section-title', {}, [svgIcon(iconPath('history'), { size: 13 }), '本次答题记录']),
      historyHost,
    ]),
  );

  refreshHistory();

  function updateProgress() {
    const total = words.length;
    const pct = total ? Math.round((index / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${Math.min(index + 1, total)} / ${total}　正确 ${sessionCorrect}`;
  }

  function renderCurrent() {
    updateProgress();
    quizHost.replaceChildren();

    if (index >= words.length) return renderSummary();

    const current = words[index];
    answered = false;

    const input = h('input.quiz__input', {
      type: 'text',
      placeholder: '输入中文意思，例如：抛弃，放弃',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-label': '输入该单词的中文意思',
    });

    const verdictHost = h('div');

    const form = h('form.quiz__form', {
      onSubmit: (e) => { e.preventDefault(); submit(); },
    }, [
      input,
      h('button.btn.btn--primary', { type: 'submit' }, [
        svgIcon(iconPath('check'), { size: 15, cls: 'btn__icon' }), '提交',
      ]),
    ]);

    const quiz = h('div.quiz', {}, [
      h('div.flip__badges', { style: { justifyContent: 'center', marginBottom: '18px' } }, [
        domain ? h('span.chip.chip--domain', {}, [svgIcon(iconPath('domain'), { size: 11 }), domain.name]) : null,
        current.relevance?.level === 'exact'
          ? h('span.chip.chip--term', { text: current.relevance.domainTermZh || '专有术语' }) : null,
        current.__wrong ? h('span.chip', {}, [svgIcon(iconPath('alert'), { size: 11 }), '曾答错']) : null,
        current.material ? h('span.chip.chip--term', {}, [svgIcon(iconPath('sparkles'), { size: 11 }), '材料已就绪']) : null,
      ]),
      h('div.quiz__word', { text: current.word }),
      current.phonetic ? h('div.quiz__ph', { text: current.phonetic }) : null,
      form,
      verdictHost,
      h('div', {
        style: { marginTop: '16px', display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' },
      }, [
        h('span.kbd-hint', {}, [h('span.kbd', { text: 'Enter' }), '提交 / 下一题']),
        h('span.kbd-hint', {}, [h('span.kbd', { text: '?' }), '我不会，直接看答案']),
      ]),
    ]);

    quizHost.appendChild(quiz);
    requestAnimationFrame(() => input.focus());

    function onKey(e) {
      if (e.key === '?' && !answered) {
        e.preventDefault();
        input.value = '';
        submit(true);
      }
    }
    input.addEventListener('keydown', onKey);

    /** 提交作答 */
    async function submit(skipped = false) {
      if (answered) {
        // 已作答时 Enter 视为进入下一题
        index += 1;
        renderCurrent();
        return;
      }
      const userInput = input.value.trim();
      if (!userInput && !skipped) { input.focus(); return; }

      answered = true;
      input.disabled = true;
      const submitBtn = form.querySelector('button[type=submit]');
      if (submitBtn) submitBtn.disabled = true;

      verdictHost.replaceChildren(h('div', {
        style: { display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', padding: '14px', color: 'var(--c-text-soft)' },
      }, [h('span.spinner'), '正在判分…']));

      let result;
      try {
        result = await studyService.submitAnswer(domain.id, current, userInput, { useAI: userInput.length > 0 });
      } catch (e) {
        result = { correct: false, method: 'error', note: e.message };
      }

      if (result.correct) sessionCorrect += 1;
      updateProgress();

      verdictHost.replaceChildren(renderVerdict(current, userInput, result, skipped));

      // 刷新底部历史
      refreshHistory();
    }
  }

  function renderVerdict(word, userInput, result, skipped) {
    const ok = result.correct;
    const box = h('div.quiz__verdict', { class: ok ? 'quiz__verdict--ok' : 'quiz__verdict--no' }, [
      h('div.quiz__verdict-head', {}, [
        svgIcon(iconPath(ok ? 'checkCircle' : 'xCircle'), { size: 19 }),
        ok ? '回答正确' : (skipped ? '已跳过' : '回答错误'),
        result.note ? h('span', { style: { fontWeight: '400', fontSize: '12px', color: 'var(--c-text-soft)' }, text: `· ${result.note}` }) : null,
      ]),
      h('div.detail__sections', {}, [
        h('div.detail__section', {}, [
          h('div.detail__section-title', {}, [svgIcon(iconPath('book'), { size: 12 }), '标准释义']),
          h('div.detail__text', { text: word.translation || '—' }),
        ]),
        word.material?.rootNote || word.root
          ? h('div.detail__section', {}, [
              h('div.detail__section-title', {}, [svgIcon(iconPath('wand'), { size: 12 }), '词根 / 派生']),
              h('div.detail__text.detail__text--soft', { text: word.material?.rootNote || word.root }),
            ])
          : null,
        word.material?.domainMeaning
          ? h('div.detail__section', {}, [
              h('div.detail__section-title', {}, [svgIcon(iconPath('domain'), { size: 12 }), `领域关联 · ${domain.name}`]),
              h('div.detail__text.detail__text--soft', { text: word.material.domainMeaning }),
            ])
          : null,
        word.material?.story
          ? h('div.detail__section', {}, [
              h('div.detail__section-title', {}, [svgIcon(iconPath('flame'), { size: 12 }), '微故事']),
              h('div.detail__story', { text: word.material.story }),
            ])
          : null,
        word.material?.example
          ? h('div.detail__section', {}, [
              h('div.detail__section-title', {}, [svgIcon(iconPath('quill'), { size: 12 }), '英文例句']),
              h('div.detail__example', {}, [
                h('div.detail__example-en', { text: word.material.example }),
                word.material.exampleZh ? h('div.detail__example-zh', { text: word.material.exampleZh }) : null,
              ]),
            ])
          : h('div.notice', { style: { marginBottom: '0' } }, [
              svgIcon(iconPath('info'), { size: 16, cls: 'notice__icon' }),
              h('div', {}, '该词还没有 AI 记忆材料。'),
              h('button.btn.btn--accent.btn--sm', {
                type: 'button',
                onClick: async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  btn.replaceChildren(h('span.spinner'), document.createTextNode(' 生成中…'));
                  try {
                    const { material } = await onGenerate?.(word, { regenerate: false }) || {};
                    if (material) {
                      word.material = material;
                      renderCurrent();
                    }
                  } catch (err) {
                    showToast('生成失败', { desc: err.message, type: 'err' });
                    btn.disabled = false;
                    btn.textContent = '生成';
                  }
                },
              }, '立即生成'),
            ]),
      ]),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '16px' } }, [
        h('button.btn.btn--primary.btn--sm', {
          type: 'button',
          onClick: () => { index += 1; renderCurrent(); },
        }, [svgIcon(iconPath('arrowRight'), { size: 13, cls: 'btn__icon' }), '下一题']),
      ]),
    ]);
    return box;
  }

  function renderSummary() {
    const total = words.length;
    const acc = total ? Math.round((sessionCorrect / total) * 100) : 0;
    progressFill.style.width = '100%';
    progressText.textContent = `已完成 ${total} 题`;

    quizHost.replaceChildren(h('div.quiz', {}, [
      h('div.empty', {}, [
        h('div.empty__icon', {}, [svgIcon(iconPath('star'), { size: 28 })]),
        h('div.empty__title', { text: '本轮复习完成' }),
        h('div.empty__desc', { text: `共作答 ${total} 题，正确 ${sessionCorrect} 题。答题记录已保存到本地。` }),
      ]),
      h('div.stats-grid', { style: { marginTop: '20px' } }, [
        statBox(total, '作答总数'),
        statBox(sessionCorrect, '答对'),
        statBox(total - sessionCorrect, '答错'),
        statBox(`${acc}%`, '正确率'),
      ]),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '24px' } }, [
        h('button.btn.btn--primary', {
          type: 'button',
          onClick: () => {
            index = 0; sessionCorrect = 0;
            // 重新打散顺序
            words.sort(() => Math.random() - 0.5);
            renderCurrent();
          },
        }, [svgIcon(iconPath('refresh'), { size: 14, cls: 'btn__icon' }), '再来一轮']),
        h('button.btn', { type: 'button', onClick: () => onExit?.() }, '返回词表'),
      ]),
    ]));
  }

  function statBox(num, label) {
    return h('div.stat-box', {}, [
      h('div.stat-box__num', { text: String(num) }),
      h('div.stat-box__label', { text: label }),
    ]);
  }

  async function refreshHistory() {
    const history = await dataService.getHistory(domain.id);
    const recent = history.slice(-8).reverse();
    historyHost.replaceChildren();
    if (!recent.length) {
      historyHost.appendChild(h('div.form-hint', { text: '暂无答题记录。完成一次作答后，这里会展示历史。' }));
      return;
    }
    const stats = await dataService.getHistoryStats(domain.id);
    historyHost.appendChild(h('div', {
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--c-text-faint)', marginBottom: '10px' },
    }, [
      h('span', { text: `累计作答 ${stats.total} 次` }),
      h('span', { text: `正确率 ${stats.total ? Math.round(stats.accuracy * 100) : 0}%` }),
      h('span', { text: `涉及 ${stats.byWord.length} 个单词` }),
    ]));
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    for (const r of recent) {
      list.appendChild(h('div.history-item', {}, [
        svgIcon(iconPath(r.correct ? 'checkCircle' : 'xCircle'), {
          size: 17,
          cls: `history-item__mark ${r.correct ? 'history-item__mark--ok' : 'history-item__mark--no'}`,
        }),
        h('span.history-item__word', { text: r.word }),
        h('span.history-item__answer', { text: `你的答案：${r.answer || '（未作答）'}` }),
        h('span.history-item__time', { text: timeAgo(r.at) }),
      ]));
    }
    historyHost.appendChild(list);
  }

  renderCurrent();
  return root;
}

export default createReviewView;
