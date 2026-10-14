/**
 * domainMaterialService.js
 * ============================================================================
 * 预生成记忆材料服务层（模块一：静态数据化 —— 运行时零 AI 调用）
 *
 * 背景变更（本轮增量）：
 *   旧版在用户点击卡片时调用 AI 实时生成材料；新版本改为「全部预先写好、
 *   以 JSON 内置」。因此：
 *     ✅ 打开网页即可浏览，不需要 API Key，不需要等待，不需要网络请求（除加载 JSON）
 *     ❌ 运行时永不调用任何 AI 接口
 *
 * 数据组织：按领域分文件
 *   src/data/domainMaterials/slayTheSpire.json
 *   src/data/domainMaterials/hollowKnight.json
 *
 * 结构：
 *   {
 *     domainId, domainName, materials: {
 *       [word]: { root, generalMeaning, domainMeaning, story, example, exampleZh,
 *                 imageUrl, source, unverified }
 *     }
 *   }
 *
 * 最终版演进路径（只改本文件）：
 *   1. 新增领域 → 用 AI 批量预生成一次，存成同名 JSON，并在
 *      wordBankService.MATERIAL_FILES 里加一行映射；本文件无需改动。
 *   2. 换后端 → 把 loadDomainFile() 里的 fetch 改为请求接口，返回结构不变。
 *   3. 材料版本迁移 → 在 normalizeMaterial() 里做字段补齐与升级。
 *
 * 对外接口：
 *   - getMaterial(domainId, word)          单条材料（不含用户图片覆盖）
 *   - getMaterialWithImage(domainId, word) 单条材料 + 图片解析（当前恒为空串）
 *   - getMaterials(domainId)               该领域全部材料
 *   - hasMaterial(domainId, word)
 *   - resolveImage(domainId, word, mat)    计算最终展示图（二级优先级，无随机图）
 *   - getMaterialStats(domainId)           覆盖率统计
 *   - auditExamples([domainId])            审计：逐条检查是否带 example
 *   - preload(domainId) / preloadAll()     预热（载入时自动校验 example）
 *
 * ============================================================================
 * ★ 配图状态说明（图片功能已移除）★
 * ============================================================================
 *
 * 【一、数据层面】
 *   data/domainMaterials/*.json 每条词条仍保留 imageUrl 字段（统一为 ""），
 *   作为占位保留。以后若要重新启用配图，只需往 JSON 里填链接即可，无需改结构。
 *   落点：normalizeMaterial() 已做兜底（缺字段 → ''），组件不需要判空。
 *
 * 【二、渲染层面 —— 统一占位块】
 *   当前所有卡片统一渲染固定 16/9 的「暂无配图」占位块，不加载任何外部图片。
 *   resolveImage() 作为数据层工具保留（历史兼容），真实数据里已无图可解析，
 *   因此解析结果恒为 ''。
 *
 * 【三、布局铁律】
 *   图片容器固定 aspect-ratio: 16/9 + max-height + overflow: hidden；
 *   占位块灰色背景、内容居中。无论何时，卡片布局绝不变化。
 * ============================================================================
 */

import wordBankService from './wordBankService.js';
import dataService from './dataService.js';

/* ---------------------------------------------------------------------------
 * 内部缓存：domainId -> Map<word(lower), material>
 * ---------------------------------------------------------------------------
 * 【内存缓存策略（本轮性能优化）】
 *   领域材料文件（50KB ~ 520KB）一旦载入就常驻内存，后续所有查询走 Map：
 *     materialCache  domainId -> Map<word, material>   ← 归一化后的材料
 *     rawCache       domainId -> 原始文件对象          ← 供统计取 domainName
 *     loadPromises   domainId -> Promise               ← 并发去重
 *
 *   行为保证：
 *     · 同一个领域重复调用只 fetch / JSON.parse 一次（loadPromises 去重）
 *     · 第二次切回同一领域时 ensure() 直接命中 materialCache **同步返回**，
 *       不再发起任何请求、不再重复解析 —— 这就是「切回同一领域秒开」的来源
 *     · peekMaterials() / isLoaded() 提供同步查询，页面可据此跳过骨架屏
 *     · clearCache() 供测试或手动释放
 * ------------------------------------------------------------------------ */
