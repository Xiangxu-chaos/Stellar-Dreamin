/**
 * studyService.js
 * ============================================================================
 * 学习流程编排层（介于页面与 wordBankService / domainMaterialService / dataService 之间）
 *
 * 本轮重要变更（增量）：
 *   ❌ 移除全部运行时 AI 调用（不再有 generateForWord / generateForWords 走网络）
 *   ✅ 记忆材料改为从 domainMaterialService 读取「预生成静态数据」
 *   ✅ 卡片数据新增：material（静态材料）、image（配图）、domains（所属领域数组）
 *
 * 为什么保留这一层：
 *   页面组件不应该把「筛选 → 附加材料 → 附加领域标签 → 渲染」这种多步流程
 *   写在渲染逻辑里。编排逻辑集中在此，页面只调用一个动作。
 *
 * 最终版演进：新增「艾宾浩斯排程」「每日任务」「跨用户共享学习记录」时，
 *   都在本层扩展动作即可，页面与底层 service 都不需要改。
 * ============================================================================
 */

import wordBankService from './wordBankService.js';
import domainMaterialService from './domainMaterialService.js';
import dataService from './dataService.js';

/**
 * 领域相关词筛选（纯本地，永不走网络）
 *
 * 说明：旧版有「第二层 AI 语义排序」。本轮改为静态数据后，
 * 排序完全依赖本地术语权重（见 wordBankService 的 domainTermTiers），
 * 因此不再有 useAI 开关 —— 打开网页即可得到稳定结果。
 *
 * @param {string} domainId
 * @param {{limit?: number, localLimit?: number, onStage?: Function}} [options]
 */
export async function buildRelatedWords(domainId, options = {}) {
  const onStage = options.onStage || (() => {});

  onStage({ stage: 'local', message: '正在用领域术语表匹配相关词…' });
  const local = await wordBankService.filterByDomain(domainId, {
    limit: options.localLimit ?? 600,
  });
  onStage({ stage: 'local-done', message: `匹配到 ${local.length} 个相关词`, count: local.length });

  const limited = typeof options.limit === 'number' ? local.slice(0, options.limit) : local;

  // 附带「所属领域数组」——同一个词可能同时属于多个领域
  wordBankService.attachDomainTags(limited);

  return { words: limited, localCount: local.length, aiUsed: false };
}

/**
 * 为一批单词准备卡片数据。
 * 数据来源全部是静态的：
 *   material ← domainMaterialService（预生成 JSON）
 *   image    ← 用户覆盖（localStorage） > 材料预置 imageUrl
 *   domains  ← wordBankService 多领域标签索引
 *
 * @returns {Promise<Array<Word & {material, hasMaterial, image, domains}>>}
 */
export async function hydrateCards(domainId, words) {
  const list = (words || []).map((w) => ({ ...w }));
  await domainMaterialService.attachMaterials(domainId, list);
  wordBankService.attachDomainTags(list);
  return list;
}

/**
 * 单条材料的读取（供详情页/做题结果页按需获取）
 * 注意：这是读静态数据，不是「生成」。
 */
export async function getMaterialFor(domainId, word) {
  return domainMaterialService.getMaterialWithImage(domainId, word);
}

/**
 * 收藏设置为指定状态（转发到 dataService，页面不直接碰存储）
 * 用「显式设置」而非「盲目 toggle」，避免并发点击时状态与用户意图相反。
 * @returns {Promise<boolean>} 落库后的真实状态
 */
export async function setFavorite(domainId, word, on) {
  return dataService.setFavorite(domainId, word, on);
}

/**
 * 收藏切换（保留旧签名，内部复用 setFavorite 的原子写）
 * @returns {Promise<boolean>} 切换后的状态
 */
export async function toggleFavorite(domainId, word) {
  return dataService.toggleFavorite(domainId, word);
}

