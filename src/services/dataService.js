/**
 * dataService.js
 * ============================================================================
 * 数据读写服务层（模块二：多人使用 —— 当前为纯前端实现）
 *
 * 唯一职责：封装所有「持久化」操作。页面组件禁止直接触碰 localStorage。
 *
 * 最终版演进路径（只改本文件）：
 *   1. 换成后端：把 load/save 的实现改为 fetch(`/api/state`, ...) 即可，
 *      函数签名与返回值保持不变，页面与其他 service 全部无需改动。
 *   2. 加登录：在 loadState/saveState 中附带 Authorization 头。
 *   3. 用户间分享词库 / 卡片 / 学习记录：新增 shareXxx() / fetchSharedXxx()，
 *      内部走同一套请求封装 request()。
 *
 * 存储分层（localStorage 中以命名空间隔离）：
 *   wb:cet6:settings   —— 设置（API Key、Base URL、模型名等）
 *   wb:cet6:cards      —— 已生成的记忆卡片缓存（按 word+domain 索引）
 *   wb:cet6:selections —— 用户勾选的关联词（按领域）
 *   wb:cet6:history    —— 复习答题历史
 *   wb:cet6:progress   —— 复习进度与会话状态
 *   wb:cet6:ui         —— UI 偏好（当前领域、主题版本等）
 * ============================================================================
 */

const NS = 'wb:cet6';
const VERSION = 1;

const KEYS = {
  settings: `${NS}:settings`,
  cards: `${NS}:cards`,
  selections: `${NS}:selections`,
  history: `${NS}:history`,
  progress: `${NS}:progress`,
  ui: `${NS}:ui`,
  // ---- 新增（本轮增量）----
  favorites: `${NS}:favorites`,       // 收藏：{ [domainId::word]: {domainId, word, at} } —— 结构化，便于收藏夹跨领域渲染
  images: `${NS}:images`,             // 图片覆盖（URL）：{ [domainId::word]: "https://..." }（用户手动填写/替换）
  userImages: `${NS}:userImages`,     // 用户上传图（Base64）：{ [domainId::word]: "data:image/png;base64,..." }
  quizStats: `${NS}:quizStats`,       // 做题统计：{ [domainId]: {total, correct, byWord:{}} }
  // ---- 新增（功能一 / 功能二 / 功能三 / 功能四）----
  userDomains: `${NS}:userDomains`,   // 我的库：['hok', 'slay', ...]（用户订阅的领域 id 列表）
  quizSessions: `${NS}:quizSessions`, // 复习分组结果：[{sessionId, startedAt, finishedAt, groupIndex, totalGroups, wordCount, correctCount, wrongCount, words:[...]}]
  masteredWords: `${NS}:masteredWords`, // 熟词库：{ [domainId::word]: {word, domainId, masteredAt} }
  wrongWords: `${NS}:wrongWords`,       // 错题本：{ [domainId::word]: {word, domainId, wrongCount, totalAttempts, lastWrongAt} }
};

/* ---------------------------------------------------------------------------
 * 底层存储适配器
 * 换后端时，把这两个函数替换为服务端请求即可（保持 Promise 语义）。
 * ------------------------------------------------------------------------ */
async function readRaw(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.__v !== undefined && parsed.__v !== VERSION) {
      // 预留：数据结构版本迁移入口
      return migrate(parsed, key);
    }
    return parsed && parsed.data !== undefined ? parsed.data : parsed;
  } catch (e) {
    console.warn('[dataService] 读取失败', key, e);
    return null;
  }
}

async function writeRaw(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ __v: VERSION, data }));
    return true;
  } catch (e) {
    console.warn('[dataService] 写入失败（可能超出配额）', key, e);
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * 按 key 串行化的「读-改-写」事务
 *
 * ⚠️ 为什么必须有这个（修复「收藏夹空白」Bug 的根因）：
 *   早期实现里每个写操作都是独立的 readRaw → 改 → writeRaw。
 *   当用户快速连续点击多张卡片的收藏星标时，N 个 toggleFavorite 并发执行：
 *     请求1 读到 {} → 写 {A}
 *     请求2 读到 {} → 写 {B}     ← 覆盖了 A
 *     请求3 读到 {} → 写 {C}     ← 又覆盖了 B
 *   最终只有最后一个写生效，前面的收藏全部丢失（表现为「收藏夹空白」）。
 *
 *   解决：把「同一个 key 的读-改-写」串成一条 Promise 链，保证互不交错。
 *   换后端时，这把锁依然有效（本地串行化），也可以在服务端用事务替代。
 * ------------------------------------------------------------------------ */
const writeQueues = new Map(); // key -> Promise

/**
 * 原子更新：把同一个 key 的读-改-写排成队列，避免并发覆盖。
 * @param {string} key
 * @param {(current:any) => any} mutator 接收当前值，返回要写入的新值
 * @returns {Promise<any>} 写入后的新值
 */
export function updateRaw(key, mutator) {
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => { /* 前一个任务失败不影响后续 */ })
    .then(async () => {
      const cur = await readRaw(key);
      const updated = mutator(cur);
      await writeRaw(key, updated);
      return updated;
    });
  writeQueues.set(key, next);
  return next;
}

/** 等待所有挂起的写入完成（测试 / 卸载前刷盘用） */
export async function flushWrites() {
  await Promise.all([...writeQueues.values()].map((p) => p.catch(() => {})));
}

/** 结构迁移占位：未来字段变更时在此处理旧数据 */
function migrate(old, key) {
  // 目前无历史结构，直接返回原始数据
  return old && old.data !== undefined ? old.data : old;
}

/** 统一的请求封装占位（最终版接入后端时使用） */
async function request(path, options = {}) {
  // 预设版：不发起任何网络请求，仅供未来替换
  throw new Error(`[dataService] 后端未接入：${path}`);
  // 最终版示例：
  // const res = await fetch(path, {
  //   ...options,
  //   headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  // });
  // if (!res.ok) throw new Error(await res.text());
  // return res.json();
}