const materialCache = new Map();  // domainId -> Map
const rawCache = new Map();       // domainId -> 原始文件对象
const loadPromises = new Map();   // domainId -> Promise（并发去重）

/** 【同步】该领域材料是否已驻留内存（true = 无需再请求/解析） */
export function isLoaded(domainId) {
  return materialCache.has(domainId);
}

/** 【同步】取已缓存的材料 Map；未载入返回 null（不触发任何 IO） */
export function peekMaterials(domainId) {
  return materialCache.get(domainId) || null;
}

/**
 * 【同步】取已缓存的单条材料；未载入或未命中返回 null。
 * 用于「已知该领域已预热」的热路径，避免 async 开销。
 */
export function peekMaterial(domainId, word) {
  const map = materialCache.get(domainId);
  if (!map) return null;
  return map.get(String(word || '').toLowerCase()) || null;
}

/** 清空内存缓存（传 domainId 只清该领域）；仅供测试 / 手动释放 */
export function clearCache(domainId) {
  if (domainId) {
    materialCache.delete(domainId);
    rawCache.delete(domainId);
    loadPromises.delete(domainId);
  } else {
    materialCache.clear();
    rawCache.clear();
    loadPromises.clear();
  }
}

/** 从 dataUrl 读取领域材料文件（换后端时只改这里） */
async function loadDomainFile(domainId) {
  const url = wordBankService.resolveMaterialUrl(domainId);
  if (!url) return null;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn(`[domainMaterialService] 载入材料网络失败 ${domainId}：${e.message}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[domainMaterialService] 载入材料失败 ${domainId}: HTTP ${res.status}`);
    return null;
  }
  try {
    const json = await res.json();
    // 文件级兜底：结构不合法时归一为「空材料」，绝不抛错导致整个领域崩溃
    if (!json || typeof json !== 'object' || !json.materials || typeof json.materials !== 'object') {
      console.warn(`[domainMaterialService] 材料文件结构异常 ${domainId}，已按空材料处理`);
      return { materials: {} };
    }
    return json;
  } catch (e) {
    // JSON 解析失败（例如文件被截断/含非法字符）→ 降级为空材料，不阻断应用
    console.warn(`[domainMaterialService] 材料文件 JSON 解析失败 ${domainId}：${e.message}（已降级为空材料）`);
    return { materials: {} };
  }
}

/**
 * 归一化单条材料：补齐缺失字段，保证卡片组件拿到的结构永远完整。
 * 未来字段升级（例如增加 audioUrl）都在这里兜底，组件不需要做判空。
 */
function normalizeMaterial(raw, word) {
  const m = raw || {};
  return {
    word,
    root: m.root || '核心词',
    generalMeaning: m.generalMeaning || '',
    domainMeaning: m.domainMeaning || '',
    story: m.story || '',
    example: m.example || '',
    exampleZh: m.exampleZh || '',
    /* 例句出处（Fandom Wiki / AI重写 / 游戏内文本 / AI 生成）。
     * 与 source（译名来源）是两个不同维度，卡片背面据此标注例句来源。 */
    exampleSource: m.exampleSource || '',
    imageUrl: m.imageUrl || '',
    source: m.source || '',
    unverified: Boolean(m.unverified),
  };
}

