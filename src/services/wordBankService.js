/**
 * wordBankService.js
 * ============================================================================
 * 词库服务层（模块一：词库系统）
 *
 * 唯一职责：屏蔽「词库从哪来」的细节，对外提供稳定的查询接口。
 * 页面组件一律通过本模块访问词库，禁止直接 import 词库 JSON。
 *
 * 最终版演进路径（只改本文件 + 新增数据文件，页面完全不动）：
 *   1. 多词库（四级 / 六级 / 考研 / 雅思 / 托福）→ 在 BANK_REGISTRY 注册新词库。
 *   2. 用户导入 CSV / TXT → 实现 importFromFile()，把解析结果写入
 *      bankCache，并持久化到 dataService。
 *   3. 词库切换 / 混用 → 调用 setActiveBanks([...]) 传入多个 bankId。
 *   4. 换数据源（后端接口）→ 只需改 loadBankRaw() 里的 fetch URL 与响应字段。
 *
 * 对外接口：
 *   - getAllWords(options)      取全部（或激活词库）的词
 *   - getWordById(id)
 *   - searchWords(keyword, opt)
 *   - filterByDomain(domainId, opt)
 *   - getBanks() / setActiveBanks() / getActiveBanks()
 *   - getBanksSync()            依赖已加载的缓存
 *   - ensureLoaded()            懒加载入口
 *   - importFromFile(file)      预留：用户自定义词库导入
 * ============================================================================
 */

import { INTEREST_DOMAINS, buildDomainIndex, normalizeTerm } from '../config/interestsConfig.js';

/* ---------------------------------------------------------------------------
 * 词库注册表
 * 新增词库：往这里加一项 + 新增对应数据文件即可。
 * loader 走 fetch，浏览器与 Node 行为一致；换后端时只改 dataUrl。
 * ------------------------------------------------------------------------ */
const BANK_REGISTRY = {
  cet6: {
    id: 'cet6',
    name: '六级核心词库',
    shortName: 'CET-6',
    description: '大学英语六级核心词汇，含音标、释义、词根与类型标注',
    builtin: true,
    dataUrl: new URL('../data/cet6Core.json', import.meta.url).href,
  },
  // 以下为「最终版」预留槽位，数据文件补齐后取消注释即可启用：
  // cet4: { id: 'cet4', name: '四级核心词库', shortName: 'CET-4', builtin: true,
  //         dataUrl: new URL('../data/cet4Core.json', import.meta.url).href },
  // kaoyan: { id: 'kaoyan', name: '考研核心词库', shortName: '考研', builtin: true,
  //           dataUrl: new URL('../data/kaoyanCore.json', import.meta.url).href },
  // ielts: { id: 'ielts', name: '雅思核心词库', shortName: 'IELTS', builtin: true,
  //          dataUrl: new URL('../data/ieltsCore.json', import.meta.url).href },
  // toefl: { id: 'toefl', name: '托福核心词库', shortName: 'TOEFL', builtin: true,
  //          dataUrl: new URL('../data/toeflCore.json', import.meta.url).href },
};

/** 默认激活的词库（最终版可从 dataService 读取用户上次选择） */
const DEFAULT_ACTIVE = ['cet6'];

/* ---------------------------------------------------------------------------
 * 领域预生成材料的 dataUrl 映射
 *
 * 为什么放在这里而不是 domainMaterialService：
 *   两者都依赖 fetch 与 URL 解析，集中在一处便于「换后端」时统一替换。
 *   domainMaterialService 通过 resolveMaterialUrl(domainId) 取地址，
 *   自身不持有任何路径字面量 —— 以后改成后端接口只改这张表。
 *
 * 新增领域时：加一行映射即可（文件按 <domainId>.json 命名）。
 * ------------------------------------------------------------------------ */
const MATERIAL_FILES = {
  slay_the_spire: new URL('../data/domainMaterials/slayTheSpire.json', import.meta.url).href,
  hollow_knight: new URL('../data/domainMaterials/hollowKnight.json', import.meta.url).href,
  honor_of_kings: new URL('../data/domainMaterials/honorOfKings.json', import.meta.url).href,
  valorant: new URL('../data/domainMaterials/valorant.json', import.meta.url).href,
};

/** 取某领域的预生成材料地址；未配置返回 '' */
export function resolveMaterialUrl(domainId) {
  return MATERIAL_FILES[domainId] || '';
}

