/**
 * homePage.js —— 主页面（编排层）
 * ============================================================================
 * 职责边界（严格遵守）：
 *   ✅ 负责：UI 状态、事件绑定、把 service 返回的数据交给组件渲染
 *   ❌ 不负责：读词库 JSON、直接调 localStorage、直接 fetch、直接调 AI 接口
 *
 * 所有数据访问路径：
 *   homePage → studyService / wordBankService / domainMaterialService
 *              / quizService / dataService
 *
 * ---------------------------------------------------------------------------
 * 本轮增量变更（对应需求一 / 五 / 六 / 七）：
 *   1. ❌ 删除全部运行时 AI 链路：不再有「生成已选」「AI 语义排序」「生成中」状态，
 *      也不再需要 API Key 才能看到内容。打开网页即可浏览。
 *   2. ✅ 卡片组件换成独立的 createWordCard（卡片库 / 收藏夹 / 做题结果页三处复用）。
 *   3. ✅ 顶部新增「卡片库 / 收藏夹」标签页，收藏夹带数量角标。
 *   4. ✅ 新增「做题模式」入口，挂载 createQuizView（选择题）。
 *   5. ✅ 收藏状态经 studyService → dataService 读写，页面不碰存储。
 *   6. ✅ 跨领域主题：卡片按自身所属领域着色（domainMap），不再只有当前领域一色。
 * ---------------------------------------------------------------------------
 * 本轮增量变更（功能一 / 二 / 三 / 四）：
 *   功能一：兴趣库选择与「我的库」管理
 *     - 首次进入弹出「选择你感兴趣的领域」引导（domainPicker）
 *     - 顶部标签栏新增「+ 我的库」入口，可随时增删领域
 *     - 领域网格只渲染「我的库」里的领域；未选择时给出引导空态
 *   功能二：复习分组
 *     - 「复习收藏夹」改为挂载 createReviewGroupView（设置每组词数 → 逐组作答 → 组间小结）
 *   功能三：熟词库与掌握进度
 *     - 卡片背面新增「标记为熟词」；已掌握卡片视觉弱化
 *     - 顶部显示「六级词汇掌握进度」，点击进入熟词库列表页
 *   功能四：错题本与错误统计
 *     - 顶部新增「错题本」标签页，按错误率降序；可从错题本直接开始复习
 * ============================================================================
 */

import { h, svgIcon, clear, debounce, throttle } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import * as themeManager from '../core/themeManager.js';
import { createWordCard } from '../components/wordCard.js';
import { showDetailModal } from '../components/detailModal.js';
import { createQuizView } from '../components/quizView.js';
import { createReviewGroupView } from '../components/reviewGroupView.js';
import { createWrongWordsView } from '../components/wrongWordsView.js';
import { createMasteredView } from '../components/masteredView.js';
import { openDomainPicker } from '../components/domainPicker.js';
import { openSettingsModal } from '../components/settingsModal.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import wordBankService from '../services/wordBankService.js';
import dataService from '../services/dataService.js';
import domainMaterialService from '../services/domainMaterialService.js';
import quizService from '../services/quizService.js';
import studyService from '../services/studyService.js';