/* ---------------------------------------------------------------------------
 * 数据完整性校验
 * ---------------------------------------------------------------------------
 * 卡片背面固定呈现「例句（example + exampleZh）」区域；若某词条缺 example，
 * 该区域会空白，且很难在运行期被察觉。因此在载入时就做一次静态校验并打印
 * 控制台警告，方便后续维护者定位是哪一份 JSON、哪一个词缺了字段。
 *
 * 校验规则：
 *   1. 缺 example / example 为空串 / 类型非 string  → 警告（卡片例句区会空白）
 *   2. 缺 exampleZh 或为空                          → 警告（仅英文，无译文）
 *
 * 注意：这里只「警告」不「抛错」。材料缺失不应导致整个领域加载失败，
 * 卡片会退回 normalizeMaterial() 兜底出的空字符串。
 * ------------------------------------------------------------------------ */
function validateMaterialExample(domainId, word, mat) {
  const problems = [];
  const ex = mat ? mat.example : undefined;
  if (ex === undefined) problems.push('缺少 example 字段');
  else if (ex === null) problems.push('example 为 null');
  else if (typeof ex !== 'string') problems.push(`example 类型应为 string，实际为 ${typeof ex}`);
  else if (!ex.trim()) problems.push('example 为空字符串');

  const exZh = mat ? mat.exampleZh : undefined;
  if (exZh === undefined) problems.push('缺少 exampleZh 字段');
  else if (!String(exZh).trim()) problems.push('exampleZh 为空');

  if (problems.length) {
    console.warn(
      `[domainMaterialService] 材料缺字段（卡片例句区会显示为空）· 领域「${domainId}」· 词「${word}」：${problems.join('；')}`
    );
    return false;
  }
  return true;
}

/**
 * 独立审计：检查某领域（或全部领域）每条材料是否都带 example。
 * 供开发期手动调用，例如：
 *   const r = await auditExamples();          // 全部领域
 *   const r = await auditExamples('honorOfKings');
 * @returns {Promise<{total:number, missing:Array<{domainId:string,word:string}>}>}
 */
export async function auditExamples(domainId) {
  const ids = domainId ? [domainId] : wordBankService.getDomainsWithMaterials();
  const missing = [];
  let total = 0;
  for (const id of ids) {
    const file = await loadDomainFile(id);
    if (!file || !file.materials) continue;
    for (const [word, mat] of Object.entries(file.materials)) {
      total += 1;
      const ex = mat ? mat.example : undefined;
      if (typeof ex !== 'string' || !ex.trim()) missing.push({ domainId: id, word });
    }
  }
  if (missing.length) {
    console.warn(`[domainMaterialService] auditExamples：${missing.length}/${total} 条材料缺 example`, missing);
  } else {
    console.info(`[domainMaterialService] auditExamples：全部 ${total} 条材料均含 example ✅`);
  }
  return { total, missing };
}

/** 载入并解析某领域的全部材料（并发安全） */
export async function preload(domainId) {
  if (loadPromises.has(domainId)) return loadPromises.get(domainId);

  const p = (async () => {
    const file = await loadDomainFile(domainId);
    const map = new Map();
    // 每一条单独 try/catch：某一条材料结构非法（null / 非对象 / 字段类型错）
    // 只跳过该条并计数，绝不因个别坏数据导致整个领域加载失败。
    let skipped = 0;
    if (file && file.materials && typeof file.materials === 'object') {
      for (const [word, mat] of Object.entries(file.materials)) {
        if (!word || typeof word !== 'string') { skipped++; continue; }
        if (mat === null || mat === undefined || typeof mat !== 'object' || Array.isArray(mat)) { skipped++; continue; }
        try {
          // 载入即校验：缺 example 会打印控制台警告（不阻断加载）
          validateMaterialExample(domainId, word, mat);
          map.set(String(word).toLowerCase(), normalizeMaterial(mat, word));
        } catch (e) {
          skipped++;
          console.warn(`[domainMaterialService] 跳过非法材料 ${domainId}/${word}：${e.message}`);
        }
      }
    }
    if (skipped) {
      console.warn(`[domainMaterialService] ${domainId}：共跳过 ${skipped} 条非法材料，其余已正常载入`);
    }
    materialCache.set(domainId, map);
    rawCache.set(domainId, file || null);
    return map;
  })();

  // 即便上面意外抛错，也不让 loadPromises 永久缓存一个 rejected Promise
  p.catch((e) => {
    console.warn(`[domainMaterialService] preload ${domainId} 异常，已降级为空材料：${e.message}`);
    materialCache.set(domainId, new Map());
    rawCache.set(domainId, null);
  });

  loadPromises.set(domainId, p);
  return p;
}