/** 已配置预生成材料的领域 id 列表 */
export function getDomainsWithMaterials() {
  return Object.keys(MATERIAL_FILES);
}

/* ---------------------------------------------------------------------------
 * 内部状态
 * ------------------------------------------------------------------------ */
const bankCache = new Map();      // bankId -> word[]
let activeBanks = [...DEFAULT_ACTIVE];
let loadPromise = null;
/** 领域索引缓存：domainId -> { exact, vocab, excluded } */
const domainIndexCache = new Map();

/* ---------------------------------------------------------------------------
 * 领域相关词内存缓存（本轮性能优化）
 * ---------------------------------------------------------------------------
 * filterByDomain() 需要对全量词库（约 6000 词）逐词做变形、术语匹配与排序，
 * 单次耗时在移动端相当可观。而同一领域 + 同一激活词库的结果是**确定性**的，
 * 因此把「已排序的全量结果」缓存下来：
 *   · 用户第二次切回同一领域 → 直接返回缓存数组，0 重算 → 秒开
 *   · limit / minScore 只在缓存结果上做切片 / 过滤，不重新匹配
 * 缓存键 = `${domainId}|${激活词库 id 列表}`，因此切换词库不会命中脏缓存。
 * 内存占用：每个领域约 600 个词条对象引用（非深拷贝），可忽略。
 * ------------------------------------------------------------------------ */
const domainWordsCache = new Map();
/** 相关词缓存是否已就绪（页面可据此决定是否展示骨架屏） */
export function hasDomainWordsCache(domainId) {
  for (const key of domainWordsCache.keys()) {
    if (key === String(domainId) || key.startsWith(`${domainId}|`)) return true;
  }
  return false;
}
/** 清空相关词缓存（切换词库 / 测试时使用） */
export function clearDomainWordsCache() {
  domainWordsCache.clear();
}

/* ---------------------------------------------------------------------------
 * 归一化：把任意数据源的记录统一成标准 Word 结构。
 * 最终版从后端返回的数据可能字段不同，只在这里做一次映射即可。
 * ------------------------------------------------------------------------ */
function normalizeWord(raw, bankId) {
  if (!raw || !raw.word) return null;
  const w = String(raw.word).trim();
  if (!w) return null;
  return {
    // 稳定唯一 id：bankId + 小写单词，便于跨词库去重与收藏
    id: `${raw.bank || bankId}:${w.toLowerCase()}`,
    word: w,
    phonetic: raw.phonetic || '',
    translation: raw.translation || '',
    root: raw.root || '核心词',
    type: raw.type === 'derived' ? 'derived' : 'core',
    bank: raw.bank || bankId,
    // 领域标签由 filterByDomain 动态计算，此处保留占位以统一结构
    domainTags: raw.domainTags || [],
  };
}

/** 载入单个词库（改为后端请求时，只需替换函数体） */
async function loadBankRaw(bankId) {
  const meta = BANK_REGISTRY[bankId];
  if (!meta) throw new Error(`[wordBankService] 未注册的词库: ${bankId}`);
  if (!meta.builtin) {
    // 用户自定义词库：从 dataService 读取（由外部注入，避免循环依赖）
    return meta.customData || [];
  }
  const res = await fetch(meta.dataUrl);
  if (!res.ok) throw new Error(`[wordBankService] 载入词库失败 ${bankId}: HTTP ${res.status}`);
  const list = await res.json();
  return Array.isArray(list) ? list : (list.words || []);
}

/* ---------------------------------------------------------------------------
 * 公开 API
 * ------------------------------------------------------------------------ */

/** 词库元信息列表（不含词条，供 UI 渲染切换器） */
export function getBanks() {
  return Object.values(BANK_REGISTRY).map(({ id, name, shortName, description, builtin }) => ({
    id, name, shortName, description, builtin,
  }));
}

/**
 * 注册自定义词库（最终版：用户导入 CSV/TXT 后调用）
 * @param {{id, name, shortName, description}} meta
 * @param {Array} words
 */
export function registerCustomBank(meta, words) {
  if (!meta || !meta.id) throw new Error('[wordBankService] 自定义词库必须提供 id');
  BANK_REGISTRY[meta.id] = { ...meta, builtin: false, customData: words };
  bankCache.set(meta.id, (words || []).map((r) => normalizeWord(r, meta.id)).filter(Boolean));
  // 词库集合变了 → 相关词缓存必须失效，避免命中旧结果
  clearDomainWordsCache();
  return meta.id;
}