/**
 * 收藏夹词条（跨领域，已附加材料与领域标签，可直接渲染卡片或出题）
 *
 * ⚠️ 关键点：收藏记录可能在词库中找不到对应词条
 *   （例如 soul / nail 这类不在六级词库范围内的词）。
 *   旧实现直接 `continue` 丢掉，导致「收藏了 3 个只显示 1 个」的假空白。
 *   现在保留这类词条，用最小可用结构占位，保证收藏夹「所见即所藏」。
 */
export async function buildFavorites(domainId) {
  const favs = await dataService.getFavorites(domainId);
  const out = [];
  const missing = [];

  for (const f of favs) {
    const hit = await wordBankService.getWordById(`cet6:${String(f.word).toLowerCase()}`);
    if (!hit) {
      // 词库里没有这个词 —— 仍然展示，避免用户以为收藏丢了
      missing.push(f.word);
    }
    const item = hit
      ? { ...hit, domainId: f.domainId }
      : {
          id: `${f.domainId}:${String(f.word).toLowerCase()}`,
          word: f.word,
          phonetic: '',
          translation: '',
          root: '核心词',
          type: 'core',
          bank: 'cet6',
          domainId: f.domainId,
          __missingInBank: true,   // 供 UI 提示「该词不在当前词库中」
        };
    item.favoritedAt = f.favoritedAt;
    await domainMaterialService.attachMaterials(f.domainId, [item]);
    wordBankService.attachDomainTags([item]);
    out.push(item);
  }

  // 最近收藏的排前面
  out.sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
  return out;
}

/**
 * 复习会话：构建题序（保留旧版能力，供「输入式复习」使用）
 * 顺序策略：优先「答错过的」和「未学过的」，其余随机打散
 */
export async function buildReviewSession(domainId, words, options = {}) {
  const stats = await dataService.getHistoryStats(domainId);
  const wrongWords = new Set(stats.byWord.filter((s) => s.correct < s.total).map((s) => s.word));
  const studiedSet = new Set(stats.byWord.map((s) => s.word));

  const withMeta = await hydrateCards(domainId, words);
  for (const w of withMeta) {
    w.__wrong = wrongWords.has(w.word);
    w.__studied = studiedSet.has(w.word);
  }

  const tier1 = withMeta.filter((w) => w.__wrong);
  const tier2 = withMeta.filter((w) => !w.__wrong && !w.__studied);
  const tier3 = withMeta.filter((w) => !w.__wrong && w.__studied);

  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let session = [...shuffle(tier1), ...shuffle(tier2), ...shuffle(tier3)];
  if (options.limit) session = session.slice(0, options.limit);
  return session;
}

/* ===========================================================================
 * 功能一：我的库（兴趣领域订阅）
 * =========================================================================== */

/** 读取「我的库」领域 id 列表 */
export async function getUserDomains() {
  return dataService.getUserDomains();
}

/**
 * 我的库 + 全部领域详情的合并结果，供页面直接渲染。
 * 每项带 `inMyLibrary` 标记，页面无需自己比对。
 * @returns {Promise<Array<Domain & {inMyLibrary:boolean}>>}
 */
export async function getDomainChoices() {
  const [all, mine] = await Promise.all([
    Promise.resolve(wordBankService.getDomains()),
    dataService.getUserDomains(),
  ]);
  const mineSet = new Set(mine);
  return all.map((d) => ({ ...d, inMyLibrary: mineSet.has(d.id) }));
}

/** 只取「我的库」里的领域详情（主界面渲染用） */
export async function getMyDomains() {
  const [all, mine] = await Promise.all([
    Promise.resolve(wordBankService.getDomains()),
    dataService.getUserDomains(),
  ]);
  const order = new Map(mine.map((id, i) => [id, i]));
  return all
    .filter((d) => order.has(d.id))
    .map((d) => ({ ...d, inMyLibrary: true }))
    .sort((a, b) => order.get(a.id) - order.get(b.id));
}