export async function createHomePage() {
  /* =======================================================================
     状态
     ==================================================================== */
  const state = {
    ui: await dataService.getUI(),
    domains: [],
    /** 「我的库」领域 id 列表（功能一） */
    myDomainIds: [],
    /** { [domainId]: domainConfig } —— 供跨领域卡片着色（同一个词可能属于多个领域） */
    domainMap: {},
    domainId: null,
    domain: null,
    words: [],            // 参与渲染的词（含 relevance / material / image / domains）
    allRelated: [],       // 该领域全部相关词
    selected: new Set(),  // 用户勾选（学习清单）
    favoriteKeys: new Set(), // `${domainId}::${word}` 已收藏集合
    masteredKeys: new Set(), // `${domainId}::${word}` 已掌握集合（功能三）
    mastery: { mastered: 0, total: 0, ratio: 0 }, // 六级掌握进度（功能三）
    wrongCount: 0,        // 错题本数量（功能四）
    query: '',
    mode: 'browse',       // browse | quiz
    tab: 'library',       // library | favorites | wrong | mastered
    viewOverride: null,   // 收藏夹固定网格（不受 ui.view 影响时为 null）
    loading: true,
    matchCount: 0,
    searchResults: null,  // 全库搜索结果（非空时覆盖领域列表）
    favorites: [],        // 收藏夹词条（tab==='favorites' 时渲染）
  };

  /* =======================================================================
     根结构
     ==================================================================== */
  const statWords = h('span', { text: '—' });
  const statTerms = h('span', { text: '—' });
  const statFav = h('span', { text: '0' });

  const settingsBtn = h('button.btn.btn--ghost.btn--icon', {
    type: 'button',
    title: '设置',
    'aria-label': '打开设置',
    onClick: () => openSettingsModal(),
  }, [svgIcon(iconPath('settings'), { size: 17 })]);

  /* ---- 顶部标签页：卡片库 / 收藏夹 / 错题本 / 我的库（功能一 / 四）---- */
  const tabLibraryCount = h('span.navtab__count', { text: '0' });
  const tabFavCount = h('span.navtab__count', { text: '0' });
  const tabWrongCount = h('span.navtab__count', { text: '0' });
  const tabLibrary = h('button.navtab', {
    type: 'button',
    class: 'is-active',
    onClick: () => switchTab('library'),
  }, [svgIcon(iconPath('layers'), { size: 14 }), '卡片库', tabLibraryCount]);
  const tabFavorites = h('button.navtab', {
    type: 'button',
    onClick: () => switchTab('favorites'),
  }, [svgIcon(iconPath('starFill'), { size: 14 }), '收藏夹', tabFavCount]);
  /** 功能四：错题本入口 */
  const tabWrong = h('button.navtab', {
    type: 'button',
    title: '答错的词会自动进入这里，按错误率排序',
    onClick: () => switchTab('wrong'),
  }, [svgIcon(iconPath('xCircle'), { size: 14 }), '错题本', tabWrongCount]);
  /** 功能一：我的库管理入口 */
  const tabManage = h('button.navtab.navtab--manage', {
    type: 'button',
    title: '增删「我的库」里的兴趣领域',
    onClick: () => manageMyLibrary(),
  }, [svgIcon(iconPath('plus'), { size: 14, cls: 'navtab__icon' }), '增加我的库']);

  const navTabs = h('div.navtabs', {}, [tabLibrary, tabFavorites, tabWrong, tabManage]);

  /* ---- 功能三：六级词汇掌握进度条（点击进入熟词库列表）---- */
  const masteryFill = h('i.mastery-bar__fill', { style: { width: '0%' } });
  const masteryNum = h('b.mastery-bar__num', { text: '0 / 0' });
  const masteryPct = h('span.mastery-bar__pct', { text: '0%' });
  const masteryBar = h('button.mastery-bar', {
    type: 'button',
    title: '查看熟词库 · 可取消已掌握的标记',
    style: { width: 'auto', padding: '5px 11px' },
    onClick: () => switchTab('mastered'),
  }, [
    h('span.mastery-bar__label', { text: '六级掌握：' }),
    masteryNum,
    h('span.mastery-bar__track', { style: { width: '72px', flex: 'none' } }, [masteryFill]),
    masteryPct,
  ]);

  const topbar = h('header.topbar', {}, [
    h('div.topbar__inner', {}, [
      h('div.brand', {}, [
        h('div.brand__mark', {}, [svgIcon(iconPath('sparkles'), { size: 22 })]),
        h('div.brand__text', {}, [
          h('div.brand__title', { text: '六级单词 · 兴趣化记忆卡片' }),
          h('div.brand__sub', { text: 'Interest-Driven Vocabulary Cards' }),
        ]),
      ]),
      h('div.topbar__spacer'),
      navTabs,
      h('div.topbar__stats', {}, [
        h('span.stat-chip', {}, ['词库 ', h('b', {}, [statWords])]),
        h('span.stat-chip', {}, ['领域术语 ', h('b', {}, [statTerms])]),
        h('span.stat-chip', {}, ['收藏 ', h('b', {}, [statFav])]),
      ]),
      masteryBar,
      settingsBtn,
    ]),
  ]);

  const heroHost = h('section.hero');
  const toolbarHost = h('div');
  const contentHost = h('div');
  const footer = h('footer.footer', {}, [
    h('div', {
      html: '词库经 <code>wordBankService</code> 管理 · 记忆材料为 <code>domainMaterials/*.json</code> 预生成静态数据 · 收藏与记录经 <code>dataService</code> 持久化',
    }),
    h('div', { text: '打开即读，无需联网或 API Key；架构已为多词库、后端与自定义领域预留扩展点。' }),
  ]);

  const main = h('main.app__main', {}, [heroHost, toolbarHost, contentHost]);
  const root = h('div.app', {}, [topbar, main, footer]);

  /* =======================================================================
     初始化：加载领域 + 词库 + 收藏 + 熟词 + 错题 + 首次引导
     ==================================================================== */
  function boot() {
    renderHero();
    renderToolbar();
    renderLoading();

    wordBankService.ensureLoaded().then(async () => {
      statWords.textContent = String(wordBankService.getWordCount());
      await Promise.all([reloadFavorites(), reloadMastered(), reloadWrong()]);
      console.error("[TRACE] before restoreDomain");
      await restoreDomain();
      console.error("[TRACE] after restoreDomain");
    }).catch((e) => {
      contentHost.replaceChildren(buildError(e));
    });
  }

  /** 重新读取收藏集（只读一次 localStorage，之后靠本地 Set 判断） */
  async function reloadFavorites() {
    const keys = await dataService.getFavoriteKeys();
    state.favoriteKeys = new Set(keys);
    statFav.textContent = String(keys.length);
    tabFavCount.textContent = String(keys.length);
    return keys.length;
  }

  /** 功能三：重新读取熟词集合 + 掌握进度 */
  async function reloadMastered() {
    const [keys, progress] = await Promise.all([
      dataService.getMasteredKeys(),
      studyService.getMasteryProgress(),
    ]);
    state.masteredKeys = new Set(keys);
    state.mastery = progress;
    paintMastery();
    return keys.length;
  }

  /** 把掌握进度画到顶栏进度条 */
  function paintMastery() {
    const pct = Math.round((state.mastery.ratio || 0) * 100);
    masteryFill.style.width = `${pct}%`;
    masteryNum.textContent = `${state.mastery.mastered} / ${state.mastery.total}`;
    masteryPct.textContent = `${pct}%`;
  }

  /** 功能四：重新读取错题本数量 */
  async function reloadWrong() {
    const n = await studyService.getWrongCount();
    state.wrongCount = n;
    tabWrongCount.textContent = String(n);
    return n;
  }

  /**
   * 功能一：首次进入引导
   * 未选择过任何领域（「我的库」为空）→ 弹出领域选择面板，必须选至少 1 个。
   */
  function maybeOnboard() {
    if (state.myDomainIds.length > 0) return;
    if (onboardingShown) return;
    onboardingShown = true;
    openDomainPicker({
      domains: state.domains,
      selected: [],
      onboarding: true,
      onConfirm: async (ids) => {
        await studyService.setUserDomains(ids);
        state.myDomainIds = ids;
        showToast(`已加入我的库：${ids.length} 个领域`, { type: 'ok' });
        // 引导完成后自动进入第一个领域，省去一次点击
        if (ids.length) await selectDomain(ids[0]);
      },
    });
  }

  /** 功能一：「增加我的库」管理面板（随时增删） */
  function manageMyLibrary() {
    openDomainPicker({
      domains: state.domains,
      selected: state.myDomainIds,
      onboarding: false,
      onConfirm: async (ids) => {
        await studyService.setUserDomains(ids);
        state.myDomainIds = ids;
        // 若当前领域已被移出我的库 → 重置为第一个可用领域
        if (state.domainId && !ids.includes(state.domainId)) {
          state.domainId = null;
          state.domain = null;
          await dataService.saveUI({ domainId: null });
          if (ids.length) {
            await selectDomain(ids[0], { silent: true });
          } else {
            renderHero(); renderToolbar(); renderDomains();
          }
        } else {
          renderHero();
        }
        showToast('我的库已更新', { desc: `当前共 ${ids.length} 个领域`, type: 'ok' });
      },
    });
  }

  async function restoreDomain() {
    // 功能一：先读「我的库」，未选择过则走首次引导
    state.myDomainIds = await studyService.getUserDomains();

    let domainId = state.ui.domainId;
    if (!domainId || !wordBankService.getDomainDetail(domainId)) domainId = null;
    // 不在「我的库」里的领域不能作为当前领域
    if (domainId && !state.myDomainIds.includes(domainId)) domainId = null;

    if (domainId) {
      await selectDomain(domainId, { silent: true });
    } else {
      state.loading = false;
      renderHero();
      renderToolbar();
      renderDomains();
    }

    // 首次访问 → 弹引导（放在渲染之后，保证背后界面已就绪）
    maybeOnboard();
  }

  /* =======================================================================
     Hero：领域选择器（只展示「我的库」里的领域）
     ==================================================================== */
  function renderHero() {
    // 全部领域（供 domainMap 着色 + 管理面板使用）
    state.domains = wordBankService.getDomains();
    state.domainMap = Object.fromEntries(state.domains.map((d) => [d.id, d]));

    // 功能一：领域网格只渲染「我的库」里的领域
    const mySet = new Set(state.myDomainIds);
    const visible = state.myDomainIds.length
      ? state.domains.filter((d) => mySet.has(d.id))
      : [];

    const grid = h('div.domain-grid');
    for (const d of visible) grid.appendChild(buildDomainCard(d));

    clear(heroHost);

    // 未选择任何领域 → 引导空态（主流程走首次引导弹窗，这里作为兜底）
    if (!visible.length) {
      heroHost.append(h('div.hero__head', {}, [
        h('div.hero__eyebrow', {}, [svgIcon(iconPath('compass'), { size: 12 }), 'Step 1 · 打造我的库']),
        h('h1.hero__title', { text: '先选几个感兴趣的世界' }),
        h('p.hero__desc', {
          text: '你还没有选择任何兴趣领域。选定后，只有这些领域会出现在卡片库里 —— 可随时在顶部「增加我的库」中增删。',
        }),
      ]), h('div.lib-empty', {}, [
        h('div.lib-empty__icon', {}, [svgIcon(iconPath('plus'), { size: 26 })]),
        h('div.lib-empty__title', { text: '我的库还是空的' }),
        h('div.lib-empty__desc', {
          text: '从王者荣耀、杀戮尖塔、空洞骑士、无畏契约里挑几个你熟悉的领域，系统会围绕它们筛出六级相关词。',
        }),
        h('button.btn.btn--accent', {
          type: 'button',
          onClick: () => manageMyLibrary(),
        }, [svgIcon(iconPath('plus'), { size: 13, cls: 'btn__icon' }), '选择兴趣领域']),
      ]));
      return;
    }

    heroHost.append(
      h('div.hero__head', {}, [
        h('div.hero__eyebrow', {}, [
          svgIcon(iconPath('compass'), { size: 12 }),
          'Step 1 · 选择兴趣领域',
        ]),
        h('h1.hero__title', { text: '用你熟悉的世界，记住六级单词' }),
        h('p.hero__desc', {
          text: '选定兴趣领域后，系统会从全量六级词库中筛出相关词，并直接展示已内置的记忆材料。卡片只呈现你当前所选领域的信息，切换领域即可看到同一单词在不同语境下的材料与配图。',
        }),
      ]),
      grid,
    );
  }

  function buildDomainCard(d) {
    const t = d.theme || {};
    const isActive = state.domainId === d.id;

    // 把该领域自己的主题 token 局部注入卡片，实现「同一页面上多个领域各自不同色」
    const card = h('button.domain-card', {
      type: 'button',
      class: isActive ? 'is-active' : '',
      style: {
        '--domain-primary': t.primary || 'var(--c-primary)',
        '--domain-primary-soft': t.primarySoft || 'var(--c-primary-soft)',
        '--domain-accent': t.accent || 'var(--c-accent)',
        '--domain-glow': t.cardGlow || 'var(--c-card-glow)',
        '--domain-border-strong': t.borderStrong || 'var(--c-border-strong)',
        '--domain-bg-grad': t.bgGradient || '',
      },
      'aria-pressed': String(isActive),
      onClick: () => selectDomain(d.id),
    }, [
      h('div.domain-card__aura', {
        style: {
          background: `radial-gradient(circle, ${t.primary || '#6ea8fe'} 0%, transparent 68%)`,
        },
      }),
      h('div.domain-card__top', {}, [
        h('div.domain-card__icon', {}, [svgIcon(iconPath(d.icon || 'domain'), { size: 27 })]),
        h('div', { style: { minWidth: '0' } }, [
          h('h2.domain-card__name', { text: d.name }),
          h('div.domain-card__sub', { text: d.subtitle }),
        ]),
      ]),
      h('p.domain-card__desc', { text: d.description }),
      h('div.domain-card__foot', {}, [
        h('div.domain-card__meta', {}, [
          '术语表 ', h('b', { text: String(d.termCount) }), ' 条',
          h('div', { style: { marginTop: '6px' } }, [
            h('span.theme-tag', {}, [
              h('span.theme-tag__dot'),
              `视觉主题：${t.label || '默认'}`,
            ]),
          ]),
        ]),
        isActive
          ? h('span.domain-card__check', {}, [svgIcon(iconPath('check'), { size: 13 }), '已选择'])
          : h('span.chip', {}, [svgIcon(iconPath('arrowRight'), { size: 11 }), '进入']),
      ]),
    ]);
    return card;
  }

  /** 选择领域：换肤 + 筛选 + 载入卡片（全程本地，无网络） */
  async function selectDomain(domainId, options = {}) {
    state.domainId = domainId;
    state.domain = wordBankService.getDomainDetail(domainId);
    state.searchResults = null;
    state.query = '';
    state.tab = 'library';

    // 换肤
    themeManager.applyTheme(state.domain?.theme);
    statTerms.textContent = String(state.domain?.termCount ?? 0);

    // 恢复该领域已勾选
    state.selected = await dataService.getSelection(domainId);

    await dataService.saveUI({ domainId });

    renderTabs();
    renderHero();
    renderToolbar();
    renderLoading();

    await loadRelatedWords();

    if (!options.silent) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(`已进入《${state.domain.name}》`, {
        desc: `匹配到 ${state.matchCount} 个相关词，配色已切换为「${state.domain.theme?.label || '默认'}」`,
        type: 'ok',
      });
    }
  }

  /** 领域相关词筛选（纯本地静态数据，永不走网络） */
  async function loadRelatedWords() {
    if (!state.domainId) return;
    setToolbarBusy(true);
    try {
      const { words } = await studyService.buildRelatedWords(state.domainId, {
        localLimit: 600,
        onStage: (s) => setToolbarStage(s.message),
      });
      state.allRelated = words;
      state.matchCount = words.length;
      tabLibraryCount.textContent = String(words.length);
      await refreshVisibleCards();
    } catch (e) {
      showToast('筛选失败', { desc: e.message, type: 'err' });
    } finally {
      setToolbarBusy(false);
      setToolbarStage('');
    }
  }

  /** 依据 query / 排序 / 勾选过滤，生成最终渲染列表 */
  async function refreshVisibleCards() {
    let list = state.allRelated;

    if (state.query) {
      const kw = state.query.toLowerCase();
      list = list.filter((w) => w.word.toLowerCase().includes(kw) || (w.translation || '').includes(state.query));
      // 领域内未命中时，退化为全库搜索，保证「搜索」始终有反馈
      if (!list.length) {
        const globalHit = await wordBankService.searchWords(state.query, { limit: 120 });
        state.searchResults = globalHit.map((w) => ({
          ...w,
          relevance: { score: 0, level: 'search', evidence: '来自全库搜索', domainTermZh: '' },
        }));
        list = state.searchResults;
      } else {
        state.searchResults = null;
      }
    }

    if (state.ui.sortBy === 'alpha') {
      list = [...list].sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
    }

    if (state.ui.onlySelected && state.selected.size) {
      list = list.filter((w) => state.selected.has(w.word));
    }

    if (state.ui.filterLevel && state.ui.filterLevel !== 'all') {
      list = list.filter((w) => w.relevance?.level === state.ui.filterLevel);
    }

    // 附带静态记忆材料 + 配图 + 多领域标签（全部由 service 层完成）
    state.words = await studyService.hydrateCards(state.domainId, list);
    renderContent();
  }

  /* =======================================================================
     顶部标签页
     ==================================================================== */
  /** 首次引导只弹一次（避免 restoreDomain 多次调用时重复弹出） */
  let onboardingShown = false;

  function renderTabs() {
    tabLibrary.classList.toggle('is-active', state.tab === 'library');
    tabFavorites.classList.toggle('is-active', state.tab === 'favorites');
    tabWrong.classList.toggle('is-active', state.tab === 'wrong');
    tabFavCount.textContent = String(state.favoriteKeys.size);
    tabWrongCount.textContent = String(state.wrongCount);
  }

  async function switchTab(tab) {
    if (state.mode === 'quiz') {
      // 做题中切标签 → 退出做题
      state.mode = 'browse';
    }
    state.tab = tab;
    renderTabs();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tab === 'favorites') {
      clear(toolbarHost);           // 收藏夹不需要卡片库工具栏
      // 进入收藏夹前先从服务层重读一次收藏集：
      //   1. 保证「数字」与「列表」来自同一次读（问题三修复点）；
      //   2. 避免组件内缓存的旧 Set 与磁盘数据不一致。
      await reloadFavorites();
      renderTabs();
      renderFavorites();
    } else if (tab === 'wrong') {
      // 功能四：错题本
      clear(toolbarHost);
      await reloadWrong();
      renderTabs();
      renderWrongView();
    } else if (tab === 'mastered') {
      // 功能三：熟词库列表
      clear(toolbarHost);
      renderMasteredView();
    } else {
      renderToolbar();
      if (state.domainId) await refreshVisibleCards();
      else renderDomains();
    }
  }

  /* =======================================================================
     工具栏（卡片库）
     ==================================================================== */
  const searchInput = h('input', {
    type: 'search',
    placeholder: '搜索单词或中文释义…',
    autocomplete: 'off',
    'aria-label': '搜索单词',
    onInput: debounce((e) => {
      state.query = e.target.value.trim();
      refreshVisibleCards();
    }, 280),
  });

  const sortSeg = h('div.seg');
  const levelSeg = h('div.seg');
  const viewSeg = h('div.seg');
  const onlySelectedBtn = h('button.btn.btn--sm');
  const selectAllBtn = h('button.btn.btn--sm');
  const clearSelBtn = h('button.btn.btn--sm');
  const quizBtn = h('button.btn.btn--accent.btn--sm');
  const reviewBtn = h('button.btn.btn--sm');
  const flipAllBtn = h('button.btn.btn--ghost.btn--sm');
  const flipBackBtn = h('button.btn.btn--ghost.btn--sm');
  const stageText = h('span.form-hint', { style: { minHeight: '16px' } });
  const matchBadge = h('span.badge-count');

  function renderToolbar() {
    clear(sortSeg); clear(levelSeg); clear(viewSeg);
    if (!state.domainId) { clear(toolbarHost); return; }

    const segBtn = (parent, label, iconName, active, onClick) => {
      const b = h('button.seg__btn', {
        type: 'button',
        class: active ? 'is-active' : '',
        onClick,
      }, iconName ? [svgIcon(iconPath(iconName), { size: 14 }), label] : [label]);
      parent.appendChild(b);
      return b;
    };

    segBtn(viewSeg, '网格', 'grid', state.ui.view === 'grid', () => {
      state.ui.view = 'grid';
      dataService.saveUI({ view: 'grid' });
      renderToolbar(); renderContent();
    });
    segBtn(viewSeg, '列表', 'list', state.ui.view === 'list', () => {
      state.ui.view = 'list';
      dataService.saveUI({ view: 'list' });
      renderToolbar(); renderContent();
    });

    segBtn(sortSeg, '关联度', 'target', state.ui.sortBy === 'relevance', () => {
      state.ui.sortBy = 'relevance';
      dataService.saveUI({ sortBy: 'relevance' });
      renderToolbar(); refreshVisibleCards();
    });
    segBtn(sortSeg, '字母', 'sort', state.ui.sortBy === 'alpha', () => {
      state.ui.sortBy = 'alpha';
      dataService.saveUI({ sortBy: 'alpha' });
      renderToolbar(); refreshVisibleCards();
    });

    segBtn(levelSeg, '全部', null, state.ui.filterLevel === 'all', () => {
      state.ui.filterLevel = 'all';
      dataService.saveUI({ filterLevel: 'all' });
      renderToolbar(); refreshVisibleCards();
    });
    segBtn(levelSeg, '专有术语', null, state.ui.filterLevel === 'exact', () => {
      state.ui.filterLevel = 'exact';
      dataService.saveUI({ filterLevel: 'exact' });
      renderToolbar(); refreshVisibleCards();
    });

    onlySelectedBtn.replaceChildren(
      svgIcon(iconPath(state.ui.onlySelected ? 'checkCircle' : 'filter'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('仅看已选'),
    );
    onlySelectedBtn.className = `btn btn--sm${state.ui.onlySelected ? ' btn--accent' : ''}`;
    onlySelectedBtn.onclick = () => {
      state.ui.onlySelected = !state.ui.onlySelected;
      dataService.saveUI({ onlySelected: state.ui.onlySelected });
      renderToolbar(); refreshVisibleCards();
    };

    selectAllBtn.replaceChildren(
      svgIcon(iconPath('check'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('全选本页'),
    );
    selectAllBtn.onclick = async () => {
      for (const w of state.words) state.selected.add(w.word);
      await persistSelection();
      renderToolbar(); renderContent();
      showToast('已全选当前列表', { desc: `${state.words.length} 个词`, type: 'ok' });
    };

    clearSelBtn.replaceChildren(
      svgIcon(iconPath('close'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('清空勾选'),
    );
    clearSelBtn.onclick = async () => {
      if (!state.selected.size) return;
      const ok = await confirmDialog({
        title: '清空已勾选的单词？',
        message: `当前已勾选 ${state.selected.size} 个单词，清空后学习清单会变为空。`,
        confirmText: '清空',
        danger: true,
      });
      if (!ok) return;
      state.selected.clear();
      await persistSelection();
      renderToolbar(); renderContent();
    };

    // ---- 做题模式（需求五）----
    quizBtn.replaceChildren(
      svgIcon(iconPath('quiz'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('做题'),
    );
    quizBtn.onclick = () => startQuiz({ source: quizService.QUIZ_SOURCES.DOMAIN });

    // ---- 复习（需求二：收藏夹专属选择题 + 预生成例句，全程不调 AI）----
    reviewBtn.title = '复习模式只从收藏夹出题，例句直接取自预生成材料';
    reviewBtn.replaceChildren(
      svgIcon(iconPath('play'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('复习收藏夹'),
    );
    reviewBtn.onclick = () => startReview();

    flipAllBtn.replaceChildren(
      svgIcon(iconPath('flip'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('全部翻面'),
    );
    flipAllBtn.onclick = () => flipAll(true);

    flipBackBtn.replaceChildren(
      svgIcon(iconPath('refresh'), { size: 12, cls: 'btn__icon' }),
      document.createTextNode('全部翻回'),
    );
    flipBackBtn.onclick = () => flipAll(false);

    matchBadge.textContent = `${state.matchCount} 词`;

    clear(toolbarHost);
    toolbarHost.appendChild(h('div.toolbar', {}, [
      h('div.field.field--grow', {}, [svgIcon(iconPath('search'), { size: 15, cls: 'field__icon' }), searchInput]),
      matchBadge,
      h('div.toolbar__divider'),
      viewSeg,
      h('div.toolbar__divider'),
      h('div.field', {}, [svgIcon(iconPath('sort'), { size: 14, cls: 'field__icon' }), sortSeg]),
      h('div.toolbar__divider'),
      levelSeg,
      h('div.toolbar__divider'),
      onlySelectedBtn,
      selectAllBtn,
      clearSelBtn,
      h('div.toolbar__divider'),
      flipAllBtn,
      flipBackBtn,
      h('div.toolbar__divider'),
      quizBtn,
      reviewBtn,
    ]));
    if (!toolbarHost.querySelector('.form-hint--stage')) {
      const line = h('div.form-hint.form-hint--stage', { style: { marginTop: '-10px', marginBottom: '14px', minHeight: '16px' } });
      toolbarHost.appendChild(line);
    }
  }

  function setToolbarBusy(busy) {
    for (const btn of [quizBtn, reviewBtn, selectAllBtn, flipAllBtn, flipBackBtn]) {
      btn.disabled = busy;
    }
    if (busy) setToolbarStage('处理中…');
  }

  function setToolbarStage(text) {
    const line = toolbarHost.querySelector('.form-hint--stage');
    if (line) line.textContent = text || '';
    stageText.textContent = text || '';
  }

  async function persistSelection() {
    await dataService.setSelection(state.domainId, [...state.selected]);
  }

  /* =======================================================================
     内容区
     ==================================================================== */
  function renderLoading() {
    contentHost.replaceChildren(h('div.loading-block', {}, [
      h('span.spinner'), '正在载入六级词库与领域术语…',
    ]));
  }

  function buildError(e) {
    return h('div.empty', {}, [
      h('div.empty__icon', {}, [svgIcon(iconPath('alert'), { size: 28 })]),
      h('div.empty__title', { text: '载入失败' }),
      h('div.empty__desc', { text: e?.message || String(e) }),
      h('button.btn.btn--primary', { type: 'button', onClick: () => window.location.reload() }, '重新载入'),
    ]);
  }

  let mountedCards = [];

  function renderDomains() {
    if (state.mode === 'quiz') return;
    contentHost.replaceChildren(h('div.empty', {}, [
      h('div.empty__icon', {}, [svgIcon(iconPath('compass'), { size: 28 })]),
      h('div.empty__title', { text: '请先在上方选择一个兴趣领域' }),
      h('div.empty__desc', {
        text: '选定后，系统会用该领域的专有术语表从词库中筛出相关词，并直接展示内置的记忆材料与配图 —— 打开即读，无需 API Key。',
      }),
    ]));
  }

  function renderContent() {
    if (state.mode === 'quiz') return;      // 做题视图自行管理
    if (state.tab === 'favorites') return;  // 收藏夹自行管理
    if (state.tab === 'wrong') return;      // 错题本自行管理（功能四）
    if (state.tab === 'mastered') return;   // 熟词库自行管理（功能三）

    if (!state.domainId) return renderDomains();

    if (!state.words.length) {
      contentHost.replaceChildren(h('div.empty', {}, [
        h('div.empty__icon', {}, [svgIcon(iconPath('search'), { size: 28 })]),
        h('div.empty__title', { text: state.query ? '没有匹配的单词' : '暂无相关词' }),
        h('div.empty__desc', {
          text: state.query
            ? '试试其他关键词，或清空搜索框查看全部相关词。'
            : '当前筛选条件下没有结果，可尝试切换排序或层级筛选。',
        }),
        state.query
          ? h('button.btn', {
              type: 'button',
              onClick: () => { searchInput.value = ''; state.query = ''; refreshVisibleCards(); },
            }, '清空搜索')
          : null,
      ]));
      return;
    }

    const head = h('div', {
      style: {
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: '12px', flexWrap: 'wrap', marginBottom: '16px',
      },
    }, [
      h('div', {}, [
        h('h2', {
          style: { fontSize: '19px' },
          text: state.query ? `搜索结果 · ${state.words.length} 词` : `《${state.domain.name}》相关词 · ${state.words.length} 词`,
        }),
        h('div.form-hint', {
          text: state.query && state.searchResults
            ? '领域内未命中，以下为全库搜索结果。'
            : '记忆材料为内置静态数据，点击卡片翻面即可看到词根、领域关联、微故事与例句。',
        }),
      ]),
    ]);

    const view = state.ui.view === 'list' ? buildList() : buildGrid();
    contentHost.replaceChildren(head, view);
  }

  /* ---- 卡片库：网格（使用独立 WordCard 组件）---- */
  function buildGrid() {
    mountedCards = [];
    const grid = h('div.card-grid');
    state.words.forEach((w, i) => {
      const card = createWordCard(cardProps(w, i));
      mountedCards.push(card);
      grid.appendChild(card);
    });
    return grid;
  }

  /* ---- 卡片库：列表 ---- */
  function buildList() {
    mountedCards = [];
    const list = h('div.card-grid.card-grid--list');
    for (const w of state.words) {
      const fav = isFav(state.domainId, w.word);
      const row = h('div.row', {
        role: 'button',
        tabIndex: '0',
        onClick: () => openDetail(w),
        onKeydown: (e) => { if (e.key === 'Enter') openDetail(w); },
      }, [
        h('span.row__word', { text: w.word }),
        h('span.row__ph', { text: w.phonetic || '' }),
        h('span.row__tr', { text: w.translation || '' }),
        w.relevance?.level === 'exact'
          ? h('span.chip.chip--term', { text: w.relevance.domainTermZh || '专有术语' })
          : null,
        w.hasMaterial ? h('span.chip.chip--source', { text: '已内置材料' }) : null,
        /* 修复问题一：不再显示「N 个领域」这类跨领域提示，只保留当前领域标签 */
        state.selected.has(w.word) ? h('span.chip.chip--selected', { text: '已勾选' }) : null,
        typeof buildFavoriteBtn === 'function' ? buildRowFav(w, fav) : null,
      ]);
      list.appendChild(row);
    }
    return list;
  }

  /** 列表行内的收藏按钮（与网格卡片共用同一套读写，同样不读 DOM class） */
  function buildRowFav(w, fav) {
    let favState = Boolean(fav);
    const paint = () => {
      btn.classList.toggle('is-on', favState);
      btn.title = favState ? '取消收藏' : '收藏';
      btn.setAttribute('aria-label', favState ? '取消收藏' : '收藏');
      btn.replaceChildren(svgIcon(iconPath(favState ? 'starFill' : 'star'), { size: 15 }));
    };
    const btn = h('button.wordcard__fav', {
      type: 'button',
      class: favState ? 'is-on' : '',
      style: { position: 'static', opacity: '1', transform: 'none' },
      title: favState ? '取消收藏' : '收藏',
      'aria-label': favState ? '取消收藏' : '收藏',
      onClick: (e) => {
        e.stopPropagation();
        favState = !favState;          // 本地真相，不反推 DOM
        paint();
        handleToggleFavorite(w, favState);
      },
    }, [svgIcon(iconPath(favState ? 'starFill' : 'star'), { size: 15 })]);
    return btn;
  }

  /** WordCard 的统一 props 组装（卡片库 / 收藏夹 / 复习小结共用） */
  function cardProps(w, i, extra = {}) {
    const domainId = w.domainId || state.domainId;
    return {
      word: w,
      material: w.material,
      domain: state.domainMap[domainId] || state.domain,
      domains: w.domains || [],
      relevance: w.relevance,
      index: i,
      favorite: isFav(domainId, w.word),
      mastered: w.mastered || isMastered(domainId, w.word),
      selected: state.selected.has(w.word),
      ...extra,
      onExpand: (word) => openDetail({ ...w, word: word.word }),
      onToggleFavorite: (word, next) => handleToggleFavorite(word, next, domainId),
      onToggleMastered: (word, next) => handleToggleMastered(word, next, domainId),
      onToggleSelect: (word, next) => toggleSelect(word, next),
    };
  }

  function flipAll(flipped) {
    for (const c of mountedCards) c.__flip?.(flipped);
  }

  /* =======================================================================
     收藏夹（需求六）
     ==================================================================== */
  async function renderFavorites() {
    contentHost.replaceChildren(h('div.loading-block', {}, [h('span.spinner'), '正在载入收藏夹…']));

    const list = await studyService.buildFavorites();   // 跨领域聚合
    state.favorites = list;

    if (!list.length) {
      contentHost.replaceChildren(h('div.empty', {}, [
        h('div.empty__icon', {}, [svgIcon(iconPath('starFill'), { size: 28 })]),
        h('div.empty__title', { text: '收藏夹还是空的' }),
        h('div.empty__desc', {
          text: '回到「卡片库」，点卡片右上角的星标即可收藏。收藏按「单词 × 领域」记录，跨领域复习不会互相覆盖。',
        }),
        h('button.btn.btn--primary', { type: 'button', onClick: () => switchTab('library') }, '去卡片库收藏'),
      ]));
      return;
    }

    const exactCount = list.filter((w) => (w.domains || []).some((d) => d.level === 'exact')).length;
    const imageCount = list.filter((w) => w.image).length;

    const head = h('div.fav-head', {}, [
      h('div', {}, [
        h('h2', { style: { fontSize: '19px' }, text: `收藏夹 · ${list.length} 张卡片` }),
        h('div.form-hint', {
          text: '收藏夹跨领域汇总；可直接用收藏夹出题。点星标取消收藏，刷新页面不会丢失。',
        }),
      ]),
      h('div.fav-stats', {}, [
        h('span.chip', {}, `${exactCount} 个专有术语`),
        h('span.chip', {}, `${imageCount} 张含配图`),
        h('button.btn.btn--accent.btn--sm', {
          type: 'button',
          onClick: () => startQuiz({ source: quizService.QUIZ_SOURCES.FAVORITES }),
        }, [svgIcon(iconPath('quiz'), { size: 12, cls: 'btn__icon' }), '用收藏夹做题']),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onClick: clearAllFavorites,
        }, [svgIcon(iconPath('trash'), { size: 12, cls: 'btn__icon' }), '清空收藏']),
      ]),
    ]);

    const grid = h('div.card-grid');
    list.forEach((w, i) => {
      grid.appendChild(createWordCard(cardProps(w, i, { compact: true })));
    });

    contentHost.replaceChildren(head, grid);
  }

  async function clearAllFavorites() {
    if (!state.favoriteKeys.size) return;
    const ok = await confirmDialog({
      title: `清空全部 ${state.favoriteKeys.size} 个收藏？`,
      message: '收藏记录会被删除，卡片与答题历史不受影响。此操作不可撤销。',
      confirmText: '清空收藏',
      danger: true,
    });
    if (!ok) return;
    await dataService.clearFavorites();
    await reloadFavorites();
    renderTabs();
    await renderFavorites();
    showToast('已清空收藏夹', { type: 'ok' });
  }

  /* =======================================================================
     收藏读写（统一入口，页面不直接碰存储）
     ==================================================================== */
  function isFav(domainId, word) {
    return state.favoriteKeys.has(`${domainId}::${String(word || '').toLowerCase()}`);
  }

  /* =======================================================================
     功能三：熟词标记读写（与收藏同构，同样不直接碰存储）
     ==================================================================== */
  function isMastered(domainId, word) {
    return state.masteredKeys.has(`${domainId}::${String(word || '').toLowerCase()}`);
  }

  /**
   * 切换「熟词」标记（统一入口）。
   * 与 handleToggleFavorite 同构：落库后用**真实状态**回写内存与卡片 UI。
   * @param {object} word
   * @param {boolean} next 期望状态
   * @param {string} [domainId]
   */
  async function handleToggleMastered(word, next, domainId) {
    const dId = domainId || state.domainId;
    if (!dId) {
      showToast('请先选择兴趣领域', { type: 'err' });
      return;
    }
    try {
      const actual = await studyService.setMastered(dId, word.word, next);
      const key = `${dId}::${String(word.word).toLowerCase()}`;
      if (actual) state.masteredKeys.add(key);
      else state.masteredKeys.delete(key);

      // 同步内存对象 + 把权威状态回写到卡片，保证 UI 与存储一致
      const hit = state.words.find((w) => w.word === word.word && (w.domainId || state.domainId) === dId);
      if (hit) hit.mastered = actual;
      for (const card of mountedCards) {
        if (card?.__setMastered && card.querySelector) {
          const wEl = card.querySelector('.wordcard__word');
          if (wEl && wEl.textContent === word.word) card.__setMastered(actual);
        }
      }

      // 掌握进度条同步刷新
      await reloadMastered();

      showToast(actual ? `已标记为熟词「${word.word}」` : `已取消熟词「${word.word}」`, {
        type: 'ok', duration: 1800,
      });

      // 熟词库视图下取消标记 → 立即从列表移除
      if (state.tab === 'mastered') renderMasteredView();
    } catch (e) {
      showToast('操作失败', { desc: e.message, type: 'err' });
    }
  }

  /* =======================================================================
     功能三：熟词库列表页
     ==================================================================== */
  function renderMasteredView() {
    clear(toolbarHost);
    contentHost.replaceChildren();
    const view = createMasteredView({
      domainMap: state.domainMap,
      onOpenWord: (w) => openDetail({ ...w, domainId: w.domainId }),
      onProgressChange: () => { reloadMastered(); },
    });
    contentHost.appendChild(view);
  }

  /* =======================================================================
     功能四：错题本视图
     ==================================================================== */
  function renderWrongView() {
    clear(toolbarHost);
    contentHost.replaceChildren();
    const view = createWrongWordsView({
      domainMap: state.domainMap,
      onOpenWord: (w) => openDetail({ ...w, domainId: w.domainId }),
      onStartReview: (list) => startWrongReview(list),
      onToggleFavorite: async (w, next, dId) => {
        await handleToggleFavorite(w, next, dId || w.domainId || state.domainId);
      },
    });
    contentHost.appendChild(view);
  }

  /** 功能四：从错题本开始复习（只出这些错题） */
  function startWrongReview(list) {
    const words = (list || []).map((w) => ({ ...w, domainId: w.domainId }));
    if (words.length < 1) {
      showToast('错题本为空', { type: 'err' });
      return;
    }
    state.mode = 'quiz';
    clear(toolbarHost);
    contentHost.replaceChildren();

    const view = createQuizView({
      domain: null,
      source: quizService.QUIZ_SOURCES.ALL,
      type: quizService.QUIZ_TYPES.MIXED,
      count: Math.min(words.length, 50),
      words,
      domainMap: state.domainMap,
      showHistory: true,
      onExit: async () => {
        state.mode = 'browse';
        await reloadWrong();
        renderTabs();
        renderWrongView();
      },
      onToggleFavorite: async (w, next, dId) => {
        await handleToggleFavorite(w, next, dId || w.domainId || state.domainId);
      },
      onMoveToMastered: (w, dId) => handleMoveToMastered(w, dId || w?.domainId),
      isMastered: (w, dId) => isMastered(dId || w?.domainId || state.domainId, w),
    });
    contentHost.appendChild(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * 切换收藏状态（统一入口 —— 页面不直接碰 localStorage）。
   *
   * 流程：
   *   1. 组件点击时已做乐观 UI（立即反馈，不卡手）
   *   2. 这里调 studyService.toggleFavorite 落库（内部走 dataService，串行化防覆盖）
   *   3. 用 **落库后的真实状态** 回写 state.favoriteKeys 与卡片 UI，纠正任何偏差
   *
   * ⚠️ 修复记录：旧实现只在 state.favoriteKeys 里增删，且卡片的星标状态
   *   完全由组件内的 DOM class 自持，一旦并发/重渲染就会「看着收藏了但没存」。
   *
   * @param {object} word
   * @param {boolean} next 期望状态（来自组件）
   * @param {string} [domainId] 不传时用当前领域 —— 同一个词在不同领域各自独立收藏
   */
  async function handleToggleFavorite(word, next, domainId) {
    const dId = domainId || state.domainId;
    if (!dId) {
      showToast('请先选择兴趣领域', { type: 'err' });
      return;
    }
    try {
      // 直接设置期望状态（而非盲目 toggle），保证与用户点击意图一致
      const actual = await dataService.setFavorite(dId, word.word, next);
      const key = `${dId}::${String(word.word).toLowerCase()}`;
      if (actual) state.favoriteKeys.add(key);
      else state.favoriteKeys.delete(key);

      // 顶栏与标签页角标
      statFav.textContent = String(state.favoriteKeys.size);
      tabFavCount.textContent = String(state.favoriteKeys.size);

      // 同步内存对象 + 把权威状态回写到卡片，保证 UI 与存储一致
      const hit = state.words.find((w) => w.word === word.word && (w.domainId || state.domainId) === dId);
      if (hit) hit.favorite = actual;
      for (const card of mountedCards) {
        if (card?.__isFavorite && card.contains && card.querySelector) {
          const wEl = card.querySelector('.wordcard__word');
          if (wEl && wEl.textContent === word.word) card.__setFavorite(actual);
        }
      }

      showToast(actual ? `已收藏「${word.word}」` : `已取消收藏「${word.word}」`, { type: 'ok', duration: 1800 });

      // 收藏夹视图下取消收藏 → 立即从列表移除
      if (state.tab === 'favorites' && !actual) {
        await renderFavorites();
      }
    } catch (e) {
      showToast('收藏失败', { desc: e.message, type: 'err' });
    }
  }

  /* =======================================================================
     勾选（学习清单）
     ==================================================================== */
  async function toggleSelect(word, next) {
    const target = typeof next === 'boolean' ? next : !state.selected.has(word.word);
    if (target) state.selected.add(word.word);
    else state.selected.delete(word.word);
    await persistSelection();
    renderToolbar();
  }

  /* =======================================================================
     详情
     ==================================================================== */

  async function openDetail(word) {
    const domainId = word.domainId || state.domainId;
    const domain = state.domainMap[domainId] || state.domain;
    // 按需补全材料 / 领域标签（详情页要展示最完整信息）
    const { material } = await studyService.getMaterialFor(domainId, word.word);
    const domains = word.domains?.length ? word.domains : wordBankService.getDomainTags(word.word);

    showDetailModal({
      word,
      material,
      domain,
      domains,
      relevance: word.relevance,
      favorite: isFav(domainId, word.word),
      mastered: isMastered(domainId, word.word),
      onToggleFavorite: async (w, next) => {
        await handleToggleFavorite(w, next, domainId);
      },
      onToggleMastered: async (w, next) => {
        await handleToggleMastered(w, next, domainId);
      },
    });
  }

  /* =======================================================================
     做题模式（需求五）
     ==================================================================== */
  async function startQuiz({ source }) {
    // 题目池大小预检，给出更友好的提示
    if (source === quizService.QUIZ_SOURCES.FAVORITES && state.favoriteKeys.size < 2) {
      showToast('收藏夹卡片太少', { desc: '至少需要收藏 2 张卡片才能出题。', type: 'err' });
      return;
    }
    if (source === quizService.QUIZ_SOURCES.DOMAIN && !state.domainId) {
      showToast('请先选择兴趣领域', { type: 'err' });
      return;
    }

    state.mode = 'quiz';
    clear(toolbarHost);
    contentHost.replaceChildren();

    const view = createQuizView({
      domain: source === quizService.QUIZ_SOURCES.FAVORITES ? null : state.domain,
      source,
      type: quizService.QUIZ_TYPES.MIXED,
      count: 10,
      words: state.words.map((w) => ({ ...w })),   // source='all' / 'domain' 时的来源池
      domainMap: state.domainMap,
      onExit: () => {
        state.mode = 'browse';
        if (state.tab === 'favorites') { clear(toolbarHost); renderFavorites(); }
        else { renderToolbar(); refreshVisibleCards(); }
      },
      onToggleFavorite: async (w, next, dId) => {
        await handleToggleFavorite(w, next, dId || state.domainId);
      },
      onMoveToMastered: (w, dId) => handleMoveToMastered(w, dId),
      isMastered: (w, dId) => isMastered(dId || state.domainId, w),
    });
    contentHost.appendChild(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * 复习模式流转：把词「移入熟词库」。
   *
   * 语义（用户需求）：标记为熟词 + 从收藏夹移除 —— 离开收藏夹、进入熟词库。
   * 两步都走 service 层，落库后统一刷新 UI（顶部数字 / 内存 Set / 已挂载卡片）。
   *
   * @param {object} word
   * @param {string} [domainId]
   */
  async function handleMoveToMastered(word, domainId) {
    const dId = domainId || word?.domainId || state.domainId;
    if (!dId) {
      showToast('无法确定该词所属领域', { type: 'err' });
      return;
    }
    const w = word?.word || word;
    try {
      // ① 写入熟词库
      await studyService.setMastered(dId, w, true);
      state.masteredKeys.add(`${dId}::${String(w).toLowerCase()}`);

      // ② 从收藏夹移除（同一词在其它领域若也收藏，保持不动）
      await dataService.setFavorite(dId, w, false);
      state.favoriteKeys.delete(`${dId}::${String(w).toLowerCase()}`);

      // ③ 内存对象同步
      const hit = state.words.find(
        (x) => x.word === w && (x.domainId || state.domainId) === dId,
      );
      if (hit) { hit.mastered = true; hit.favorite = false; }

      // ④ 已挂载卡片回写权威状态
      for (const card of mountedCards) {
        if (!card?.querySelector) continue;
        const wEl = card.querySelector('.wordcard__word');
        if (wEl && wEl.textContent === w) {
          if (typeof card.__setMastered === 'function') card.__setMastered(true);
          if (typeof card.__setFavorite === 'function') card.__setFavorite(false);
        }
      }

      // ⑤ 刷新顶部数字与掌握进度
      statFav.textContent = String(state.favoriteKeys.size);
      tabFavCount.textContent = String(state.favoriteKeys.size);
      await reloadMastered();

      showToast(`已移入熟词库「${w}」`, {
        desc: '已从收藏夹移除，可在「熟词库」中查看。',
        type: 'ok', duration: 2000,
      });
    } catch (e) {
      showToast('移入熟词库失败', { desc: e.message, type: 'err' });
    }
  }

  /* =======================================================================
     复习模式（功能二：分组复习）
     ====================================================================
     * 题目池：只从收藏夹取词（source = FAVORITES），不碰全量词库
     * 流程：先设置每组词数（10/20/30/50，默认 20）→ 逐组作答 → 每组小结
     * 每组结果落库为一条 quizSessions 记录（含正确率与逐词对错）
     * 熟词默认被排除，可在设置页勾选「包含熟词」纳入
     * ==================================================================== */
  async function startReview() {
    // 先刷新一次收藏（防止跨标签页或上次操作后本地 Set 过期）
    await reloadFavorites();
    if (state.favoriteKeys.size < 2) {
      showToast('收藏夹里的词不够', {
        desc: '复习模式只从收藏夹取词，请先收藏至少 2 张卡片。',
        type: 'err',
      });
      if (state.tab !== 'favorites') switchTab('favorites');
      return;
    }

    state.mode = 'quiz';
    clear(toolbarHost);
    contentHost.replaceChildren();

    const view = createReviewGroupView({
      domainId: null,                                 // 收藏夹跨领域
      domain: null,
      domainMap: state.domainMap,
      onExit: async () => {
        state.mode = 'browse';
        if (state.tab === 'favorites') { clear(toolbarHost); await renderFavorites(); }
        else { renderToolbar(); refreshVisibleCards(); }
      },
      onToggleFavorite: async (w, next, dId) => {
        await handleToggleFavorite(w, next, dId || state.domainId);
      },
      onMoveToMastered: (w, dId) => handleMoveToMastered(w, dId),
      isMastered: (w, dId) => isMastered(dId || state.domainId, w),
    });
    contentHost.appendChild(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =======================================================================
     启动
     ==================================================================== */
  boot();

  // 暴露只读调试接口（便于排查，也方便确认 service 边界）
  root.__debug = {
    get state() {
      return {
        domainId: state.domainId,
        tab: state.tab,
        mode: state.mode,
        words: state.words.length,
        favorites: state.favoriteKeys.size,
        matchCount: state.matchCount,
        // 功能新增
        myDomains: state.myDomainIds.slice(),
        mastered: state.mastery.mastered,
        masteryTotal: state.mastery.total,
        wrongCount: state.wrongCount,
      };
    },
    wordBankService,
    dataService,
    domainMaterialService,
    quizService,
    studyService,
  };

  return root;
}

export default createHomePage;