/** 预热全部已配置材料的领域 */
export async function preloadAll() {
  const ids = wordBankService.getDomainsWithMaterials();
  await Promise.all(ids.map((id) => preload(id)));
  return ids.length;
}

async function ensure(domainId) {
  // ① 内存缓存命中 → 直接同步返回，不 fetch、不 parse（第二次切回同领域秒开的保证）
  const cached = materialCache.get(domainId);
  if (cached) return cached;
  // ② 未命中 → 载入一次；loadPromises 保证并发只发一次请求
  await preload(domainId);
  return materialCache.get(domainId) || new Map();
}

/* ---------------------------------------------------------------------------
 * 查询 API
 * ------------------------------------------------------------------------ */

/**
 * 取单条预生成材料
 * @returns {Promise<object|null>} 归一化后的材料（未命中返回 null）
 */
export async function getMaterial(domainId, word) {
  const map = await ensure(domainId);
  return map.get(String(word || '').toLowerCase()) || null;
}

/**
 * 取单条材料，并附带用户手动设置的图片覆盖值
 * @returns {Promise<{material:object|null, image:string, hasImage:boolean}>}
 */
export async function getMaterialWithImage(domainId, word) {
  const material = await getMaterial(domainId, word);
  const image = await resolveImage(domainId, word, material);
  return { material, image, hasImage: Boolean(image) };
}

/**
 * 计算最终展示图的解析结果 —— 数据层兼容工具（图片功能已移除）。
 *
 * 优先级（从高到低）：
 *   0. 用户手填 URL 覆盖   dataService.getImageOverride()  （旧数据兼容，保留）
 *   1. 用户上传图 Base64   dataService.getUserImage()      （localStorage userImages）
 *   2. 材料预置图          material.imageUrl               （当前统一为 ""）
 *   3. 空串 → 组件渲染统一占位块
 *
 * 当前所有材料的 imageUrl 均为 ""，因此正常情况下返回空串，卡片显示占位块。
 *
 * @param {string} domainId
 * @param {string} word
 * @param {object|null} material
 * @returns {Promise<string>} 图片地址 / Base64 dataURL，无图时返回 ''
 */
export async function resolveImage(domainId, word, material) {
  // 0. 用户手填 URL（旧数据兼容）
  const override = await dataService.getImageOverride(domainId, word);
  if (override) return override;

  // 1. 用户上传图（Base64）—— 只影响本机当前用户
  const uploaded = await dataService.getUserImage(domainId, word);
  if (uploaded) return uploaded;

  // 2. 材料预置图（JSON 里人工填写的准确链接）
  // 3. 都没有 → 空串，组件渲染占位块
  return material?.imageUrl || '';
}

/**
 * 同步版优先级解析（供已知两份数据时使用，避免重复 await）。
 * 顺序与 resolveImage 完全一致，只是把「读数据」这一步交给调用方。
 * @param {object} src
 * @param {string} [src.override]   用户手填 URL
 * @param {string} [src.uploaded]   用户上传 Base64
 * @param {object|null} [src.material]
 * @returns {string}
 */
export function pickImage({ override, uploaded, material } = {}) {
  return override || uploaded || (material && material.imageUrl) || '';
}

/** 该领域全部材料（Map 的普通对象形态） */
export async function getMaterials(domainId) {
  const map = await ensure(domainId);
  return Object.fromEntries(map);
}

