/**
 * detailModal.js —— 卡片放大 / 详情视图
 * ============================================================================
 * 与 WordCard 共享同一份数据模型，但呈现更完整的排版（适合阅读与复习回顾）。
 *
 * 本轮新增：
 *   - 配图区（顶部大图）：有图显示图，无图显示占位图，加载失败回退占位图
 *   - 配图编辑：用户可手动填入 / 替换图片 URL（存 localStorage，经 dataService）
 *     预留图片上传扩展点（见 image-editor 区域注释）
 *   - 术语来源与严谨性：source 徽标 + unverified → 【译名待确认】
 *   - 多领域标签：显示该词所属的全部兴趣领域
 *
 * 组件不直接访问 localStorage / fetch，全部经由 service 层。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { openModal, confirmDialog } from './modal.js';
import { showToast } from './toast.js';

/**
 * @param {object} props
 * @param {object} props.word
 * @param {object|null} props.material   预生成材料（静态）
 * @param {string} props.image           当前展示图 URL
 * @param {object} props.domain
 * @param {Array}  props.domains         该词所属全部领域标签
 * @param {object|null} props.relevance
 * @param {Function} props.onSaveImage   (word, imageUrl) => Promise   保存图片覆盖
 * @param {Function} props.onToggleFavorite (word, next) => Promise
 * @param {boolean} props.favorite
 */