/* ---------------------------------------------------------------------------
 * 设置
 * ------------------------------------------------------------------------ */
const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.7,
  customPromptOverride: '', // 用户可覆盖 interestsConfig 中的生成 prompt（全局）
  autoTranslateExample: true,
};

export async function getSettings() {
  const saved = await readRaw(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...(patch || {}) };
  await writeRaw(KEYS.settings, next);
  return next;
}

export async function clearSettings() {
  await writeRaw(KEYS.settings, { ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

/* ---------------------------------------------------------------------------
 * 记忆卡片缓存
 * 结构：{ [cacheKey]: CardMaterial }
 * cacheKey = `${domainId}::${word.toLowerCase()}`
 * ------------------------------------------------------------------------ */
function cardKey(domainId, word) {
  return `${domainId}::${String(word || '').toLowerCase()}`;
}

export async function getCard(domainId, word) {
  const all = (await readRaw(KEYS.cards)) || {};
  return all[cardKey(domainId, word)] || null;
}

export async function getCards(domainId, words) {
  const all = (await readRaw(KEYS.cards)) || {};
  const out = {};
  for (const w of words || []) {
    const k = cardKey(domainId, w);
    if (all[k]) out[w] = all[k];
  }
  return out;
}

export async function getAllCards(domainId) {
  const all = (await readRaw(KEYS.cards)) || {};
  if (!domainId) return all;
  const prefix = `${domainId}::`;
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

export async function saveCard(domainId, word, material) {
  const all = (await readRaw(KEYS.cards)) || {};
  all[cardKey(domainId, word)] = {
    ...material,
    __generatedAt: Date.now(),
    __source: material.__source || 'ai',
  };
  await writeRaw(KEYS.cards, all);
  return all[cardKey(domainId, word)];
}

export async function deleteCard(domainId, word) {
  const all = (await readRaw(KEYS.cards)) || {};
  delete all[cardKey(domainId, word)];
  await writeRaw(KEYS.cards, all);
}

export async function clearCards() {
  await writeRaw(KEYS.cards, {});
}

/* ---------------------------------------------------------------------------
 * 用户勾选的关联词（按领域保存）
 * ------------------------------------------------------------------------ */
export async function getSelection(domainId) {
  const all = (await readRaw(KEYS.selections)) || {};
  return new Set(all[domainId] || []);
}

export async function setSelection(domainId, wordList) {
  const uniq = [...new Set(wordList || [])];
  await updateRaw(KEYS.selections, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    all[domainId] = uniq;
    return all;
  });
  return new Set(uniq);
}

export async function toggleSelection(domainId, word) {
  const cur = await getSelection(domainId);
  if (cur.has(word)) cur.delete(word); else cur.add(word);
  await setSelection(domainId, [...cur]);
  return cur;
}

/* ---------------------------------------------------------------------------
 * 收藏（模块六）
 *
 * 为什么按 domainId::word 存而不是只存 word：
 *   需求规定「同一个单词可以在多个领域下出现，各有独立材料」。
 *   因此收藏的粒度也是「单词 × 领域」——收藏《杀戮尖塔》下的 barrier，
 *   与收藏《空洞骑士》下的 barrier 是两条独立记录。
 *
 * 数据结构（窄表，每条记录自带全部信息，便于跨领域聚合）：
 *   { [ `${domainId}::${word.toLowerCase()}` ]: {
 *       word: string,          // 原样单词
 *       domainId: string,
 *       favoritedAt: number,   // 时间戳（旧字段名 at 仍兼容读取）
 *   } }
 *
 * 全部写操作走 updateRaw() 串行化，避免并发点击时相互覆盖导致丢收藏。
 * ------------------------------------------------------------------------ */

/** 兼容旧数据的读取归一化：把 {domainId, word, at} 统一成 {word, domainId, favoritedAt} */
function normalizeFavorite(raw, fallbackKey) {
  if (!raw || typeof raw !== 'object') return null;
  const word = raw.word || (fallbackKey ? String(fallbackKey).split('::')[1] : '');
  const domainId = raw.domainId || (fallbackKey ? String(fallbackKey).split('::')[0] : '');
  if (!word || !domainId) return null;
  return {
    word: String(word),
    domainId: String(domainId),
    favoritedAt: Number(raw.favoritedAt ?? raw.at ?? 0),
  };
}

/**
 * 【唯一读入口】读取收藏列表 —— 所有「计数」与「渲染」都必须经过这里。
 *
 * ⚠️ 铁律：本函数是**纯读取**，绝不写入 localStorage。
 *    收藏数据的写入只允许发生在用户主动操作时（见 toggleFavorite / setFavorite）。
 *
 * ── 历史 Bug 记录（务必保留，防止回退）──────────────────────────────────
 * Bug A：计数与列表走两条路（已修）
 *   旧实现里，数量来自 getFavoriteKeys() → Object.keys(raw).length（原始键、零校验），
 *   列表来自 getFavorites() → normalizeFavorite() 过滤后。脏数据会让「数字有、列表空」。
 *
 * Bug B：读操作反向写坏数据 —— 症状「一进收藏夹数字就清零、刷新也空」（已修）
 *   曾经为了「顺手修数据」，在读取时把归一化结果回写：
 *       if (dirty) writeRaw(KEYS.favorites, healed)
 *   当整份数据都无法归一化时 healed = {}，于是**一次普通读取就把 localStorage
 *   写成了 `{}`**，收藏全被清空。这与「进入收藏夹页面」的时机完全吻合，故表现为
 *   「点开收藏夹 → 数字清零、内容清空、刷新也空」。
 *   修复：删除读取路径上的所有写入。脏数据一律「只忽略、不修改」。
 *   统计口径统一为：**数量 = 归一化后仍有效的记录条数**。
 * ────────────────────────────────────────────────────────────────────────
 * @returns {Promise<Array<{word:string, domainId:string, favoritedAt:number, key:string}>>}
 */
async function readFavoriteList() {
  const all = (await readRaw(KEYS.favorites)) || {};
  if (!all || typeof all !== 'object') return [];

  const list = [];
  for (const [k, v] of Object.entries(all)) {
    const norm = normalizeFavorite(v, k);
    if (!norm) continue; // 脏数据：忽略，但【绝不写回】
    list.push({ ...norm, key: cardKey(norm.domainId, norm.word) });
  }
  // 最近收藏的排前面
  return list.sort((a, b) => b.favoritedAt - a.favoritedAt);
}

/**
 * 收藏的稳定标识键列表（`domainId::word`）。
 * ⚠️ 这里返回的是「归一化后」的键，不再直接返回 localStorage 的原始键，
 * 以保证与 getFavorites() 的条数严格一致（问题三修复点）。
 */
export async function getFavoriteKeys() {
  const list = await readFavoriteList();
  return list.map((f) => f.key);
}

/** @returns {Promise<Array<{word:string, domainId:string, favoritedAt:number}>>} */
export async function getFavorites(domainId) {
  const list = await readFavoriteList();
  const filtered = domainId ? list.filter((f) => f.domainId === domainId) : list;
  // 去掉内部使用的 key 字段，保持对外结构干净
  return filtered.map(({ word, domainId: d, favoritedAt }) => ({ word, domainId: d, favoritedAt }));
}

/** 去重后的收藏单词集合（跨领域） */
export async function getAllFavoriteWords() {
  const list = await getFavorites();
  return [...new Set(list.map((f) => f.word))];
}

export async function isFavorite(domainId, word) {
  if (!domainId || !word) return false;
  const list = await readFavoriteList();
  const target = cardKey(domainId, word);
  return list.some((f) => f.key === target);
}

/**
 * 把「原始收藏表」规范化为规范结构（纯函数，不写存储）。
 * 仅可归一化的记录会被保留；脏数据一律丢弃。
 * 供写入路径（用户主动操作）复用，绝不在读取路径调用后回写。
 */
function canonicalizeFavorites(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const norm = normalizeFavorite(v, k);
    if (!norm) continue; // 无法归一化 → 丢弃
    out[cardKey(norm.domainId, norm.word)] = {
      word: norm.word,
      domainId: norm.domainId,
      favoritedAt: norm.favoritedAt,
    };
  }
  return out;
}

/**
 * 切换收藏状态（原子，串行化）
 *
 * ⚠️ 写入只在此类「用户主动操作」的 API 里发生；读取 API 永不写入。
 * 顺带做一次安全迁移：把历史遗留的脏记录规范化（此操作同样只在用户主动
 * 收藏/取消收藏时发生，且走 updateRaw 串行队列，不会与并发写入互相覆盖）。
 * @returns {Promise<boolean>} 切换后的状态（true = 已收藏）
 */
export async function toggleFavorite(domainId, word, meta = {}) {
  if (!domainId || !word) return false;
  const k = cardKey(domainId, word);
  let next = false;
  await updateRaw(KEYS.favorites, (cur) => {
    // 先规范化历史数据，再执行本次操作（串行队列内，安全）
    const all = canonicalizeFavorites(cur);
    if (all[k]) {
      delete all[k];
      next = false;
    } else {
      all[k] = {
        word: String(word),
        domainId: String(domainId),
        favoritedAt: Date.now(),
        ...meta,
      };
      next = true;
    }
    return all;
  });
  return next;
}

/**
 * 显式设置收藏状态（幂等，供「批量收藏」「导入」等场景使用）
 * 与 toggleFavorite 的区别：不会因为当前状态不同而反向操作。
 * 同 toggleFavorite：只由用户主动操作触发，读取路径不会调用。
 */
export async function setFavorite(domainId, word, on, meta = {}) {
  if (!domainId || !word) return false;
  const k = cardKey(domainId, word);
  await updateRaw(KEYS.favorites, (cur) => {
    const all = canonicalizeFavorites(cur);
    if (on) {
      all[k] = { word: String(word), domainId: String(domainId), favoritedAt: Date.now(), ...meta };
    } else {
      delete all[k];
    }
    return all;
  });
  return Boolean(on);
}

/**
 * 清空收藏。
 * ⚠️ 这是**破坏性**操作，只能由用户显式点击「清空收藏」触发；
 *    绝不可在页面进入 / 初始化时调用。
 * @param {string} [domainId] 传入则只清该领域；不传则清空全部。
 */
export async function clearFavorites(domainId) {
  if (!domainId) return updateRaw(KEYS.favorites, () => ({}));
  const prefix = `${domainId}::`;
  await updateRaw(KEYS.favorites, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    for (const k of Object.keys(all)) if (k.startsWith(prefix)) delete all[k];
    return all;
  });
}

/* ---------------------------------------------------------------------------
 * 卡片配图覆盖（模块三）
 *
 * 领域材料文件里的 imageUrl 是「预置默认图」；
 * 用户可在详情页手动填入/替换图片 URL，覆盖值存在这里（本机、按 单词×领域 隔离）。
 * 未来做图片上传时，只需把这里的值换成 storage 返回的 URL 即可，结构不变。
 * ------------------------------------------------------------------------ */
export async function getImageOverride(domainId, word) {
  const all = (await readRaw(KEYS.images)) || {};
  return all[cardKey(domainId, word)] || '';
}

export async function getAllImageOverrides(domainId) {
  const all = (await readRaw(KEYS.images)) || {};
  if (!domainId) return all;
  const prefix = `${domainId}::`;
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

/** 传空字符串表示「清除覆盖，回到预置图」 */
export async function setImageOverride(domainId, word, imageUrl) {
  const k = cardKey(domainId, word);
  let result = '';
  await updateRaw(KEYS.images, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    if (imageUrl) {
      all[k] = String(imageUrl).trim();
      result = all[k];
    } else {
      delete all[k];
      result = '';
    }
    return all;
  });
  return result;
}

/* ---------------------------------------------------------------------------
 * 用户上传配图（Base64）—— 与上面的「URL 覆盖」分表存放
 *
 * 为什么不复用 KEYS.images：
 *   images 存的是「短 URL」，userImages 存的是「Base64 长字符串」（单张可达数百 KB）。
 *   两者体积差 3~4 个数量级，混在一起会让 exportAll() 的备份文件、估算用量、
 *   以及任何一次读写整个表都变得昂贵。分表后：
 *     - 读取 URL 覆盖依然只读一张很小的表；
 *     - 用户上传的图可以单独清理（clearUserImages）而不影响用户手填的 URL。
 *
 * 存储结构：{ [domainId::word]: "data:image/png;base64,...." }
 * 键与收藏 / 熟词库 / 错题本共用同一套 cardKey 约定，可直接对齐。
 *
 * ⚠️ 读函数不含任何写操作（遵守「读路径零写入」铁律）。
 * ------------------------------------------------------------------------ */

/** 取某词的用户上传图（无则返回空串） */
export async function getUserImage(domainId, word) {
  const all = (await readRaw(KEYS.userImages)) || {};
  return all[cardKey(domainId, word)] || '';
}

/** 取某领域全部用户上传图：{ [word]: dataUrl } */
export async function getAllUserImages(domainId) {
  const all = (await readRaw(KEYS.userImages)) || {};
  if (!domainId) return all;
  const prefix = `${domainId}::`;
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

/** 该领域用户上传图数量 */
export async function getUserImageCount(domainId) {
  const all = await getAllUserImages(domainId);
  return Object.keys(all).length;
}

/**
 * 写入用户上传图。传空字符串 = 删除该词的上传图（回到 JSON 预置图）。
 * @param {string} domainId
 * @param {string} word
 * @param {string} dataUrl 形如 "data:image/png;base64,..."
 * @returns {Promise<boolean>} 是否写入成功（超出 localStorage 配额会返回 false）
 */
export async function setUserImage(domainId, word, dataUrl) {
  const k = cardKey(domainId, word);
  if (!k || k === '::') return false;
  if (!dataUrl) return removeUserImage(domainId, word);

  await updateRaw(KEYS.userImages, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    all[k] = String(dataUrl);
    return all;
  });
  // updateRaw 内部吞掉了 writeRaw 的失败，这里回读一次确认真的落盘了
  const check = await getUserImage(domainId, word);
  return Boolean(check);
}

/** 删除某词的上传图 */
export async function removeUserImage(domainId, word) {
  const k = cardKey(domainId, word);
  await updateRaw(KEYS.userImages, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    delete all[k];
    return all;
  });
  return true;
}

