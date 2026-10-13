/**
 * flipCard.js —— 3D 翻转记忆卡片
 * ============================================================================
 * 正面：单词 + 音标 + 领域标签
 * 背面：词根/派生 · 通用释义 · 领域关联释义 · 微故事 · 英文例句
 *
 * 设计约束：
 *   - 卡片组件不直接访问 service，所有数据由调用方（page）注入 props。
 *     这样未来换数据来源（后端 / 分享）时本组件无需改动。
 *   - 背面若尚未生成 AI 材料，展示「本地兜底内容 + 生成按钮」而非空白。
 * ============================================================================
 */

import { h, svgIcon, esc } from '../core/dom.js';
import { iconPath } from '../core/icons.js';

/**
 * @param {object} props
 * @param {object} props.word        词条（含 word/phonetic/translation/root/type）
 * @param {object|null} props.material AI 生成的记忆材料（可为 null）
 * @param {object} props.domain      领域配置（含 name/theme 等）
 * @param {object|null} props.relevance 关联信息 { score, level, evidence, domainTermZh }
 * @param {number} props.index       用于入场动画延迟
 * @param {boolean} props.generating 是否正在生成
 * @param {Function} props.onGenerate 点击生成
 * @param {Function} props.onExpand   点击放大
 * @param {Function} props.onFlip     翻转回调（便于统计）
 */
