/**
 * wordCard.js —— 独立的单词卡片组件（本轮新增）
 * ============================================================================
 * 为什么单独拆出来：
 *   同一张卡片需要在三个地方复用且行为一致 ——
 *     1. 卡片库（homePage 网格 / 列表）
 *     2. 收藏夹
 *     3. 做题结果页
 *   如果把卡片逻辑写在 homePage 里，收藏夹与做题页就得复制一遍，
 *   后续任何视觉改动都要改三处。拆成组件后只有这一个数据源。
 *
 * 本轮变更：
 *   - 配图：图片功能已彻底移除。卡片统一渲染固定 16/9 的「暂无配图」占位块，
 *     不加载任何外部图片链接，不存在随机图库 / 图片抓取逻辑。
 *   - 领域标签：**只渲染当前上下文所属的那一个领域**（修复问题一）。
 *     `word.domains` 数组在数据结构上保留（内部逻辑仍用），但渲染层不消费，
 *     避免一个跨多个领域的词在正面堆出多个标签把布局撑爆。
 *   - 收藏星标：右上角，点击切换（通过 onToggleFavorite 回调，组件不碰存储）。
 *   - 术语来源严谨性：`material.source` 展示为来源徽标；
 *     `material.unverified === true` 时标注【译名待确认】。
 *
 * 设计约束：
 *   - 组件不直接访问 service / localStorage，所有数据由调用方注入 props。
 *   - 组件不发起任何 AI 调用 —— 记忆材料是静态数据。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';

/**
 * @param {object} props
 * @param {object} props.word        词条（word/phonetic/translation/root/type，可含 domains）
 * @param {object|null} props.material 预生成记忆材料（静态）
 * @param {object} props.domain      当前上下文领域配置（含 name/theme/icon）—— 卡片只渲染这一个
 * @param {Array}  props.domains     该词所属的全部领域（仅用于生成悬停提示里的「其他 N 个领域」，不渲染成标签）
 * @param {object|null} props.relevance 关联信息
 * @param {number} props.index       入场动画延迟
 * @param {boolean} props.favorite   是否已收藏（初值；之后由组件内部维护）
 * @param {boolean} props.selected   是否已勾选（学习清单）
 * @param {boolean} props.expanded   做题结果页用：默认展开背面
 * @param {boolean} props.compact    紧凑模式（收藏夹/结果页）
 * @param {Function} props.onExpand        点击放大
 * @param {Function} props.onFlip          翻转回调
 * @param {Function} props.onToggleFavorite(word, next)  切换收藏（落库由父层负责）
 * @param {Function} props.onToggleSelect  (word)
 */