/** 清空上传图（传 domainId 只清该领域） */
export async function clearUserImages(domainId) {
  if (!domainId) return updateRaw(KEYS.userImages, () => ({}));
  const prefix = `${domainId}::`;
  await updateRaw(KEYS.userImages, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    for (const k of Object.keys(all)) if (k.startsWith(prefix)) delete all[k];
    return all;
  });
  return true;
}

/** 上传图总体积（字节估算，供 UI 提示） */
export async function getUserImagesSize() {
  const all = (await readRaw(KEYS.userImages)) || {};
  let chars = 0;
  for (const v of Object.values(all)) chars += String(v || '').length;
  return { count: Object.keys(all).length, bytes: chars * 2 };
}

/* ---------------------------------------------------------------------------
 * 做题统计（模块五）
 * 与 history 分开存：history 记录每一次作答明细，quizStats 只存聚合数字。
 * 写操作走 updateRaw 串行化，避免连续答题时统计丢失。
 * ------------------------------------------------------------------------ */
export async function getQuizStats(domainId) {
  const all = (await readRaw(KEYS.quizStats)) || {};
  if (!domainId) return all;
  return all[domainId] || { total: 0, correct: 0, byWord: {} };
}

export async function recordQuizResult(domainId, word, correct) {
  let result;
  await updateRaw(KEYS.quizStats, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    const c = all[domainId] || { total: 0, correct: 0, byWord: {} };
    const next = { total: c.total + 1, correct: c.correct + (correct ? 1 : 0), byWord: { ...(c.byWord || {}) } };
    const bw = next.byWord[word] || { total: 0, correct: 0, lastAt: 0 };
    next.byWord[word] = { total: bw.total + 1, correct: bw.correct + (correct ? 1 : 0), lastAt: Date.now() };
    all[domainId] = next;
    result = next;
    return all;
  });
  return result;
}