/** 设置激活词库（支持混用多个） */
export function setActiveBanks(ids) {
  const valid = (Array.isArray(ids) ? ids : [ids]).filter((id) => BANK_REGISTRY[id]);
  activeBanks = valid.length ? valid : [...DEFAULT_ACTIVE];
  // 缓存键含词库列表，理论上不会串；仍显式清一次，保证语义简单可预期
  clearDomainWordsCache();
  return activeBanks;
}

export function getActiveBanks() {
  return [...activeBanks];
}

/** 确保激活词库已载入内存（并发安全，多个组件同时调用只加载一次） */
export async function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const ids = Object.keys(BANK_REGISTRY);
    await Promise.all(ids.map(async (id) => {
      if (bankCache.has(id)) return;
      const raw = await loadBankRaw(id);
      bankCache.set(id, raw.map((r) => normalizeWord(r, id)).filter(Boolean));
    }));
  })();
  return loadPromise;
}

/**
 * 取词条。
 * @param {{banks?: string[], includeDerived?: boolean, limit?: number, offset?: number}} [options]
 */
export async function getAllWords(options = {}) {
  await ensureLoaded();
  const banks = options.banks && options.banks.length ? options.banks : activeBanks;
  let out = [];
  for (const id of banks) {
    const list = bankCache.get(id);
    if (list) out = out.concat(list);
  }
  // 跨词库按单词去重（保留先出现的），为「混用词库」做准备
  if (banks.length > 1) {
    const seen = new Set();
    out = out.filter((w) => {
      if (seen.has(w.word.toLowerCase())) return false;
      seen.add(w.word.toLowerCase());
      return true;
    });
  }
  if (options.includeDerived === false) out = out.filter((w) => w.type === 'core');
  if (typeof options.offset === 'number' || typeof options.limit === 'number') {
    const start = options.offset || 0;
    const end = typeof options.limit === 'number' ? start + options.limit : undefined;
    out = out.slice(start, end);
  }
  return out;
}

/** 同步版本：仅返回已缓存的内容，供首屏同步渲染 */
export function getCachedWords() {
  let out = [];
  for (const id of activeBanks) {
    const list = bankCache.get(id);
    if (list) out = out.concat(list);
  }
  return out;
}

export function getWordCount() {
  let n = 0;
  for (const id of Object.keys(BANK_REGISTRY)) n += (bankCache.get(id) || []).length;
  return n;
}