export function createWordCard(props) {
  const {
    word, material, domain, relevance, index = 0,
    favorite = false, selected = false, expanded = false, compact = false,
    mastered = false,
    onExpand, onFlip, onToggleFavorite, onToggleSelect, onToggleMastered,
  } = props;

  const domainTags = props.domains || word.domains || [];
  let isFlipped = Boolean(expanded);
  /**
   * 收藏状态的「唯一真相」。
   * 初值来自 props；之后由点击或外部 __setFavorite() 更新。
   * 不再从 DOM class 反推，避免乐观 UI 与真实状态脱钩。
   */
  let favoriteState = Boolean(favorite);
  /** 熟词状态的「唯一真相」（功能三），与收藏同构 */
  let masteredState = Boolean(mastered);

  const card = h('article.wordcard', {
    class: [
      compact ? 'wordcard--compact' : '',
      isFlipped ? 'is-flipped' : '',
      favoriteState ? 'is-favorite' : '',
      selected ? 'is-selected' : '',
      masteredState ? 'is-mastered' : '',
    ].filter(Boolean).join(' '),
    tabIndex: '0',
    role: 'button',
    'aria-label': `${word.word}${word.phonetic ? ' ' + word.phonetic : ''}，点击翻转查看释义`,
    style: { '--enter-delay': `${Math.min(index * 28, 620)}ms` },
    onClick: () => toggle(),
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    },
  });

  const inner = h('div.wordcard__inner');
  inner.append(buildFront(), buildBack());
  card.appendChild(inner);

  // 收藏星标 / 熟词徽标浮在卡片外，不参与翻转
  if (typeof onToggleFavorite === 'function') {
    card.appendChild(buildFavoriteBtn());
  }
  if (masteredState) {
    card.appendChild(buildMasteredBadge());
  }

  function toggle() {
    isFlipped = !isFlipped;
    card.classList.toggle('is-flipped', isFlipped);
    if (isFlipped && typeof onFlip === 'function') onFlip(word);
  }

  /* -------------------------------------------------------------------------
   * 配图区域：图片功能已彻底移除。
   *
   * 现在卡片上只保留一个固定宽高比（16/9）的占位块，统一显示「暂无配图」，
   * 保证「有图 / 无图」时卡片布局始终一致、绝对不被撑破。
   * 不加载任何外部图片链接，也不存在任何图片抓取逻辑。
   * ---------------------------------------------------------------------- */
  function buildFigure(variant) {
    const host = h('div', {
      class: variant === 'front'
        ? 'wordcard__figure is-placeholder'
        : 'wordcard__figure wordcard__figure--back is-placeholder',
    });
    host.appendChild(buildPlaceholder());
    return host;
  }

  function buildPlaceholder() {
    return h('div.wordcard__ph-figure', {}, [
      svgIcon(iconPath(domain?.icon || 'image'), { size: 22 }),
      h('span', { text: word.type === 'derived' ? '派生词' : '暂无配图' }),
    ]);
  }

  /* -------------------------------------------------------------------------
   * 领域标签（只渲染「当前上下文所属领域」这一个）
   *
   * ⚠️ 修复记录（问题一：多领域标签导致装不下）：
   *   旧实现会把 `word.domains` 里的**每一个**领域都渲染成一个标签，
   *   同一个词被多个兴趣库命中时，正面会堆出 3~4 个标签把布局撑爆，
   *   还会出现「这个词也属于 XX 领域」这类干扰当前阅读上下文的信息。
   *
   *   现在改为：**只渲染当前领域一个标签**。
   *   - `domains` 数组在数据结构上完整保留（内部逻辑、筛选、去重仍需要它），
   *     但渲染层不再消费它 —— 渲染与内部逻辑解耦。
   *   - 当前领域取 props.domain（由调用方保证是「当前筛选上下文」的领域）。
   *   - 顺手在 title 里带上「该词还出现在其他 N 个兴趣库」，把信息降级为悬停提示，
   *     既不占版面，也不丢失「同一个词可跨领域」这一事实。
   * ---------------------------------------------------------------------- */
  function buildDomainBadges() {
    if (!domain) return [];

    // ⚠️ 精简（任务一）：正面领域标签**只显示领域名**。
    //   不再拼接「· 官方译名」、不再拼接「该词也出现在其他 N 个兴趣库中」等
    //   长文本 —— 那些信息只保留在悬停提示（title）里，不占版面。
    const otherCount = Math.max(0, domainTags.filter(
      (t) => t.id !== domain.id && t.domainId !== domain.id,
    ).length);

    const titleParts = [`${domain.name} 领域`];
    if (otherCount > 0) titleParts.push(`该词也出现在其他 ${otherCount} 个兴趣库中`);

    return [h('span.chip', {
      class: 'chip--domain',
      title: titleParts.join(' · '),
      style: domain.theme?.primary ? { '--chip-domain': domain.theme.primary } : {},
    }, [
      svgIcon(iconPath(domain.icon || 'domain'), { size: 11 }),
      domain.name,
    ])];
  }

  /* -------------------------------------------------------------------------
   * 来源徽标（模块四：术语严谨性）
   * ---------------------------------------------------------------------- */
  function buildSourceChip() {
    if (!material) return null;
    if (material.unverified) {
      return h('span.chip.chip--warn', {
        title: '无法确认官方译名，请以游戏内实际文本为准',
      }, [svgIcon(iconPath('question'), { size: 11 }), '译名待确认']);
    }
    if (material.source) {
      return h('span.chip.chip--source', {
        title: `译名来源：${material.source}`,
      }, [svgIcon(iconPath('verified'), { size: 11 }), material.source]);
    }
    return null;
  }

  /* -------------------------------------------------------------------------
   * 正面
   * ---------------------------------------------------------------------- */
  function buildFront() {
    /* ⚠️ 精简铁律（任务一）：正面**只允许三类标签**，顺序固定、样式统一：
     *   ① 领域标签（buildDomainBadges）—— 只显示领域名
     *   ② 认证标签 —— 仅当 relevance.level === 'exact' 时显示「官方认证」，
     *                 普通词汇**什么都不加**
     *   ③ 词性标签 —— 「核心词」/「派生词」
     * 严禁在正面出现来源网址、完整 source 文本、「译名待确认」等啰嗦内容
     * （buildSourceChip 只允许出现在背面）。 */
    const badges = [];
    badges.push(...buildDomainBadges());

    // ② 认证标签：官方认证术语才显示，且文案必须短
    if (relevance?.level === 'exact') {
      badges.push(h('span.chip.chip--term', {
        title: relevance.evidence || '该词对应当前领域的官方术语',
      }, [
        svgIcon(iconPath('verified'), { size: 11 }),
        '官方认证',
      ]));
    }

    // ③ 词性标签
    badges.push(h('span.chip', {
      class: word.type === 'derived' ? 'chip--derived' : 'chip--core',
      text: word.type === 'derived' ? '派生词' : '核心词',
    }));

    return h('div.wordcard__face.wordcard__face--front', {}, [
      h('div.wordcard__rule'),
      h('div.wordcard__corner.wordcard__corner--tl'),
      h('div.wordcard__corner.wordcard__corner--br'),
      buildFigure('front'),
      h('div.wordcard__badges', {}, badges),
      h('div.wordcard__wordwrap', {}, [
        h('h3.wordcard__word', { text: word.word }),
        word.phonetic ? h('div.wordcard__phonetic', { text: word.phonetic }) : null,
        h('div.wordcard__hint', { text: briefOf(word.translation) }),
      ]),
      h('div.wordcard__foot', {}, [
        h('span.wordcard__flipbtn', {
          onClick: (e) => { e.stopPropagation(); toggle(); },
        }, [svgIcon(iconPath('flip'), { size: 13 }), '翻面']),
        relevance?.score
          ? h('span.wordcard__relevance', { title: relevance.evidence || '' }, [
              '关联 ', h('b', { text: String(relevance.score) }),
            ])
          : null,
      ]),
    ]);
  }

  /* -------------------------------------------------------------------------
   * 背面
   * ---------------------------------------------------------------------- */
  function buildBack() {
    /* ⚠️ 修复（问题二：翻到背面后无法再翻回正面）
     * 旧实现：`onClick: (e) => e.stopPropagation()` 挂在**整个背面容器**上，
     *   于是点击背面任何位置（空白区、文字区）的事件都不会冒泡到卡片的
     *   根节点 onClick，卡片再也翻不回来 —— 只有正面的「翻面」按钮能用。
     * 现在：背面容器不再整体阻止冒泡，点击背面空白/文字区会正常冒泡到卡片
     *   根节点触发翻转；只有**按钮等交互元素**在它们各自的处理函数里
     *   stopPropagation（见下方 onExpand / onToggleFavorite / onToggleSelect），
     *   从而做到「点卡片翻面、点按钮不翻面」。
     */
    const scroll = h('div.wordcard__backscroll');

    scroll.appendChild(buildFigure('back'));

    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [svgIcon(iconPath('wand'), { size: 12 }), '词根 / 派生']),
      h('div.mat__value', { text: material?.root || word.root || '核心词' }),
    ]));

    scroll.appendChild(h('div.mat__divider'));

    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [svgIcon(iconPath('book'), { size: 12 }), '通用释义']),
      h('div.mat__value', { text: material?.generalMeaning || word.translation || '—' }),
    ]));

    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [
        svgIcon(iconPath('domain'), { size: 12 }),
        `领域关联 · ${domain?.name || ''}`,
      ]),
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

    // 英文例句区 —— 卡片上展示的词**必须**有现成的、包含该词的完整英文例句。
    //   ⚠️ 已废弃「造句练习」兜底：不再要求用户自己造句。
    //   有材料 → 显示领域例句 + 中文翻译；
    //   无材料 → 显示「暂无例句」占位（数据层已批量补全，正常情况下不会走到这里）。
    const hasExample = Boolean(material?.example && String(material.example).trim());
    scroll.appendChild(h('div.mat__section', {}, [
      h('div.mat__label', {}, [
        svgIcon(iconPath('quill'), { size: 12 }),
        '英文例句',
      ]),
      hasExample
        ? h('div.mat__value.mat__value--example', { text: material.example })
        : h('div.mat__value.mat__value--example.mat__value--empty', { text: '暂无例句' }),
      hasExample && material.exampleZh
        ? h('div.mat__value--example-zh', { text: material.exampleZh })
        : null,
    ]));

    // 材料来源与严谨性标注（模块四）
    const srcRows = [];
    if (material?.source) {
      srcRows.push(h('span.chip.chip--source', {}, [
        svgIcon(iconPath('verified'), { size: 11 }), material.source,
      ]));
    }
    if (material?.unverified) {
      srcRows.push(h('span.chip.chip--warn', {}, [
        svgIcon(iconPath('question'), { size: 11 }), '译名待确认',
      ]));
    }
    if (srcRows.length) {
      scroll.appendChild(h('div.mat__divider'));
      scroll.appendChild(h('div', {
        style: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      }, srcRows));
    }

    // 底部操作：放大查看 / 收藏 / 标记熟词 / 加入清单
    scroll.appendChild(h('div.wordcard__actions', {}, [
      typeof onExpand === 'function'
        ? h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onClick: (e) => { e.stopPropagation(); onExpand(word); },
          }, [svgIcon(iconPath('expand'), { size: 12, cls: 'btn__icon' }), '放大查看'])
        : null,
      typeof onToggleFavorite === 'function'
        ? h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            class: favoriteState ? 'is-on' : '',
            onClick: (e) => { e.stopPropagation(); onToggleFavorite(word, !favoriteState); },
          }, [
            svgIcon(iconPath(favoriteState ? 'starFill' : 'star'), { size: 12, cls: 'btn__icon' }),
            favoriteState ? '已收藏' : '收藏',
          ])
        : null,
      // 功能三：标记为熟词（与收藏并列）
      typeof onToggleMastered === 'function'
        ? h('button.btn.btn--ghost.btn--sm.wordcard__master-btn', {
            type: 'button',
            class: masteredState ? 'is-on' : '',
            onClick: (e) => { e.stopPropagation(); onToggleMastered(word, !masteredState); },
          }, [
            svgIcon(iconPath(masteredState ? 'checkCircle' : 'brain'), { size: 12, cls: 'btn__icon' }),
            masteredState ? '已掌握' : '标记为熟词',
          ])
        : null,
      typeof onToggleSelect === 'function'
        ? h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            class: selected ? 'is-on' : '',
            onClick: (e) => { e.stopPropagation(); onToggleSelect(word, !selected); },
          }, [
            svgIcon(iconPath(selected ? 'checkSquare' : 'square'), { size: 12, cls: 'btn__icon' }),
            selected ? '已加入清单' : '加入清单',
          ])
        : null,
    ]));

    return h('div.wordcard__face.wordcard__face--back', {}, [h('div.wordcard__rule'), scroll]);
  }

  /* -------------------------------------------------------------------------
   * 收藏星标（右上角）
   *
   * ⚠️ 修复记录（「收藏夹空白」Bug 的第二个成因）：
   *   旧实现在点击时用 `!card.classList.contains('is-favorite')` 推断新状态。
   *   这有两个问题：
   *     1. 它读的是「上一次乐观 UI 留下的 class」，而不是权威状态；
   *        如果外部因为别的原因重渲染/回滚，class 与真实状态就会脱钩。
   *     2. 父层 handleToggleFavorite 是异步的，若它发现实际状态与预期不符，
   *        UI 不会被纠正，于是「看起来收藏了，其实没存」。
   *   现在改为：本地维护 `favoriteState` 作为唯一真相，点击时翻转它；
   *   并接收外部注入的 `getFavorite()` 用于「以服务端/存储为准」的校验。
   * ---------------------------------------------------------------------- */
  function buildFavoriteBtn() {
    return h('button.wordcard__fav', {
      type: 'button',
      class: favoriteState ? 'is-on' : '',
      'aria-pressed': String(favoriteState),
      'aria-label': favoriteState ? '取消收藏' : '收藏此卡',
      title: favoriteState ? '取消收藏' : '收藏',
      onClick: (e) => {
        e.stopPropagation();
        const next = !favoriteState;   // 以本地真相为准，不再读 DOM class
        setFavoriteState(next);
        onToggleFavorite(word, next);
      },
    }, [svgIcon(iconPath(favoriteState ? 'starFill' : 'star'), { size: 16 })]);
  }

  /** 同步星标 + 卡片外框的收藏视觉（供内部与外部 __setFavorite 共用） */
  function setFavoriteState(on) {
    favoriteState = Boolean(on);
    card.classList.toggle('is-favorite', favoriteState);
    const btn = card.querySelector('.wordcard__fav');
    if (btn) {
      btn.classList.toggle('is-on', favoriteState);
      btn.setAttribute('aria-pressed', String(favoriteState));
      btn.setAttribute('aria-label', favoriteState ? '取消收藏' : '收藏此卡');
      btn.setAttribute('title', favoriteState ? '取消收藏' : '收藏');
      btn.replaceChildren(svgIcon(iconPath(favoriteState ? 'starFill' : 'star'), { size: 16 }));
    }
  }

  /* -------------------------------------------------------------------------
   * 功能三：熟词徽标（左上角「已掌握」）
   * 卡片外框同步 is-mastered（视觉弱化：降低饱和度，见 components.css）
   * ---------------------------------------------------------------------- */
  function buildMasteredBadge() {
    return h('div.wordcard__mastered-badge', {
      title: '已标记为熟词',
      'aria-hidden': 'true',
    }, [
      svgIcon(iconPath('checkCircle'), { size: 13 }),
      h('span', { text: '已掌握' }),
    ]);
  }

  /** 同步「熟词」视觉（供内部与外部 __setMastered 共用） */
  function setMasteredState(on) {
    masteredState = Boolean(on);
    card.classList.toggle('is-mastered', masteredState);
    let badge = card.querySelector('.wordcard__mastered-badge');
    if (masteredState && !badge) {
      card.appendChild(buildMasteredBadge());
    } else if (!masteredState && badge) {
      badge.remove();
    }
    const btn = card.querySelector('.wordcard__master-btn');
    if (btn) {
      btn.classList.toggle('is-on', masteredState);
      btn.replaceChildren(
        svgIcon(iconPath(masteredState ? 'checkCircle' : 'brain'), { size: 12, cls: 'btn__icon' }),
        document.createTextNode(masteredState ? '已掌握' : '标记为熟词'),
      );
    }
  }

  /* 外部控制接口 */
  card.__flip = (force) => {
    const target = typeof force === 'boolean' ? force : !isFlipped;
    if (target === isFlipped) return;
    isFlipped = target;
    card.classList.toggle('is-flipped', isFlipped);
  };
  card.__isFlipped = () => isFlipped;
  /** 外部把权威收藏状态回写到组件（落库后再调用，保证 UI 与存储一致） */
  card.__setFavorite = (on) => setFavoriteState(on);
  card.__isFavorite = () => favoriteState;
  /** 外部把权威熟词状态回写到组件（功能三） */
  card.__setMastered = (on) => setMasteredState(on);
  card.__isMastered = () => masteredState;

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

/**
 * ⚠️ 已删除 buildPracticePrompt()（原「造句练习」兜底文案）。
 * 需求明确：卡片上展示的词必须都有现成的、包含该词的准确英文例句，
 * 不允许出现「让你的用户自己造句」的任何引导。缺失时只显示「暂无例句」，
 * 并由数据层批量补全（见 tools/fillMaterials.mjs）。
 */

/** 无静态材料时，用本地关联信息给出领域提示（不使用任何编造的译名） */
function localDomainHint(relevance, domain) {  if (!relevance || !domain) return '该词与当前领域暂无直接对应关系。';
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
  return '该词与当前领域暂无直接对应关系。';
}

export default createWordCard;