export async function clearQuizStats(domainId) {
  if (!domainId) return updateRaw(KEYS.quizStats, () => ({}));
  await updateRaw(KEYS.quizStats, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    delete all[domainId];
    return all;
  });
}

/* ---------------------------------------------------------------------------
 * 复习答题历史
 * 结构：{ domainId: [ {word, answer, correct, expected, at} ] }
 * ------------------------------------------------------------------------ */
export async function getHistory(domainId) {
  const all = (await readRaw(KEYS.history)) || {};
  if (!domainId) return all;
  return all[domainId] || [];
}

export async function appendHistory(domainId, record) {
  let result = [];
  await updateRaw(KEYS.history, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    const list = Array.isArray(all[domainId]) ? all[domainId].slice() : [];
    list.push({ ...record, at: record.at || Date.now() });
    // 只保留最近 2000 条，避免无限膨胀
    all[domainId] = list.slice(-2000);
    result = all[domainId];
    return all;
  });
  return result;
}

export async function clearHistory(domainId) {
  if (!domainId) return updateRaw(KEYS.history, () => ({}));
  await updateRaw(KEYS.history, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    delete all[domainId];
    return all;
  });
}

/** 答题统计（可扩展为按艾宾浩斯曲线排程） */
export async function getHistoryStats(domainId) {
  const list = await getHistory(domainId);
  const total = list.length;
  const correct = list.filter((r) => r.correct).length;
  const byWord = new Map();
  for (const r of list) {
    const cur = byWord.get(r.word) || { word: r.word, total: 0, correct: 0, lastAt: 0 };
    cur.total += 1;
    if (r.correct) cur.correct += 1;
    cur.lastAt = Math.max(cur.lastAt, r.at || 0);
    byWord.set(r.word, cur);
  }
  return {
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? correct / total : 0,
    byWord: [...byWord.values()],
  };
}