/** 是否已完成首次引导（「我的库」非空即视为已选过） */
export async function hasChosenDomains() {
  const mine = await dataService.getUserDomains();
  return mine.length > 0;
}

export async function addUserDomain(domainId) {
  return dataService.addUserDomain(domainId);
}

export async function removeUserDomain(domainId) {
  return dataService.removeUserDomain(domainId);
}

export async function setUserDomains(domainIds) {
  return dataService.setUserDomains(domainIds);
}

/* ===========================================================================
 * 功能三：熟词库（掌握进度）
 * =========================================================================== */

export async function isMastered(domainId, word) {
  return dataService.isMastered(domainId, word);
}

/** 熟词的稳定键列表（domainId::word）——首页批量比对用，避免 N 次读盘 */
export async function getMasteredKeys() {
  return dataService.getMasteredKeys();
}

export async function toggleMastered(domainId, word) {
  return dataService.toggleMastered(domainId, word);
}

export async function setMastered(domainId, word, on) {
  return dataService.setMastered(domainId, word, on);
}

/**
 * 六级词汇掌握进度：已掌握（且在词库内）的词数 / 六级词库总数。
 *
 * 说明：熟词库里可能有不在词库内的词（例如游戏专有名词），
 * 这类不计入分子，保证「X / 总数」不超过 100%。
 * @returns {Promise<{mastered:number, total:number, ratio:number}>}
 */
export async function getMasteryProgress() {
  // 必须先确保词库已载入 —— 否则 getWordById/getWordCount 会返回空，
  // 导致「掌握进度」显示 0 / 0（页面刷新后进度条归零的隐患）。
  await wordBankService.ensureLoaded();
  const [words, total] = await Promise.all([
    dataService.getAllMasteredWords(),
    Promise.resolve(wordBankService.getWordCount()),
  ]);
  let count = 0;
  for (const w of words) {
    const hit = await wordBankService.getWordById(`cet6:${String(w).toLowerCase()}`);
    if (hit) count += 1;
  }
  const denom = Number(total) || 0;
  return { mastered: count, total: denom, ratio: denom ? count / denom : 0 };
}

/** 熟词列表（附材料与领域标签，可直接渲染卡片） */
export async function buildMasteredWords(domainId) {
  const list = await dataService.getMasteredWords(domainId);
  const out = [];
  for (const m of list) {
    const hit = await wordBankService.getWordById(`cet6:${String(m.word).toLowerCase()}`);
    const item = hit
      ? { ...hit, domainId: m.domainId }
      : {
          id: `${m.domainId}:${String(m.word).toLowerCase()}`,
          word: m.word,
          phonetic: '',
          translation: '',
          root: '核心词',
          type: 'core',
          bank: 'cet6',
          domainId: m.domainId,
          __missingInBank: true,
        };
    item.masteredAt = m.masteredAt;
    item.mastered = true;
    await domainMaterialService.attachMaterials(m.domainId, [item]);
    wordBankService.attachDomainTags([item]);
    out.push(item);
  }
  out.sort((a, b) => (b.masteredAt || 0) - (a.masteredAt || 0));
  return out;
}

/* ===========================================================================
 * 功能四：错题本
 * =========================================================================== */

/** 错题列表（默认按错误率降序），字段：word/domainId/wrongCount/totalAttempts/ratio */
export async function getWrongWords(domainId) {
  return dataService.getWrongWords(domainId);
}

export async function getWrongCount(domainId) {
  return dataService.getWrongCount(domainId);
}

export async function removeFromWrongWords(domainId, word) {
  return dataService.removeFromWrongWords(domainId, word);
}

/**
 * 错题词条（附材料与领域标签，可渲染完整卡片 / 用于「从错题本开始复习」出题）
 * 排序沿用错误率降序。
 */