/** 是否已有预生成材料 */
export async function hasMaterial(domainId, word) {
  const map = await ensure(domainId);
  return map.has(String(word || '').toLowerCase());
}

/**
 * 批量判断：给一批词打上 material / image 字段
 * 替代旧版 studyService.hydrateCards 里「读 localStorage 缓存」的逻辑。
 *
 * 图片按 resolveImage() 的同一套优先级解析（顺序完全一致，只是这里一次性
 * 把两张表都读出来，避免对每个词各 await 两次）：
 *   手填URL > 上传图 > 材料预置图 > ''（占位块）
 * 当前所有材料 imageUrl 均为 ""，因此 results 里 image 基本都是 ''。
 *
 * ⚠️ 不查任何外部图库。没有图就老老实实返回 ''，由组件渲染占位块。
 *
 * @param {string} domainId
 * @param {Array} words
 * @returns {Promise<Array>} 原数组（原地写入 material / hasMaterial / image）
 */
export async function attachMaterials(domainId, words) {
  const map = await ensure(domainId);
  // 两张表一次性读取（顺序与 resolveImage 严格一致）
  const overrides = await dataService.getAllImageOverrides(domainId);   // { word: url }
  const uploads = await dataService.getAllUserImages(domainId);         // { word: dataURL }

  for (const w of words || []) {
    if (!w || !w.word) continue;
    const word = String(w.word).toLowerCase();
    const hit = map.get(word) || null;
    w.material = hit;
    w.hasMaterial = Boolean(hit);
    // 展示图：手填URL > 上传图 > 材料预置图（无图则为 ''，渲染占位块）
    w.image = pickImage({ override: overrides[word], uploaded: uploads[word], material: hit });
  }
  return words;
}

/**
 * 领域元信息（供 UI 展示「已覆盖 N 个词」）
 * withImage 统计「材料里预置了 imageUrl 的条数」（不含用户上传 / 测试图）。
 */
export async function getMaterialStats(domainId) {
  const map = await ensure(domainId);
  const raw = rawCache.get(domainId);
  const all = [...map.values()];
  return {
    domainId,
    domainName: raw?.domainName || '',
    total: map.size,
    withImage: all.filter((m) => m.imageUrl).length,
    unverified: all.filter((m) => m.unverified).length,
    sourced: all.filter((m) => m.source).length,
  };
}

/**
 * 配图来源统计（运维视角）：有多少词最终能显示图片、各来自哪一级。
 * 用于排查「为什么这个词没图」。
 */
export async function getImageSourceStats(domainId) {
  const map = await ensure(domainId);
  const words = [...map.keys()];
  const overrides = await dataService.getAllImageOverrides(domainId);
  const uploads = await dataService.getAllUserImages(domainId);

  const stats = { total: words.length, fromOverride: 0, fromUpload: 0, fromMaterial: 0, none: 0 };
  for (const word of words) {
    const material = map.get(word);
    if (overrides[word]) stats.fromOverride += 1;
    else if (uploads[word]) stats.fromUpload += 1;
    else if (material && material.imageUrl) stats.fromMaterial += 1;
    else stats.none += 1;
  }
  return stats;
}

/**
 * 图片可用的域名白名单（仅用于给用户提示，不做强制拦截）
 * 说明：图片版权归原方所有，本项目仅做个人学习用途。
 */
export const IMAGE_COPYRIGHT_NOTICE =
  '图片版权归游戏开发商 / 原发布方及原作者所有，此处仅作个人学习用途展示，不用于任何商业场景。';

export default {
  preload,
  preloadAll,
  // 内存缓存查询（同步）
  isLoaded,
  peekMaterials,
  peekMaterial,
  clearCache,
  getMaterial,
  getMaterialWithImage,
  resolveImage,
  pickImage,
  getMaterials,
  hasMaterial,
  attachMaterials,
  getMaterialStats,
  getImageSourceStats,
  auditExamples,
  IMAGE_COPYRIGHT_NOTICE,
};