/* ---------------------------------------------------------------------------
 * 复习进度 / 会话状态
 * ------------------------------------------------------------------------ */
export async function getProgress(domainId) {
  const all = (await readRaw(KEYS.progress)) || {};
  return all[domainId] || { index: 0, order: [], startedAt: 0 };
}

export async function saveProgress(domainId, progress) {
  let result;
  await updateRaw(KEYS.progress, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    all[domainId] = { ...(all[domainId] || {}), ...progress };
    result = all[domainId];
    return all;
  });
  return result;
}

export async function resetProgress(domainId) {
  await updateRaw(KEYS.progress, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    all[domainId] = { index: 0, order: [], startedAt: Date.now() };
    return all;
  });
}

/* ---------------------------------------------------------------------------
 * UI 偏好（领域选择、视图模式、是否隐藏已掌握等）
 * ------------------------------------------------------------------------ */
const DEFAULT_UI = {
  domainId: null,
  view: 'grid',          // grid | list
  sortBy: 'relevance',   // relevance | alpha
  filterLevel: 'all',    // all | exact | vocab
  showMastered: true,
  themeIntensity: 1,
};

export async function getUI() {
  const saved = await readRaw(KEYS.ui);
  return { ...DEFAULT_UI, ...(saved || {}) };
}

export async function saveUI(patch) {
  const cur = await getUI();
  const next = { ...cur, ...(patch || {}) };
  await writeRaw(KEYS.ui, next);
  return next;
}

/* ---------------------------------------------------------------------------
 * 功能一：我的库（用户订阅的兴趣领域）
 *
 * 需求：首次进入让用户勾选感兴趣的领域；之后只有「我的库」里的领域
 *      才会出现在卡片库与筛选中，且可随时增删。
 *
 * 数据结构：string[]（领域 id 的有序去重数组）
 *   ['honor_of_kings', 'hollow_knight', ...]
 *
 * 约定：数组为空表示「用户还没选过」→ 由页面引导去选（不是「选了 0 个」）。
 * ------------------------------------------------------------------------ */

/** 读取「我的库」领域 id 列表（纯读取，返回副本，调用方可安全修改） */
export async function getUserDomains() {
  const saved = await readRaw(KEYS.userDomains);
  if (!Array.isArray(saved)) return [];
  return [...new Set(saved.filter((id) => typeof id === 'string' && id))];
}

/**
 * 覆盖式设置「我的库」（幂等）。
 * @param {string[]} domainIds
 * @returns {Promise<string[]>}
 */
export async function setUserDomains(domainIds) {
  const uniq = [...new Set((domainIds || []).filter((id) => typeof id === 'string' && id))];
  await writeRaw(KEYS.userDomains, uniq);
  return uniq;
}

/** 追加一个领域到「我的库」（已存在则原样返回，不重复、不报错） */
export async function addUserDomain(domainId) {
  if (!domainId) return getUserDomains();
  let result = [];
  await updateRaw(KEYS.userDomains, (cur) => {
    const list = Array.isArray(cur) ? cur.filter((id) => typeof id === 'string' && id) : [];
    if (!list.includes(domainId)) list.push(domainId);
    result = [...new Set(list)];
    return result;
  });
  return result;
}

/** 从「我的库」移除一个领域（不存在则原样返回） */
export async function removeUserDomain(domainId) {
  if (!domainId) return getUserDomains();
  let result = [];
  await updateRaw(KEYS.userDomains, (cur) => {
    const list = Array.isArray(cur) ? cur.filter((id) => typeof id === 'string' && id) : [];
    result = list.filter((id) => id !== domainId);
    return result;
  });
  return result;
}

/* ---------------------------------------------------------------------------
 * 功能三：熟词库（标记为已掌握）
 *
 * 粒度同收藏：单词 × 领域。结构与收藏保持一致（窄表 + 规范化），
 * 这样「读取路径绝不写入」的铁律与并发串行化都直接复用。
 *   { [domainId::word]: { word, domainId, masteredAt } }
 * ------------------------------------------------------------------------ */

/** 兼容归一化：{word, domainId, masteredAt|at} → 规范结构 */
function normalizeMastered(raw, fallbackKey) {
  if (!raw || typeof raw !== 'object') return null;
  const word = raw.word || (fallbackKey ? String(fallbackKey).split('::')[1] : '');
  const domainId = raw.domainId || (fallbackKey ? String(fallbackKey).split('::')[0] : '');
  if (!word || !domainId) return null;
  return {
    word: String(word),
    domainId: String(domainId),
    masteredAt: Number(raw.masteredAt ?? raw.at ?? 0),
  };
}

/** 规范化熟词表（纯函数，供写入路径复用） */
function canonicalizeMastered(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const norm = normalizeMastered(v, k);
    if (!norm) continue;
    out[cardKey(norm.domainId, norm.word)] = norm;
  }
  return out;
}

/** 【纯读取】熟词列表，按掌握时间倒序 */
async function readMasteredList() {
  const all = (await readRaw(KEYS.masteredWords)) || {};
  if (!all || typeof all !== 'object') return [];
  const list = [];
  for (const [k, v] of Object.entries(all)) {
    const norm = normalizeMastered(v, k);
    if (!norm) continue; // 脏数据：忽略，绝不写回
    list.push({ ...norm, key: cardKey(norm.domainId, norm.word) });
  }
  return list.sort((a, b) => b.masteredAt - a.masteredAt);
}

/** @returns {Promise<Array<{word:string, domainId:string, masteredAt:number}>>} */
export async function getMasteredWords(domainId) {
  const list = await readMasteredList();
  const filtered = domainId ? list.filter((m) => m.domainId === domainId) : list;
  return filtered.map(({ word, domainId: d, masteredAt }) => ({ word, domainId: d, masteredAt }));
}