export function createFlipCard(props) {
  const {
    word, material, domain, relevance, index = 0,
    generating = false, onGenerate, onExpand, onFlip,
  } = props;

  const card = h('article.flip', {
    tabIndex: '0',
    role: 'button',
    'aria-label': `${word.word}${word.phonetic ? ' ' + word.phonetic : ''}，点击翻转查看释义`,
    style: { '--enter-delay': `${Math.min(index * 28, 620)}ms` },
    onClick: () => toggle(),
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowRight' && !isFlipped) { /* 预留键盘导航 */ }
    },
  });

  const inner = h('div.flip__inner');
  const front = buildFront();
  const back = buildBack();
  inner.append(front, back);
  card.appendChild(inner);

  let isFlipped = false;

  function toggle() {
    isFlipped = !isFlipped;
    card.classList.toggle('is-flipped', isFlipped);
    if (isFlipped && typeof onFlip === 'function') onFlip(word);
  }

  function buildFront() {
    const badges = [];

    if (domain) {
      badges.push(h('span.chip.chip--domain', {}, [
        svgIcon(iconPath('domain'), { size: 11 }),
        domain.name,
      ]));
    }

    if (relevance?.level === 'exact') {
      badges.push(h('span.chip.chip--term', { title: relevance.evidence || '' }, [
        svgIcon(iconPath('target'), { size: 11 }),
        relevance.domainTermZh || '专有术语',
      ]));
    } else if (relevance?.level === 'vocab') {
      badges.push(h('span.chip', { title: relevance.evidence || '' }, [
        svgIcon(iconPath('hash'), { size: 11 }),
        '领域相关',
      ]));
    }

    badges.push(h('span.chip', {
      class: word.type === 'derived' ? 'chip--derived' : 'chip--core',
      text: word.type === 'derived' ? '派生词' : '核心词',
    }));

    if (material) {
      badges.push(h('span.chip.chip--term', { title: 'AI 记忆材料已生成' }, [
        svgIcon(iconPath('sparkles'), { size: 11 }),
        '已生成',
      ]));
    }

    return h('div.flip__face.flip__face--front', {}, [
      h('div.flip__rule'),
      h('div.flip__corner.flip__corner--tl'),
      h('div.flip__corner.flip__corner--br'),
      h('div.flip__badges', {}, badges),
      h('div.flip__wordwrap', {}, [
        h('h3.flip__word', { text: word.word }),
        word.phonetic ? h('div.flip__phonetic', { text: word.phonetic }) : null,
        h('div.flip__hint', { text: briefOf(word.translation) }),
      ]),
      h('div.flip__foot', {}, [
        h('span.flip__flipbtn', {
          onClick: (e) => { e.stopPropagation(); toggle(); },
        }, [svgIcon(iconPath('flip'), { size: 13 }), '翻面']),
        relevance?.score
          ? h('span.flip__relevance', { title: relevance.evidence || '' }, [
              '关联 ', h('b', { text: String(relevance.score) }),
            ])
          : null,
      ]),
    ]);
  }

  function buildBack() {
    const scroll = h('div.flip__backscroll', {
      onClick: (e) => e.stopPropagation(),
    });

    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [svgIcon(iconPath('wand'), { size: 12 }), '词根 / 派生']),
      h('div.mat__value', { text: material?.rootNote || word.root || '核心词' }),
    ]));

    scroll.appendChild(h('div.mat__divider'));

    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [svgIcon(iconPath('book'), { size: 12 }), '通用释义']),
      h('div.mat__value', { text: material?.generalMeaning || word.translation || '—' }),
    ]));

    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [svgIcon(iconPath('domain'), { size: 12 }), `领域关联 · ${domain?.name || ''}`]),
      h('div.mat__value.mat__value--soft', {
        text: material?.domainMeaning || localDomainHint(relevance, domain),
      }),
    ]));

    if (material?.story) {
      scroll.appendChild(h('div.mat__section', {}, [
        h('div.mat__label', {}, [svgIcon(iconPath('flame'), { size: 12 }), '微故事 / 场景']),
        h('div.mat__value.mat__value--story', { text: material.story }),
      ]));
    }

    if (material?.example) {
      scroll.appendChild(h('div.mat__section', {}, [
        h('div.mat__label', {}, [svgIcon(iconPath('quill'), { size: 12 }), '英文例句']),
        h('div.mat__value.mat__value--example', { text: material.example }),
        material.exampleZh ? h('div.mat__value--example-zh', { text: material.exampleZh }) : null,
      ]));
    }

    // 尚未生成 AI 材料：给出可操作入口
    if (!material) {
      scroll.appendChild(h('div.mat__divider'));
      scroll.appendChild(h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' },
      }, [
        h('div.mat__value--example-zh', {
          text: generating ? '正在生成更贴合语境的记忆材料…' : '还没有 AI 生成的记忆材料',
        }),
        h('button.btn.btn--accent.btn--sm', {
          type: 'button',
          disabled: generating,
          onClick: (e) => { e.stopPropagation(); onGenerate?.(word); },
        }, generating
          ? [h('span.spinner'), '生成中…']
          : [svgIcon(iconPath('sparkles'), { size: 13, cls: 'btn__icon' }), '生成记忆材料']),
      ]));
    } else {
      scroll.appendChild(h('div.mat__divider'));
      scroll.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onClick: (e) => { e.stopPropagation(); onGenerate?.(word, { regenerate: true }); },
        }, generating ? [h('span.spinner'), '重新生成中…'] : [svgIcon(iconPath('refresh'), { size: 12, cls: 'btn__icon' }), '重新生成']),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onClick: (e) => { e.stopPropagation(); onExpand?.(word); },
        }, [svgIcon(iconPath('expand'), { size: 12, cls: 'btn__icon' }), '放大查看']),
      ]));
    }

    return h('div.flip__face.flip__face--back', {}, [h('div.flip__rule'), scroll]);
  }

  /** 外部可主动翻转（用于「全部翻面」按钮） */
  card.__flip = (force) => {
    const target = typeof force === 'boolean' ? force : !isFlipped;
    if (target === isFlipped) return;
    isFlipped = target;
    card.classList.toggle('is-flipped', isFlipped);
  };
  card.__isFlipped = () => isFlipped;

  return card;
}

/** 正面只显示释义前两个义项，避免剧透太多 */
function briefOf(translation) {
  if (!translation) return '点击卡片查看释义';
  const parts = String(translation).split(/[；;]/).slice(0, 2);
  let s = parts.join('；');
  if (s.length > 46) s = s.slice(0, 46) + '…';
  return s;
}

/** 未生成 AI 材料时，用本地关联信息给出领域提示（不使用任何编造的译名） */
function localDomainHint(relevance, domain) {
  if (!relevance || !domain) return '无直接对应';
  if (relevance.level === 'exact') {
    const zh = relevance.domainTermZh || '【译名待确认】';
    return `在《${domain.name}》中对应官方术语「${zh}」。`;
  }
  if (relevance.level === 'vocab') {
    return `该词在《${domain.name}》的语境中较为常见，可与游戏场景建立联想。`;
  }
  if (relevance.level === 'gloss') {
    return `释义与《${domain.name}》的术语用词接近，可借术语语义加深记忆。`;
  }
  return '无直接对应';
}

export default createFlipCard;