export function showDetailModal(props) {
  const {
    word, material, domain, relevance, domains = [], favorite = false,
    mastered = false,
    onSaveImage, onToggleFavorite, onToggleMastered,
  } = props;

  let currentImage = props.image || '';
  const body = h('div');

  function render() {
    body.replaceChildren();
    body.appendChild(buildHero());
    body.appendChild(imageSection());
    body.appendChild(h('div.detail__sections', {}, [
      section('wand', '词根 / 派生说明', material?.root || word.root || '核心词'),
      section('book', '通用释义', material?.generalMeaning || word.translation || '—'),
      section('domain', `领域关联释义 · ${domain?.name || ''}`,
        material?.domainMeaning || hint(), true),
      material?.story ? section('flame', '微故事 / 场景联想', material.story, false, 'story') : null,
      exampleSection(),
      sourceSection(),
      metaSection(),
    ]));
  }

  /* ---------------------------------------------------------------- */
  function buildHero() {
    const badges = [];

    /* 领域标签：只显示「当前上下文领域」这一个（修复问题一）。
       旧实现会把 domains 里每个领域都渲染成标签，跨领域词会堆出多个标签。
       domains 数组仍保留在 props 里（内部逻辑可用），但渲染层不再逐个铺开。 */
    if (domain) {
      const selfTag = domains.find((t) => t.id === domain.id || t.domainId === domain.id);
      const isTerm = selfTag?.level === 'exact' || relevance?.level === 'exact';
      const termZh = selfTag?.domainTermZh || relevance?.domainTermZh || '';
      const otherCount = Math.max(0, domains.filter((t) => t.id !== domain.id && t.domainId !== domain.id).length);
      const titleParts = [`${domain.name} 领域`];
      if (otherCount > 0) titleParts.push(`该词也出现在其他 ${otherCount} 个兴趣库中`);
      badges.push(h('span.chip', {
        class: isTerm ? 'chip--domain chip--domain-exact' : 'chip--domain',
        title: titleParts.join(' · '),
        style: domain.theme?.primary ? { '--chip-domain': domain.theme.primary } : {},
      }, [
        svgIcon(iconPath(domain.icon || 'domain'), { size: 11 }),
        domain.name,
        isTerm && termZh ? h('b', { text: `· ${termZh}` }) : null,
      ]));
    }

    if (relevance?.level === 'exact') {
      badges.push(h('span.chip.chip--term', { text: relevance.domainTermZh || '专有术语' }));
    }
    badges.push(h('span.chip', { text: word.type === 'derived' ? '派生词' : '核心词' }));
    badges.push(h('span.chip', { text: word.bank?.toUpperCase() || 'CET6' }));

    return h('div.detail__hero', {}, [
      h('div', { style: { minWidth: '0' } }, [
        h('div.flip__badges', { style: { marginBottom: '10px' } }, badges),
        h('h1.detail__word', { text: word.word }),
        word.phonetic ? h('div.detail__ph', { text: word.phonetic }) : null,
      ]),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
        relevance?.score
          ? h('div', { style: { textAlign: 'right' } }, [
              h('div.stat-box__num', { style: { fontSize: '22px' }, text: String(relevance.score) }),
              h('div.stat-box__label', { text: '领域关联强度' }),
              h('div.form-hint', {
                style: { marginTop: '6px', maxWidth: '220px', textAlign: 'right' },
                text: relevance.evidence || '',
              }),
            ])
          : null,
        onToggleFavorite
          ? h('button.btn.btn--ghost.btn--icon', {
              type: 'button',
              class: favorite ? 'is-on' : '',
              title: favorite ? '取消收藏' : '收藏',
              style: favorite ? { color: '#ffce7a', borderColor: 'rgba(255,206,122,0.5)' } : {},
              onClick: async (e) => {
                const btn = e.currentTarget;
                const next = !favorite;
                await onToggleFavorite(word, next);
                favorite = next;
                btn.classList.toggle('is-on', next);
                btn.setAttribute('title', next ? '取消收藏' : '收藏');
                btn.style.color = next ? '#ffce7a' : '';
                btn.style.borderColor = next ? 'rgba(255,206,122,0.5)' : '';
                btn.replaceChildren(svgIcon(iconPath(next ? 'starFill' : 'star'), { size: 16 }));
              },
            }, [svgIcon(iconPath(favorite ? 'starFill' : 'star'), { size: 16 })])
          : null,
        /* 功能三：详情页也可直接标记熟词 */
        onToggleMastered
          ? h('button.btn.btn--ghost.btn--icon', {
              type: 'button',
              class: mastered ? 'is-on' : '',
              title: mastered ? '取消「熟词」标记' : '标记为熟词',
              style: mastered ? { color: '#8fe3b0', borderColor: 'rgba(143,227,176,0.5)' } : {},
              onClick: async (e) => {
                const btn = e.currentTarget;
                const next = !mastered;
                await onToggleMastered(word, next);
                mastered = next;
                btn.classList.toggle('is-on', next);
                btn.setAttribute('title', next ? '取消「熟词」标记' : '标记为熟词');
                btn.style.color = next ? '#8fe3b0' : '';
                btn.style.borderColor = next ? 'rgba(143,227,176,0.5)' : '';
                btn.replaceChildren(svgIcon(iconPath(next ? 'checkCircle' : 'brain'), { size: 16 }));
              },
            }, [svgIcon(iconPath(mastered ? 'checkCircle' : 'brain'), { size: 16 })])
          : null,
      ]),
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* 配图区 + 图片 URL 编辑                                            */
  /* ---------------------------------------------------------------- */
  function imageSection() {
    const fig = h('div.detail__figure');

    function paint() {
      fig.replaceChildren();
      if (currentImage) {
        fig.appendChild(h('img', {
          src: currentImage,
          alt: `${word.word} 配图`,
          referrerPolicy: 'no-referrer',
          onError: () => {
            fig.replaceChildren(buildFigureEmpty('图片加载失败，已回退到占位图'));
          },
        }));
      } else {
        fig.appendChild(buildFigureEmpty('暂无配图'));
      }
    }
    paint();

    const input = h('input.input', {
      type: 'text',
      value: currentImage,
      placeholder: '粘贴图片 URL（游戏卡面 / 遗物图标 / 角色立绘 / 场景截图）',
      spellcheck: 'false',
    });

    const saveBtn = h('button.btn.btn--sm', { type: 'button' }, [
      svgIcon(iconPath('check'), { size: 12, cls: 'btn__icon' }), '保存图片',
    ]);
    saveBtn.addEventListener('click', async () => {
      const url = input.value.trim();
      await onSaveImage?.(word, url);
      currentImage = url;
      paint();
      showToast(url ? '已更新配图' : '已清除配图', { type: 'ok' });
    });

    const clearBtn = h('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      onClick: async () => {
        input.value = '';
        await onSaveImage?.(word, '');
        currentImage = '';
        paint();
        showToast('已恢复为预置图', { type: 'info' });
      },
    }, [svgIcon(iconPath('refresh'), { size: 12, cls: 'btn__icon' }), '恢复预置']);

    // 预留：图片上传扩展点。
    // 未来接入时，把 input[type=file] 选中的文件交给 storage 服务（如云存储），
    // 拿回 URL 后复用 setImageOverride(domainId, word, url)，数据结构无需变更。
    const uploadBtn = h('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      disabled: true,
      title: '图片上传将在后续版本开放（数据结构已预留）',
    }, [svgIcon(iconPath('upload'), { size: 12, cls: 'btn__icon' }), '上传图片（待开放）']);

    return h('div.detail__section', {}, [
      h('div.detail__section-title', {}, [svgIcon(iconPath('image'), { size: 13 }), '卡片配图']),
      fig,
      h('div.image-editor', {}, [
        h('div.image-editor__row', {}, [input, saveBtn, clearBtn, uploadBtn]),
        h('div.form-hint', {
          text: '图片版权归游戏开发商 / 原发布方及原作者所有，此处仅作个人学习用途展示，不用于任何商业场景。',
        }),
      ]),
    ]);
  }

  function buildFigureEmpty(text) {
    return h('div.detail__figure-empty', {}, [
      svgIcon(iconPath('imageOff'), { size: 26 }),
      h('span', { text }),
    ]);
  }

  /* ----------------------------------------------------------------
   * 已移除：domainTagsSection()（「该词所属的 N 个兴趣领域」整块）
   *
   * 修复问题一：需求明确要求「去掉所有『这个词也属于 XX 领域』之类的提示」。
   * 跨领域信息已降级为 hero 区领域标签上的悬停 title：
   *   「XX 领域 · 该词也出现在其他 N 个兴趣库中」
   * 这样既不占版面，也不完全丢失「同一个词可跨领域」这一事实。
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  function sourceSection() {
    if (!material) return null;
    const rows = [];
    if (material.source) {
      rows.push(h('span.chip.chip--source', {}, [
        svgIcon(iconPath('verified'), { size: 11 }), `译名来源：${material.source}`,
      ]));
    }
    if (material.unverified) {
      rows.push(h('span.chip.chip--warn', {}, [
        svgIcon(iconPath('question'), { size: 11 }), '译名待确认',
      ]));
    }
    if (!rows.length) return null;
    return h('div.detail__section', {}, [
      h('div.detail__section-title', {}, [svgIcon(iconPath('verified'), { size: 13 }), '术语来源与严谨性']),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, rows),
      material.unverified
        ? h('div.form-hint', {
            text: '该词无法确认官方中文译名，已按「禁止自行翻译」原则标注为待确认，请以游戏内实际文本为准。',
          })
        : h('div.form-hint', {
            text: '译名依据权威来源核验。由于本词属于专有术语，卡片背面使用该领域的官方中文译名，未使用通用词典释义。',
          }),
    ]);
  }

  /* ---------------------------------------------------------------- */
  function section(iconName, label, text, soft = false, variant = '') {
    return h('div.detail__section', {}, [
      h('div.detail__section-title', {}, [svgIcon(iconPath(iconName), { size: 13 }), label]),
      h('div', {
        class: variant === 'story' ? 'detail__story' : (soft ? 'detail__text detail__text--soft' : 'detail__text'),
        text,
      }),
    ]);
  }

  /**
   * 英文例句区 —— 卡片上展示的词**必须**有现成的、包含该词的完整英文例句。
   * ⚠️ 已废弃「造句练习」兜底文案，不再引导用户自己造句。
   * 无材料时只显示「暂无例句」（数据层已批量补全，正常不会出现）。
   */
  function exampleSection() {
    const hasExample = Boolean(material?.example && String(material.example).trim());
    return h('div.detail__section', {}, [
      h('div.detail__section-title', {}, [
        svgIcon(iconPath('quill'), { size: 13 }),
        '英文例句',
      ]),
      h('div.detail__example', {}, [
        hasExample
          ? h('div.detail__example-en', { text: material.example })
          : h('div.detail__example-en.detail__example-en--empty', { text: '暂无例句' }),
        hasExample && material.exampleZh
          ? h('div.detail__example-zh', { text: material.exampleZh })
          : null,
      ]),
    ]);
  }

  function metaSection() {
    const rows = [];
    rows.push(h('span.chip', {}, [
      svgIcon(iconPath('database'), { size: 11 }),
      '预生成静态材料',
    ]));
    if (!material) {
      rows.push(h('span.chip', { text: '该词暂无预生成材料' }));
    }
    if (!rows.length) return null;
    return h('div.detail__section', {}, [
      h('div.detail__section-title', {}, [svgIcon(iconPath('info'), { size: 13 }), '附加信息']),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, rows),
    ]);
  }

  function hint() {
    if (relevance?.level === 'exact') {
      return `在《${domain.name}》中对应官方术语「${relevance.domainTermZh || '【译名待确认】'}」。`;
    }
    if (relevance?.level === 'vocab') return `该词在《${domain.name}》语境中较常见，可与游戏场景建立联想。`;
    return '该词与当前领域暂无直接对应关系。';
  }

  render();

  const m = openModal({
    title: word.word,
    subtitle: `${word.phonetic || ''}${domain ? ' · ' + domain.name : ''}`,
    width: 'wide',
    body,
    footer: [
      h('div.form-hint', { style: { flex: '1' }, text: '记忆材料为内置静态数据，打开即读，无需联网或 API Key。' }),
      h('button.btn', { type: 'button', onClick: () => m.close() }, '关闭'),
    ],
  });

  return m;
}

export default showDetailModal;