/** 熟词的稳定键列表（domainId::word），用于卡片快速比对 */
export async function getMasteredKeys() {
  const list = await readMasteredList();
  return list.map((m) => m.key);
}

/** 去重后的熟词集合（跨领域） */
export async function getAllMasteredWords() {
  const list = await getMasteredWords();
  return [...new Set(list.map((m) => m.word))];
}

/** @returns {Promise<number>} 已掌握数量（可按领域过滤） */
export async function getMasteredCount(domainId) {
  const list = await getMasteredWords(domainId);
  return list.length;
}

export async function isMastered(domainId, word) {
  if (!domainId || !word) return false;
  const list = await readMasteredList();
  const target = cardKey(domainId, word);
  return list.some((m) => m.key === target);
}

/**
 * 切换「熟词」标记（原子，串行化）。
 * @returns {Promise<boolean>} 切换后的状态（true = 已掌握）
 */
export async function toggleMastered(domainId, word) {
  if (!domainId || !word) return false;
  const k = cardKey(domainId, word);
  let next = false;
  await updateRaw(KEYS.masteredWords, (cur) => {
    const all = canonicalizeMastered(cur);
    if (all[k]) {
      delete all[k];
      next = false;
    } else {
      all[k] = { word: String(word), domainId: String(domainId), masteredAt: Date.now() };
      next = true;
    }
    return all;
  });
  return next;
}

/** 显式设置熟词状态（幂等） */
export async function setMastered(domainId, word, on) {
  if (!domainId || !word) return false;
  const k = cardKey(domainId, word);
  await updateRaw(KEYS.masteredWords, (cur) => {
    const all = canonicalizeMastered(cur);
    if (on) all[k] = { word: String(word), domainId: String(domainId), masteredAt: Date.now() };
    else delete all[k];
    return all;
  });
  return Boolean(on);
}

/** 移出一个熟词标记（供熟词列表页「取消掌握」） */
export async function removeMastered(domainId, word) {
  return setMastered(domainId, word, false);
}

/** 清空熟词库（破坏性，仅用户显式操作时调用） */
export async function clearMastered(domainId) {
  if (!domainId) return updateRaw(KEYS.masteredWords, () => ({}));
  const prefix = `${domainId}::`;
  await updateRaw(KEYS.masteredWords, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    for (const k of Object.keys(all)) if (k.startsWith(prefix)) delete all[k];
    return all;
  });
}

/* ---------------------------------------------------------------------------
 * 功能四：错题本与错误统计
 *
 *   { [domainId::word]: { word, domainId, wrongCount, totalAttempts, lastWrongAt } }
 *
 * 关键：**每一次作答**（无论对错）都要更新 totalAttempts，
 *       只有答错才累加 wrongCount —— 这样「错误率 = wrongCount / totalAttempts」
 *       才有意义（答对会稀释错误率）。
 * ------------------------------------------------------------------------ */

function normalizeWrong(raw, fallbackKey) {
  if (!raw || typeof raw !== 'object') return null;
  const word = raw.word || (fallbackKey ? String(fallbackKey).split('::')[1] : '');
  const domainId = raw.domainId || (fallbackKey ? String(fallbackKey).split('::')[0] : '');
  if (!word || !domainId) return null;
  const wrongCount = Number(raw.wrongCount ?? 0) || 0;
  const totalAttempts = Number(raw.totalAttempts ?? wrongCount) || 0;
  return {
    word: String(word),
    domainId: String(domainId),
    wrongCount: Math.max(0, wrongCount),
    totalAttempts: Math.max(0, totalAttempts),
    // 连续答对计数 —— 必须保留，否则「答对 3 次自动移出」永远无法触发
    correctStreak: Math.max(0, Number(raw.correctStreak ?? 0) || 0),
    lastWrongAt: Number(raw.lastWrongAt ?? raw.at ?? 0),
    lastAt: Number(raw.lastAt ?? raw.lastWrongAt ?? raw.at ?? 0),
  };
}

function canonicalizeWrong(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const norm = normalizeWrong(v, k);
    if (!norm) continue;
    out[cardKey(norm.domainId, norm.word)] = norm;
  }
  return out;
}

/** 错误率（0~1）；totalAttempts 为 0 时按 0 处理 */
export function errorRatio(rec) {
  const t = Number(rec && rec.totalAttempts) || 0;
  if (t <= 0) return 0;
  return Math.min(1, (Number(rec && rec.wrongCount) || 0) / t);
}

/** 【纯读取】错题列表，默认按错误率降序（同率则错得多、错得近的排前） */
async function readWrongList() {
  const all = (await readRaw(KEYS.wrongWords)) || {};
  if (!all || typeof all !== 'object') return [];
  const list = [];
  for (const [k, v] of Object.entries(all)) {
    const norm = normalizeWrong(v, k);
    if (!norm) continue; // 脏数据：忽略，绝不写回
    list.push({ ...norm, key: cardKey(norm.domainId, norm.word), ratio: errorRatio(norm) });
  }
  return list.sort((a, b) => b.ratio - a.ratio
    || b.wrongCount - a.wrongCount
    || b.lastWrongAt - a.lastWrongAt);
}

/**
 * @param {string} [domainId] 传入则只取该领域
 * @returns {Promise<Array<{word, domainId, wrongCount, totalAttempts, lastWrongAt, ratio}>>}
 */
export async function getWrongWords(domainId) {
  const list = await readWrongList();
  const filtered = domainId ? list.filter((w) => w.domainId === domainId) : list;
  return filtered.map(({ word, domainId: d, wrongCount, totalAttempts, lastWrongAt, ratio }) => ({
    word, domainId: d, wrongCount, totalAttempts, lastWrongAt, ratio,
  }));
}

export async function getWrongCount(domainId) {
  const list = await readWrongList();
  const filtered = domainId ? list.filter((w) => w.domainId === domainId) : list;
  return filtered.length;
}

/** 是否在错题本里 */
export async function isWrongWord(domainId, word) {
  if (!domainId || !word) return false;
  const all = (await readRaw(KEYS.wrongWords)) || {};
  return Boolean(all[cardKey(domainId, word)]);
}