export async function buildWrongWords(domainId) {
  const list = await dataService.getWrongWords(domainId);
  const out = [];
  for (const w of list) {
    const hit = await wordBankService.getWordById(`cet6:${String(w.word).toLowerCase()}`);
    const item = hit
      ? { ...hit, domainId: w.domainId }
      : {
          id: `${w.domainId}:${String(w.word).toLowerCase()}`,
          word: w.word,
          phonetic: '',
          translation: '',
          root: '核心词',
          type: 'core',
          bank: 'cet6',
          domainId: w.domainId,
          __missingInBank: true,
        };
    item.wrongCount = w.wrongCount;
    item.totalAttempts = w.totalAttempts;
    item.lastWrongAt = w.lastWrongAt;
    item.errorRatio = w.ratio;
    await domainMaterialService.attachMaterials(w.domainId, [item]);
    wordBankService.attachDomainTags([item]);
    out.push(item);
  }
  return out; // dataService 已按错误率降序
}

/* ===========================================================================
 * 功能二：复习分组
 * =========================================================================== */

/** 每组可选词数（需求：10/20/30/50，默认 20） */
export const REVIEW_GROUP_SIZES = [10, 20, 30, 50];
export const DEFAULT_REVIEW_GROUP_SIZE = 20;

/**
 * 准备复习分组。
 *
 * 需求：进入复习后先让用户设置「每组多少词」，系统把收藏随机分组，
 *       一组一组做，每组独立统计。
 *
 * @param {{domainId?:string, groupSize?:number, includeMastered?:boolean}} [options]
 * @returns {Promise<{groups:Array<Array>, groupSize:number, total:number, totalGroups:number, favoritedAt:Map}>}
 */
export async function buildReviewGroups(options = {}) {
  const groupSize = Number(options.groupSize) || DEFAULT_REVIEW_GROUP_SIZE;
  const domainId = options.domainId || null;

  // 1) 取收藏（已附材料与领域标签）——复习题的来源
  const favorites = await buildFavorites(domainId);

  // 2) 默认排除熟词；用户勾选「包含熟词」时才纳入
  const includeMastered = Boolean(options.includeMastered);
  const masteredKeys = new Set(await dataService.getMasteredKeys());
  const pool = includeMastered
    ? favorites
    : favorites.filter((w) => !masteredKeys.has(`${w.domainId}::${String(w.word).toLowerCase()}`));

  // 3) 随机打散后按 groupSize 切分
  const shuffled = shuffleArray(pool);
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }

  return {
    groups,
    groupSize,
    total: shuffled.length,
    totalGroups: groups.length,
    excludedMastered: favorites.length - pool.length,
    includeMastered,
  };
}

/** Fisher–Yates 洗牌（返回新数组，不改原数组） */
function shuffleArray(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 落盘一组复习结果（转发到 dataService，供「已完成 X / Y 组」进度展示） */
export async function saveGroupResult(session) {
  return dataService.saveQuizSession(session);
}

/** 本次复习（同 sessionId）的累计表现 */
export async function getSessionSummary(sessionId) {
  return dataService.getQuizSessionSummary(sessionId);
}

export async function getQuizSessions(sessionId) {
  return dataService.getQuizSessions(sessionId ? { sessionId } : {});
}

export default {
  buildRelatedWords,
  hydrateCards,
  getMaterialFor,
  toggleFavorite,
  setFavorite,
  buildFavorites,
  buildReviewSession,
  // 功能一：我的库
  getUserDomains,
  getDomainChoices,
  getMyDomains,
  hasChosenDomains,
  addUserDomain,
  removeUserDomain,
  setUserDomains,
  // 功能三：熟词库
  isMastered,
  getMasteredKeys,
  toggleMastered,
  setMastered,
  getMasteryProgress,
  buildMasteredWords,
  // 功能四：错题本
  getWrongWords,
  getWrongCount,
  removeFromWrongWords,
  buildWrongWords,
  // 功能二：复习分组
  buildReviewGroups,
  saveGroupResult,
  getSessionSummary,
  getQuizSessions,
  REVIEW_GROUP_SIZES,
  DEFAULT_REVIEW_GROUP_SIZE,
};
