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
 *   - getMaterialWithImage(domainId, word) 单条材料 + 用户图片覆盖
 *   - getMaterials(domainId)               该领域全部材料
 *   - hasMaterial(domainId, word)
 *   - resolveImage(domainId, word, mat)    计算最终展示图（覆盖 > 预置 > ''）
 *   - getMaterialStats(domainId)           覆盖率统计
 *   - auditExamples([domainId])            审计：逐条检查是否带 example
 *   - preload(domainId) / preloadAll()     预热（载入时自动校验 example）
 * ============================================================================
 */

import wordBankService from './wordBankService.js';
import dataService from './dataService.js';

/* ---------------------------------------------------------------------------
 * 内部缓存：domainId -> Map<word(lower), material>
 * ------------------------------------------------------------------------ */
const materialCache = new Map();  // domainId -> Map
const rawCache = new Map();       // domainId -> 原始文件对象
const loadPromises = new Map();   // domainId -> Promise（并发去重）

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
  if (!materialCache.has(domainId)) await preload(domainId);
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

/** 计算最终展示图：用户覆盖 > 材料预置 > 空 */
export async function resolveImage(domainId, word, material) {
  const override = await dataService.getImageOverride(domainId, word);
  if (override) return override;
  return material?.imageUrl || '';
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
 * 批量判断：给一批词打上 material 字段
 * 替代旧版 studyService.hydrateCards 里「读 localStorage 缓存」的逻辑。
 * @param {string} domainId
 * @param {Array} words
 * @returns {Promise<Array>} 原数组（原地写入 material / hasMaterial）
 */
export async function attachMaterials(domainId, words) {
  const map = await ensure(domainId);
  const overrides = await dataService.getAllImageOverrides(domainId);
  for (const w of words || []) {
    if (!w || !w.word) continue;
    const hit = map.get(String(w.word).toLowerCase()) || null;
    w.material = hit;
    w.hasMaterial = Boolean(hit);
    // 展示图：用户覆盖 > 材料预置
    const key = String(w.word).toLowerCase();
    w.image = overrides[key] || hit?.imageUrl || '';
  }
  return words;
}

/**
 * 领域元信息（供 UI 展示「已覆盖 N 个词」）
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
 * 图片可用的域名白名单（仅用于给用户提示，不做强制拦截）
 * 说明：图片版权归原方所有，本项目仅做个人学习用途。
 */
export const IMAGE_COPYRIGHT_NOTICE =
  '图片版权归游戏开发商 / 原发布方及原作者所有，此处仅作个人学习用途展示，不用于任何商业场景。';

export default {
  preload,
  preloadAll,
  getMaterial,
  getMaterialWithImage,
  resolveImage,
  getMaterials,
  hasMaterial,
  attachMaterials,
  getMaterialStats,
  auditExamples,
  IMAGE_COPYRIGHT_NOTICE,
};