/** 单条错题记录（详情/卡片用），不存在返回 null */
export async function getWrongRecord(domainId, word) {
  if (!domainId || !word) return null;
  const all = (await readRaw(KEYS.wrongWords)) || {};
  const norm = normalizeWrong(all[cardKey(domainId, word)], cardKey(domainId, word));
  if (!norm) return null;
  return { ...norm, ratio: errorRatio(norm) };
}

/**
 * 【核心写入】记录一次作答（对/错都会调用）。
 *
 * 行为：
 *   - totalAttempts += 1（无论对错）
 *   - 答错：wrongCount += 1，记入/留在错题本，更新 lastWrongAt
 *   - 答对：若该词已在错题本 → 只增加 totalAttempts（稀释错误率）；
 *          若答对后「已连续答对 >= 3 次」则自动移出错题本（需求：答对 3 次可移出）
 *   - 从未答错的词不会因为答对而进入错题本（避免污染）
 *
 * @param {string} domainId
 * @param {string} word
 * @param {boolean} correct
 * @param {{autoRemoveAfter?:number}} [opts]
 * @returns {Promise<{record:object|null, removed:boolean}>}
 */
export async function recordAnswer(domainId, word, correct, opts = {}) {
  if (!domainId || !word) return { record: null, removed: false };
  const autoRemoveAfter = Number.isFinite(opts.autoRemoveAfter) ? opts.autoRemoveAfter : 3;
  const k = cardKey(domainId, word);
  let record = null;
  let removed = false;

  await updateRaw(KEYS.wrongWords, (cur) => {
    const all = canonicalizeWrong(cur);
    const prev = all[k];

    if (!prev) {
      // 不在错题本：只有答错才建立记录
      if (!correct) {
        all[k] = {
          word: String(word),
          domainId: String(domainId),
          wrongCount: 1,
          totalAttempts: 1,
          correctStreak: 0,
          lastWrongAt: Date.now(),
          lastAt: Date.now(),
        };
        record = all[k];
      }
      return all;
    }

    const next = {
      ...prev,
      totalAttempts: prev.totalAttempts + 1,
      lastAt: Date.now(),
    };
    if (correct) {
      next.correctStreak = (Number(prev.correctStreak) || 0) + 1;
      // 连续答对达标 → 自动移出错题本（需求：答对 3 次后可移出）
      if (next.correctStreak >= autoRemoveAfter) {
        delete all[k];
        removed = true;
        record = next;
        return all;
      }
    } else {
      next.wrongCount = prev.wrongCount + 1;
      next.correctStreak = 0;
      next.lastWrongAt = Date.now();
    }
    all[k] = next;
    record = next;
    return all;
  });

  return { record, removed };
}

/**
 * 显式移出错题本（供错题本页面「移除」按钮）。
 * @returns {Promise<boolean>} true = 原本存在并被移除
 */
export async function removeFromWrongWords(domainId, word) {
  if (!domainId || !word) return false;
  const k = cardKey(domainId, word);
  let existed = false;
  await updateRaw(KEYS.wrongWords, (cur) => {
    const all = canonicalizeWrong(cur);
    if (all[k]) {
      delete all[k];
      existed = true;
    }
    return all;
  });
  return existed;
}

/** 清空错题本（破坏性，仅用户显式操作时调用） */
export async function clearWrongWords(domainId) {
  if (!domainId) return updateRaw(KEYS.wrongWords, () => ({}));
  const prefix = `${domainId}::`;
  await updateRaw(KEYS.wrongWords, (cur) => {
    const all = cur && typeof cur === 'object' ? { ...cur } : {};
    for (const k of Object.keys(all)) if (k.startsWith(prefix)) delete all[k];
    return all;
  });
}

/* ---------------------------------------------------------------------------
 * 功能二：复习分组会话记录
 *
 * 数组，每完成一组追加一条：
 *   { sessionId, startedAt, finishedAt, groupIndex, totalGroups,
 *     wordCount, correctCount, wrongCount, words: [{word, domainId, correct}] }
 *
 * groupIndex 从 1 开始；同一次复习的所有组共享 sessionId，
 * 便于后续做「本次复习整体正确率」的聚合。
 * ------------------------------------------------------------------------ */