export async function getWordById(id) {
  await ensureLoaded();
  for (const list of bankCache.values()) {
    const hit = list.find((w) => w.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * 关键词搜索：匹配单词拼写或中文释义。
 * @param {string} keyword
 * @param {{limit?: number, banks?: string[]}} [options]
 */
export async function searchWords(keyword, options = {}) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return [];
  const all = await getAllWords({ banks: options.banks });
  const limit = options.limit || 200;
  const out = [];
  for (const w of all) {
    if (w.word.toLowerCase().includes(kw) || w.translation.includes(kw)) {
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 领域关联词筛选（模块三：第一层 —— 本地关键词匹配）
 *
 * 策略（从强到弱）：
 *   L1 精确命中：单词（或规则变形）在 domainTerms 中 → 强关联，附官方译名
 *   L2 词汇命中：单词在 domainVocabulary 中 → 中等关联
 *   L3 释义命中：中文释义包含领域术语的中文译名 → 弱关联
 *   L4 拼写接近：单词与某术语有共同长词根（>=5 字母） → 弱关联候选
 *
 * 注意：excludedTerms 会剔除假阳性（如 save/settings 这类功能词）。
 * ------------------------------------------------------------------------ */
function getDomainIndex(domainId) {
  if (domainIndexCache.has(domainId)) return domainIndexCache.get(domainId);
  const domain = INTEREST_DOMAINS[domainId];
  const index = buildDomainIndex(domain);
  domainIndexCache.set(domainId, index);
  return index;
}

/** 常见规则变形：复数、过去式、进行时、副词等，用于宽松命中术语表 */
function variantsOf(word) {
  const w = word.toLowerCase();
  const set = new Set([w]);
  const push = (s) => { if (s && s.length >= 3) set.add(s); };
  push(w.replace(/ies$/, 'y'));
  push(w.replace(/es$/, ''));
  push(w.replace(/s$/, ''));
  push(w.replace(/ed$/, ''));
  push(w.replace(/ed$/, 'e'));
  push(w.replace(/ing$/, ''));
  push(w.replace(/ing$/, 'e'));
  push(w.replace(/ly$/, ''));
  push(w.replace(/ness$/, ''));
  push(w.replace(/ment$/, ''));
  push(w.replace(/ness$/, ''));
  push(w.replace(/er$/, ''));
  push(w.replace(/est$/, ''));
  // 注意：-ion / -ation 派生容易过度匹配（如 defection → defect），
  // 仅在还原后长度足够且与术语表实际存在时才生效，因此这里保留规则交由命中判定兜底，
  // 同时在领域配置的 excludedTerms 中显式排除已知假阳性。
  push(w.replace(/ation$/, ''));
  push(w.replace(/ion$/, ''));
  return [...set];
}

/**
 * 领域相关词筛选（带内存缓存）。
 *
 * 首次调用：全量匹配 + 排序 → 写入 domainWordsCache。
 * 之后调用：直接复用缓存数组（同一领域秒开），只做 minScore 过滤与 limit 切片。
 *
 * @param {string} domainId
 * @param {{limit?: number, minScore?: number, banks?: string[]}} [options]
 * @returns {Promise<Array<Word & {relevance: {score:number, level:string, evidence:string, domainTermZh:string}}>>}
 */
export async function filterByDomain(domainId, options = {}) {
  const domain = INTEREST_DOMAINS[domainId];
  if (!domain) return [];

  const banks = options.banks && options.banks.length ? options.banks : activeBanks;
  const cacheKey = `${domainId}|${banks.join(',')}`;

  let results = domainWordsCache.get(cacheKey);
  if (!results) {
    results = await computeDomainWords(domainId, domain, banks);
    domainWordsCache.set(cacheKey, results);
  }

  const minScore = options.minScore ?? 1;
  const filtered = minScore <= 1 ? results : results.filter((r) => r.relevance.score >= minScore);
  return typeof options.limit === 'number' ? filtered.slice(0, options.limit) : filtered;
}

/** 真正的全量匹配 + 排序（只在缓存未命中时执行一次） */
async function computeDomainWords(domainId, domain, banks) {
  const index = getDomainIndex(domainId);
  const all = await getAllWords({ banks });
  const termZhList = [...new Set(Object.values(domain.domainTerms || {}))];

  const results = [];
  for (const w of all) {
    const lw = w.word.toLowerCase();
    if (index.excluded.has(lw)) continue;

    let score = 0;
    let level = 'none';
    let evidence = '';
    let domainTermZh = '';
    let termWeight = 1;

    // L1 精确命中专有术语
    const vars = variantsOf(lw);
    for (const v of vars) {
      if (index.exact.has(v)) {
        score = 100;
        level = 'exact';
        domainTermZh = index.exact.get(v);
        termWeight = index.weight?.get(v) ?? 1;
        evidence = `专有术语：${w.word} → ${domainTermZh}`;
        break;
      }
    }

    // L2 领域词汇命中
    if (!score) {
      for (const v of vars) {
        if (index.vocab.has(v)) {
          score = 72;
          level = 'vocab';
          termWeight = index.weight?.get(v) ?? 1;
          evidence = `领域常用词：${w.word} → ${index.vocab.get(v)}`;
          break;
        }
      }
    }

    // L3 释义命中（中文译名出现在通用释义中）
    if (!score && w.translation) {
      for (const zh of termZhList) {
        if (zh && zh.length >= 2 && w.translation.includes(zh)) {
          score = 48;
          level = 'gloss';
          evidence = `释义含领域术语「${zh}」`;
          break;
        }
      }
    }

    // L4 长词根相似（>=6 字母的共同前缀，避免噪声）
    if (!score) {
      for (const key of index.exact.keys()) {
        if (key.length < 6 || lw.length < 6) continue;
        const n = 6;
        if (key.slice(0, n) === lw.slice(0, n) || key.slice(-n) === lw.slice(-n)) {
          score = 26;
          level = 'fuzzy';
          evidence = `词形接近领域术语 ${key}`;
          break;
        }
      }
    }

    if (score > 0) {
      results.push({
        ...w,
        relevance: { score, level, evidence, domainTermZh, termWeight },
      });
    }
  }

  results.sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score;
    // 同层级时：术语权重高的优先（核心机制/角色词 排在 边缘遗物词 之前）
    if (b.relevance.termWeight !== a.relevance.termWeight) {
      return b.relevance.termWeight - a.relevance.termWeight;
    }
    return a.word.toLowerCase().localeCompare(b.word.toLowerCase());
  });

  return results;
}

/** 同步版本：基于已缓存词条做领域筛选（供首屏无阻塞渲染） */
export function filterByDomainSync(domainId, options = {}) {
  const domain = INTEREST_DOMAINS[domainId];
  if (!domain) return [];
  const index = getDomainIndex(domainId);
  const all = getCachedWords();
  const out = [];
  for (const w of all) {
    const lw = w.word.toLowerCase();
    if (index.excluded.has(lw)) continue;
    for (const v of variantsOf(lw)) {
      if (index.exact.has(v)) {
        out.push({ ...w, relevance: { score: 100, level: 'exact', evidence: `专有术语：${w.word} → ${index.exact.get(v)}`, domainTermZh: index.exact.get(v), termWeight: index.weight?.get(v) ?? 1 } });
        break;
      }
      if (index.vocab.has(v)) {
        out.push({ ...w, relevance: { score: 72, level: 'vocab', evidence: `领域常用词：${w.word} → ${index.vocab.get(v)}`, domainTermZh: '', termWeight: index.weight?.get(v) ?? 1 } });
        break;
      }
    }
  }
  out.sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score;
    if (b.relevance.termWeight !== a.relevance.termWeight) return b.relevance.termWeight - a.relevance.termWeight;
    return a.word.toLowerCase().localeCompare(b.word.toLowerCase());
  });
  return typeof options.limit === 'number' ? out.slice(0, options.limit) : out;
}

/** 判断单个单词是否为该领域的专有术语，返回官方译名 */
export function lookupDomainTerm(domainId, word) {
  const index = getDomainIndex(domainId);
  const lw = String(word || '').toLowerCase();
  for (const v of variantsOf(lw)) {
    if (index.exact.has(v)) return { isTerm: true, zh: index.exact.get(v) };
  }
  return { isTerm: false, zh: '' };
}

/** 领域元信息（供 UI 渲染选择器），加新领域无需改页面 */
export function getDomains() {
  return Object.values(INTEREST_DOMAINS).map((d) => ({
    id: d.id,
    name: d.name,
    subtitle: d.subtitle,
    description: d.description,
    icon: d.icon,
    theme: d.theme,
    termCount: getDomainIndex(d.id).termCount,
  }));
}

export function getDomainDetail(domainId) {
  const d = INTEREST_DOMAINS[domainId];
  if (!d) return null;
  return { ...d, termCount: getDomainIndex(domainId).termCount };
}

/* ---------------------------------------------------------------------------
 * 多领域归属查询（模块二：不同兴趣库可以有重合）
 *
 * 关键点：同一个单词可以同时属于多个兴趣领域。
 *   例如 soul 在《空洞骑士》下是「灵魂」，在《杀戮尖塔》下也可能存在关联。
 * 因此「单词 → 领域」是一对多关系，页面渲染卡片时必须显示全部领域标签。
 *
 * 返回结构：
 *   [{ domainId, domainName, theme, level, domainTermZh, score, termWeight, unverified? }]
 * 说明：
 *   - level='exact' 表示该词在领域术语表中有正式译名（domainTermZh 有效）
 *   - level='vocab' 表示仅为领域常用词，不展示为专有术语
 *   - 排序：exact 优先，其次按 termWeight / score 降序，最后按领域配置顺序
 * ------------------------------------------------------------------------ */
const domainTagsCache = new Map(); // word(lower) -> tags[]

/** 构建「单词 → 多领域标签」索引（惰性、全库规模只算一次） */
function buildDomainTagIndex() {
  if (domainTagsCache.size) return domainTagsCache;
  const allWords = getCachedWords();
  for (const w of allWords) {
    const lw = w.word.toLowerCase();
    const tags = [];
    for (const domainId of Object.keys(INTEREST_DOMAINS)) {
      const index = getDomainIndex(domainId);
      if (index.excluded.has(lw)) continue;
      let hit = null;
      for (const v of variantsOf(lw)) {
        if (index.exact.has(v)) {
          hit = {
            level: 'exact',
            domainTermZh: index.exact.get(v),
            score: 100,
            termWeight: index.weight?.get(v) ?? 1,
          };
          break;
        }
        if (index.vocab.has(v)) {
          hit = { level: 'vocab', domainTermZh: '', score: 72, termWeight: index.weight?.get(v) ?? 1 };
          break;
        }
      }
      if (!hit) continue;
      const d = INTEREST_DOMAINS[domainId];
      tags.push({
        domainId,
        domainName: d.name,
        domainSubtitle: d.subtitle,
        theme: d.theme,
        icon: d.icon,
        ...hit,
      });
    }
    tags.sort((a, b) => {
      if (a.level !== b.level) return a.level === 'exact' ? -1 : 1;
      if (b.termWeight !== a.termWeight) return b.termWeight - a.termWeight;
      return b.score - a.score;
    });
    domainTagsCache.set(lw, tags);
  }
  return domainTagsCache;
}

/**
 * 查询某个单词所属的全部领域标签
 * @param {string} word
 * @returns {Array<{domainId, domainName, theme, level, domainTermZh, score, termWeight}>}
 */
export function getDomainTags(word) {
  const index = buildDomainTagIndex();
  return index.get(String(word || '').toLowerCase()) || [];
}

/** 仅返回「专有术语级」的领域标签（用于卡片上标注官方译名） */
export function getExactDomainTags(word) {
  return getDomainTags(word).filter((t) => t.level === 'exact');
}

/**
 * 为一批词条批量附加 `domains` 数组字段。
 * 卡片组件只消费 `word.domains`，不需要自己调用 getDomainTags()。
 * @param {Array} words
 * @returns {Array} 原数组（原地写入 domains 字段）
 */
export function attachDomainTags(words) {
  for (const w of words || []) {
    if (!w || !w.word) continue;
    if (!Array.isArray(w.domains)) w.domains = getDomainTags(w.word);
  }
  return words;
}

/** 某领域下的全部「专有术语级」词条（供做题模式干扰项挑选与统计） */
export function getDomainExactWords(domainId) {
  return filterByDomainSync(domainId).filter((w) => w.relevance.level === 'exact');
}

/* ---------------------------------------------------------------------------
 * 预留：用户自定义词库导入（最终版）
 * 解析 CSV / TXT → 标准化 → registerCustomBank
 * 本次预设版不接入 UI，但接口形态已固定，未来接上即可用。
 * ------------------------------------------------------------------------ */
export async function importFromFile(file, meta = {}) {
  const text = await file.text();
  const rows = parseDelimited(text);
  const bankId = meta.id || `custom_${Date.now()}`;
  const bankName = meta.name || file.name.replace(/\.[^.]+$/, '');
  registerCustomBank(
    { id: bankId, name: bankName, shortName: bankName.slice(0, 8), description: '用户导入词库', builtin: false },
    rows,
  );
  return { bankId, count: rows.length };
}

function parseDelimited(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out = [];
  for (const line of lines) {
    // 兼容逗号 / 制表符 / 全角逗号分隔
    const cells = line.split(/\t|,|，/).map((s) => s.replace(/^"|"$/g, '').trim());
    if (!cells[0]) continue;
    // 跳过表头
    if (/^(word|单词)$/i.test(cells[0])) continue;
    out.push({
      word: cells[0],
      phonetic: cells[1] && /^\/.*\/$/.test(cells[1]) ? cells[1] : '',
      translation: cells[1] && !/^\/.*\/$/.test(cells[1]) ? cells[1] : (cells[2] || ''),
      root: cells[3] || '核心词',
      type: 'core',
    });
  }
  return out;
}

export default {
  getBanks,
  registerCustomBank,
  setActiveBanks,
  getActiveBanks,
  ensureLoaded,
  getAllWords,
  getCachedWords,
  getWordCount,
  getWordById,
  searchWords,
  filterByDomain,
  filterByDomainSync,
  hasDomainWordsCache,
  clearDomainWordsCache,
  lookupDomainTerm,
  getDomains,
  getDomainDetail,
  getDomainTags,
  getExactDomainTags,
  attachDomainTags,
  getDomainExactWords,
  importFromFile,
  normalizeTerm,
  resolveMaterialUrl,
  getDomainsWithMaterials,
};