/** 生成会话 id（时间戳 + 随机后缀，够用且无需依赖 crypto） */
export function newSessionId() {
  return `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 读取复习会话记录。
 * @param {{sessionId?:string, limit?:number}} [opts] 可按会话过滤；limit 取最近 N 条
 */
export async function getQuizSessions(opts = {}) {
  const all = await readRaw(KEYS.quizSessions);
  const list = Array.isArray(all) ? all.filter((s) => s && typeof s === 'object') : [];
  const sorted = list.slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  let out = sorted;
  if (opts.sessionId) out = out.filter((s) => s.sessionId === opts.sessionId);
  if (opts.limit) out = out.slice(-opts.limit);
  return out;
}

/**
 * 追加一条分组结果（原子）。
 * 会自动补全 finishedAt / wordCount / correctCount / wrongCount。
 * @returns {Promise<object>} 落盘后的记录
 */
export async function saveQuizSession(session) {
  const words = Array.isArray(session && session.words) ? session.words : [];
  const correctCount = words.filter((w) => w && w.correct).length;
  const record = {
    sessionId: String((session && session.sessionId) || newSessionId()),
    startedAt: Number((session && session.startedAt) || Date.now()),
    finishedAt: Number((session && session.finishedAt) || Date.now()),
    groupIndex: Number((session && session.groupIndex) || 1),
    totalGroups: Number((session && session.totalGroups) || 1),
    wordCount: Number((session && session.wordCount) || words.length),
    correctCount,
    wrongCount: words.length - correctCount,
    words: words.map((w) => ({
      word: String((w && w.word) || ''),
      domainId: String((w && w.domainId) || ''),
      correct: Boolean(w && w.correct),
    })),
  };

  let saved = record;
  await updateRaw(KEYS.quizSessions, (cur) => {
    const list = Array.isArray(cur) ? cur.filter((s) => s && typeof s === 'object') : [];
    list.push(record);
    // 只保留最近 500 条分组记录，避免无限膨胀
    return list.slice(-500);
  });
  return saved;
}

/** 清空复习会话记录（破坏性） */
export async function clearQuizSessions() {
  await writeRaw(KEYS.quizSessions, []);
}

/** 聚合统计：某次会话 / 全部会话的累计表现（供错题本或统计面板使用） */
export async function getQuizSessionSummary(sessionId) {
  const list = await getQuizSessions(sessionId ? { sessionId } : {});
  const total = list.reduce((n, s) => n + (Number(s.wordCount) || 0), 0);
  const correct = list.reduce((n, s) => n + (Number(s.correctCount) || 0), 0);
  return {
    sessions: list.length,
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? correct / total : 0,
  };
}

/* ---------------------------------------------------------------------------
 * 导出 / 导入全部本地数据（便于用户备份，也是未来「分享」的基础）
 * ------------------------------------------------------------------------ */
export async function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    version: VERSION,
    settings: await getSettings(),
    cards: await readRaw(KEYS.cards) || {},
    selections: await readRaw(KEYS.selections) || {},
    history: await readRaw(KEYS.history) || {},
    progress: await readRaw(KEYS.progress) || {},
    ui: await getUI(),
    // ---- 本轮新增 ----
    favorites: await readRaw(KEYS.favorites) || {},
    images: await readRaw(KEYS.images) || {},
    userImages: await readRaw(KEYS.userImages) || {},
    quizStats: await readRaw(KEYS.quizStats) || {},
    // ---- 新增（功能一 / 二 / 三 / 四）----
    userDomains: await readRaw(KEYS.userDomains) || [],
    quizSessions: await readRaw(KEYS.quizSessions) || [],
    masteredWords: await readRaw(KEYS.masteredWords) || {},
    wrongWords: await readRaw(KEYS.wrongWords) || {},
  };
}

export async function importAll(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('无效的备份数据');
  if (payload.settings) await writeRaw(KEYS.settings, { ...DEFAULT_SETTINGS, ...payload.settings });
  if (payload.cards) await writeRaw(KEYS.cards, payload.cards);
  if (payload.selections) await writeRaw(KEYS.selections, payload.selections);
  if (payload.history) await writeRaw(KEYS.history, payload.history);
  if (payload.progress) await writeRaw(KEYS.progress, payload.progress);
  if (payload.ui) await writeRaw(KEYS.ui, { ...DEFAULT_UI, ...payload.ui });
  // ---- 本轮新增（旧备份没有这些字段，跳过即可，保持向后兼容）----
  if (payload.favorites) await writeRaw(KEYS.favorites, payload.favorites);
  if (payload.images) await writeRaw(KEYS.images, payload.images);
  if (payload.userImages) await writeRaw(KEYS.userImages, payload.userImages);
  if (payload.quizStats) await writeRaw(KEYS.quizStats, payload.quizStats);
  // ---- 新增（功能一 / 二 / 三 / 四）----
  if (payload.userDomains) await writeRaw(KEYS.userDomains, payload.userDomains);
  if (payload.quizSessions) await writeRaw(KEYS.quizSessions, payload.quizSessions);
  if (payload.masteredWords) await writeRaw(KEYS.masteredWords, payload.masteredWords);
  if (payload.wrongWords) await writeRaw(KEYS.wrongWords, payload.wrongWords);
}

export async function clearAll() {
  for (const k of Object.values(KEYS)) {
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  }
}

/** 估算占用体积（用于设置页显示） */
export function estimateUsage() {
  let bytes = 0;
  for (const k of Object.values(KEYS)) {
    try {
      const v = localStorage.getItem(k);
      if (v) bytes += v.length * 2; // UTF-16
    } catch (e) { /* ignore */ }
  }
  return bytes;
}

/* ---------------------------------------------------------------------------
 * 未来分享能力占位（最终版）
 * ------------------------------------------------------------------------ */
export async function shareResource(type, payload) {
  return request(`/api/share/${type}`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchShared(token) {
  return request(`/api/share/${token}`);
}

export default {
  getSettings, saveSettings, clearSettings,
  getCard, getCards, getAllCards, saveCard, deleteCard, clearCards,
  getSelection, setSelection, toggleSelection,
  getHistory, appendHistory, clearHistory, getHistoryStats,
  getProgress, saveProgress, resetProgress,
  getUI, saveUI,
  // 收藏（模块六）
  getFavoriteKeys, getFavorites, getAllFavoriteWords, isFavorite,
  toggleFavorite, setFavorite, clearFavorites,
  // 配图覆盖（模块三）
  getImageOverride, getAllImageOverrides, setImageOverride,
  // 用户上传配图 Base64（本轮：卡片配图标准）
  getUserImage, getAllUserImages, getUserImageCount,
  setUserImage, removeUserImage, clearUserImages, getUserImagesSize,
  // 做题统计（模块五）
  getQuizStats, recordQuizResult, clearQuizStats,
  // 我的库 / 兴趣领域订阅（功能一）
  getUserDomains, setUserDomains, addUserDomain, removeUserDomain,
  // 熟词库（功能三）
  getMasteredWords, getMasteredKeys, getAllMasteredWords, getMasteredCount,
  isMastered, toggleMastered, setMastered, removeMastered, clearMastered,
  // 错题本与错误统计（功能四）
  getWrongWords, getWrongCount, isWrongWord, getWrongRecord,
  recordAnswer, removeFromWrongWords, clearWrongWords, errorRatio,
  // 复习分组会话（功能二）
  getQuizSessions, saveQuizSession, clearQuizSessions,
  getQuizSessionSummary, newSessionId,
  // 低层（供其他 service / 测试使用）
  updateRaw, flushWrites,
  exportAll, importAll, clearAll, estimateUsage,
  shareResource, fetchShared,
  DEFAULT_SETTINGS, DEFAULT_UI,
};
