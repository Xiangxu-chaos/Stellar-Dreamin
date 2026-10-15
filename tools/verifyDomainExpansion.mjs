/**
 * verifyDomainExpansion.mjs —— 扩展兴趣库 + 领域板块（category）回归校验
 * ============================================================================
 * 覆盖两件事：
 *   一、领域分类改造
 *     1. DOMAIN_CATEGORY 恰好四类：游戏 / 影视 / 体育 / 其他
 *     2. DOMAIN_CATEGORY_ORDER 与需求顺序一致
 *     3. 每个领域的 category 都落在四类白名单内
 *     4. 原始四领域全部归入「游戏」
 *     5. getDomains() 透传 category（选择界面靠它分组）
 *     6. theme.id 全局唯一、theme token 无缺失（漏配会回退成默认蓝）
 *     7. domainPicker / CSS 具备分组渲染能力（.dp-groups / .dp-group*）
 *     8. 未知或缺失的 category 会被归入「其他」（不允许卡片凭空消失）
 *   二、新增领域材料数据
 *     9. 每个已注册领域都有材料文件（不允许「注册了却没有数据」）
 *    10. 每个领域 ≥ 20 条材料
 *    11. 每条材料 10 个字段齐全、example / exampleZh / source 非空
 *    12. imageUrl 一律为空串、unverified 必须是 boolean
 *    13. 例句必须含该单词本身（容忍常规词形变化）
 *    13c/13d. 影视 / 体育领域的例句必须含该领域专有名词
 *            （专名表 tools/patches/nounLists.json 与 autoFixGap --noun-fix 同源）
 *    15/15b. 「孤儿材料」零容忍：材料词必须落在 buildRelatedWords() 的召回集合内，
 *            否则材料永远筛不进领域、界面上永不出现。
 *    14. 原始四领域**原有条目**的内容指纹与冻结基线一致
 *            （补缺口允许新增，但一个字节都不许改旧数据）
 * ============================================================================
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const jread = (rel) => JSON.parse(read(rel));

/* ---------------- file:// fetch shim ----------------
 * studyService / wordBankService 在 Node 下通过 fetch 读词库 JSON，
 * 原生 fetch 不支持 file:// 协议（undici: not implemented... yet...），必须自行 shim。
 * ⚠️ 只拦截 file://，其余 URL 原样透传，避免误伤真实网络请求。 */
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (!s.startsWith('file:')) return nativeFetch(url, init);
  const p = decodeURIComponent(s.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  const text = readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

/* ==========================================================================
   一、领域分类改造
   ========================================================================== */
const cfg = await import('../src/config/interestsConfig.js');
const { INTEREST_DOMAINS, DOMAIN_CATEGORY, DOMAIN_CATEGORY_ORDER, DEFAULT_THEME } = cfg;

const catValues = Object.values(DOMAIN_CATEGORY);
ok('1. DOMAIN_CATEGORY 恰好四类',
  catValues.length === 4, catValues.join(' / '));
ok('1b. 四类取值 = 游戏 / 影视 / 体育 / 其他',
  ['游戏', '影视', '体育', '其他'].every((c) => catValues.includes(c)), catValues.join(','));
ok('2. DOMAIN_CATEGORY_ORDER 与需求顺序一致',
  DOMAIN_CATEGORY_ORDER.join(',') === '游戏,影视,体育,其他', DOMAIN_CATEGORY_ORDER.join(' → '));

const domains = Object.values(INTEREST_DOMAINS);
const badCategory = domains.filter((d) => !DOMAIN_CATEGORY_ORDER.includes(d.category));
ok('3. 每个领域的 category 都在白名单内', badCategory.length === 0,
  badCategory.map((d) => `${d.id}:${d.category}`).join(', '));

const LEGACY = ['slay_the_spire', 'hollow_knight', 'honor_of_kings', 'valorant'];
const legacyNotGame = domains.filter((d) => LEGACY.includes(d.id) && d.category !== DOMAIN_CATEGORY.GAME);
ok('4. 原始四领域全部归入「游戏」', legacyNotGame.length === 0,
  legacyNotGame.map((d) => `${d.id}:${d.category}`).join(', '));

/* 扩展库分批入库时，板块必须归对（第一批=游戏，第二批=影视） */
const FILM_IDS = ['breaking_bad', 'sherlock', 'classic_movies'];
const filmWrong = FILM_IDS.filter((id) => INTEREST_DOMAINS[id]?.category !== DOMAIN_CATEGORY.FILM);
ok('4c. 影视板块领域归入「影视」', filmWrong.length === 0, filmWrong.join(', ') || FILM_IDS.join(', '));

/* 第三批（体育）同理 */
const SPORTS_IDS = ['basketball', 'badminton'];
const sportsWrong = SPORTS_IDS.filter((id) => INTEREST_DOMAINS[id]?.category !== DOMAIN_CATEGORY.SPORTS);
ok('4d. 体育板块领域归入「体育」', sportsWrong.length === 0, sportsWrong.join(', ') || SPORTS_IDS.join(', '));

/* getDomains() 必须把 category 透传出去，否则选择界面无从分组 */
const wb = (await import('../src/services/wordBankService.js')).default;
const meta = wb.getDomains();
ok('5. getDomains() 透传 category',
  meta.length === domains.length && meta.every((m) => DOMAIN_CATEGORY_ORDER.includes(m.category)),
  meta.map((m) => `${m.id}:${m.category}`).join(' '));

const themeIds = domains.map((d) => d.theme?.id);
ok('6. theme.id 全局唯一', new Set(themeIds).size === themeIds.length,
  `${new Set(themeIds).size}/${themeIds.length}`);
ok('6b. 每个领域都有 theme.label', domains.every((d) => Boolean(d.theme?.label)),
  domains.filter((d) => !d.theme?.label).map((d) => d.id).join(', '));

/* theme token 完整性：漏配的 token 会被 themeManager 回退成 DEFAULT_THEME（默认蓝） */
const tmSrc = read('src/core/themeManager.js');
const tokenKeys = [...tmSrc.matchAll(/^\s{2}([A-Za-z]+):\s*'--c-/gm)].map((m) => m[1]);
ok('6c. 解析出 themeManager 的 token 名单', tokenKeys.length >= 15, `${tokenKeys.length} 个`);
const MISSING_OK = new Set(['fontBody']);
const brokenThemes = [];
for (const d of domains) {
  for (const k of tokenKeys) {
    if (MISSING_OK.has(k)) continue;
    const v = d.theme?.[k];
    if (v === undefined || v === null || v === '') brokenThemes.push(`${d.id}.${k}`);
  }
}
ok('6d. 所有领域的 theme token 无缺失（不会回退成默认蓝）',
  brokenThemes.length === 0, brokenThemes.slice(0, 8).join(', '));
ok('6e. DEFAULT_THEME 自身仍是完整兜底', tokenKeys.every((k) => Boolean(DEFAULT_THEME[k])));

/* 分组渲染能力 */
const pickerSrc = code(read('src/components/domainPicker.js'));
ok('7. domainPicker 按板块分组渲染',
  /dp-groups/.test(pickerSrc) && /dp-group__title/.test(pickerSrc) && /groupByCategory/.test(pickerSrc));
ok('7b. domainPicker 引用 DOMAIN_CATEGORY_ORDER 决定板块顺序',
  /DOMAIN_CATEGORY_ORDER/.test(pickerSrc));
ok('7c. CSS 定义了分组样式',
  ['.dp-groups', '.dp-group', '.dp-group__head', '.dp-group__title', '.dp-group__count', '.dp-group__icon']
    .every((s) => code(read('src/styles/components.css')).includes(s)));

/* 归一化：不在白名单内的 category 必须落到「其他」 */
ok('8. 未识别 / 缺失 category 归入「其他」',
  /return DOMAIN_CATEGORY_ORDER\.includes\(v\) \? v : DOMAIN_CATEGORY\.OTHER/.test(pickerSrc));

/* ==========================================================================
   二、新增领域材料数据
   ========================================================================== */
const withMat = wb.getDomainsWithMaterials();
const noMaterial = domains.filter((d) => !withMat.includes(d.id));
ok('9. 每个已注册领域都有材料文件映射', noMaterial.length === 0,
  noMaterial.map((d) => d.id).join(', '));

/* 通用字段：原始四领域也满足（imageUrl 允许为空串，是刻意的占位规范） */
const REQUIRED_FIELDS = ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh', 'imageUrl', 'source', 'unverified'];
/* 新增领域额外要求：例句出处必须标注 */
const REQUIRED_FIELDS_NEW = ['exampleSource'];
const OPTIONAL_EMPTY = new Set(['imageUrl']);
/* 原始四领域的老数据存在「story 为空」等历史瑕疵，按「旧数据保持不动」原则只做轻量校验 */
const LEGACY_LIGHT_FIELDS = ['root', 'generalMeaning', 'domainMeaning', 'example', 'exampleZh', 'imageUrl', 'source'];

/* 材料文件路径映射（与 wordBankService.MATERIAL_FILES 对齐） */
const wbSrc = read('src/services/wordBankService.js');
const fileMap = Object.fromEntries(
  [...wbSrc.matchAll(/(\w+):\s*new URL\('\.\.\/data\/domainMaterials\/([\w.]+)'/g)].map((m) => [m[1], m[2]]),
);

const problems = [];
const missingExampleSource = [];
const overview = [];
let grandTotal = 0;

for (const id of withMat) {
  const file = fileMap[id];
  if (!file) { problems.push(`${id}: 未在 MATERIAL_FILES 里解析到文件名`); continue; }
  const rel = `src/data/domainMaterials/${file}`;
  if (!existsSync(path.join(ROOT, rel))) { problems.push(`${id}: 文件缺失 ${file}`); continue; }

  const j = jread(rel);
  const words = Object.keys(j.materials || {});
  grandTotal += words.length;
  overview.push(`${id}(${words.length})`);

  const isLegacy = LEGACY.includes(id);
  const needFields = isLegacy ? LEGACY_LIGHT_FIELDS : [...REQUIRED_FIELDS, ...REQUIRED_FIELDS_NEW];

  if (words.length < 20) problems.push(`${id}: 只有 ${words.length} 条材料（< 20）`);
  if (j.domainIdInConfig !== id) problems.push(`${id}: domainIdInConfig=${j.domainIdInConfig} 与注册 id 不一致`);
  if (!Array.isArray(j._comment) || !j._comment.length) problems.push(`${id}: 缺 _comment 说明`);

  for (const [w, m] of Object.entries(j.materials || {})) {
    for (const f of needFields) {
      if (m[f] === undefined || m[f] === null) { problems.push(`${id}/${w}.${f} 缺失`); continue; }
      if (OPTIONAL_EMPTY.has(f)) continue;
      if (typeof m[f] === 'string' && !m[f].trim()) problems.push(`${id}/${w}.${f} 为空`);
    }
    if (m.imageUrl !== '') problems.push(`${id}/${w}.imageUrl 必须为空串（实际 ${JSON.stringify(m.imageUrl)}）`);
    if (typeof m.unverified !== 'boolean') problems.push(`${id}/${w}.unverified 必须是 boolean`);
    // 例句含该单词的校验只针对新增领域（老数据的既有瑕疵不在本轮范围内）
    if (isLegacy) continue;
    if (!String(m.exampleSource || '').trim()) missingExampleSource.push(`${id}/${w}`);
    const bare = w.toLowerCase();
    const ex = String(m.example || '').toLowerCase().replace(/[^a-z]/g, '');
    const stem = bare.replace(/e$/, '');
    if (!ex.includes(bare.replace(/[^a-z]/g, '')) && !(stem.length >= 5 && ex.includes(stem))) {
      problems.push(`${id}/${w}: 例句不含该单词 → ${m.example}`);
    }
  }
}

ok('10. 每个领域的材料条数 ≥ 20', overview.every((s) => Number(s.match(/\((\d+)\)/)?.[1]) >= 20), overview.join(' '));
ok('11/12/13. 材料字段 / 图片占位 / 例句含词 全部合规',
  problems.length === 0, problems.slice(0, 8).join(' | '));
ok('13b. 新增领域的每条材料都标了 exampleSource',
  missingExampleSource.length === 0, missingExampleSource.slice(0, 8).join(', '));

/* 例句必须带该领域专有名词，让用户一眼看出关联。
 * ⚠️ 专名表已抽到 tools/patches/nounLists.json —— 修复脚本 autoFixGap --noun-fix
 *    与这里读取同一份数据，避免「修复用一份、校验用另一份」的漂移。 */
const NOUN_LISTS = JSON.parse(read('tools/patches/nounLists.json'));
const nounNoNoun = [];
for (const [fileKey, nouns] of Object.entries(NOUN_LISTS)) {
  if (fileKey.startsWith('_')) continue;
  if (!Array.isArray(nouns) || nouns.length < 7) {
    nounNoNoun.push(`${fileKey}: 专名表过短（${nouns?.length}）`);
    continue;
  }
  /* ⚠️ 校验范围＝「领域自有词汇」（domainTerms + domainVocabulary）。
   * 场景泛化层（src/config/scenarioVocabulary.js）是刻意引入的**非专有术语**
   * （情感 / 行为 / 评价 / 叙事概念），按产品口径「非专有术语但场景关联合理」，
   * 不要求其例句必须出现专名 —— 否则会把泛化层逼成「每条都硬塞电影名」的复读机。 */
  const cfgId = Object.keys(fileMap).find((k) => fileMap[k] === `${fileKey}.json`);
  const dc = INTEREST_DOMAINS[cfgId] || {};
  const own = new Set([
    ...Object.keys(dc.domainTerms || {}),
    ...Object.keys(dc.domainVocabulary || {}),
  ].map((k) => String(k).toLowerCase()));

  const j = jread(`src/data/domainMaterials/${fileKey}.json`);
  for (const [w, m] of Object.entries(j.materials || {})) {
    if (!own.has(String(w).toLowerCase())) continue;
    if (!nouns.some((n) => String(m.example || '').includes(n))) nounNoNoun.push(`${fileKey}/${w}`);
  }
}
ok('13c. 影视 / 体育领域「自有词汇」的例句都含该领域专有名词（泛化层豁免）',
  nounNoNoun.length === 0, nounNoNoun.slice(0, 8).join(', '));
ok('13d. 专名表覆盖 5 个领域（绝命毒师 / 夏洛克 / 经典电影 / 篮球 / 羽毛球）',
  ['breakingBad', 'sherlock', 'classicMovies', 'basketball', 'badminton'].every((k) => NOUN_LISTS[k]?.length >= 7),
  Object.keys(NOUN_LISTS).filter((k) => !k.startsWith('_')).join(', '));

/* 孤儿材料检查（体育两库零容忍）：
 * 「孤儿」的真实定义 = 该词**不在本领域的召回集合里** —— 那样它的材料永远筛不进
 * 领域、界面上永不出现。召回集合以 studyService.buildRelatedWords() 为准
 * （它同时受 domainTerms / domainVocabulary 与词库关联规则驱动，比直接读词汇表更准）。 */
const study = (await import('../src/services/studyService.js')).default;
const orphan = [];
for (const id of SPORTS_IDS) {
  const recall = new Set(
    (await study.buildRelatedWords(id, { localLimit: 800 })).words.map((x) => String(x.word).toLowerCase()),
  );
  for (const w of Object.keys(jread(`src/data/domainMaterials/${fileMap[id]}`).materials || {})) {
    if (!recall.has(w)) orphan.push(`${id}/${w}`);
  }
}
ok('15/15b. 体育领域材料词全部落在该领域召回集合内（无孤儿材料）',
  orphan.length === 0, orphan.slice(0, 8).join(', '));

ok('9b. 材料总量随扩展库增长（≥ 1340 基线）', grandTotal >= 1340, `${grandTotal} 条`);

/* 原始四领域**原有条目不得被误改**。
 * 只用「条数不变」不够（补缺口会合法地增加条数），这里用内容指纹锁死：
 *   把「非 AI 补充」的条目（source 含「AI 补充」的视为后续新增）按 key 排序后哈希，
 *   与冻结基线 tools/baselines/legacy-baseline.json 比对。
 * 基线可用 node tools/genLegacyBaseline.mjs 重新生成（仅在确需重新冻结时）。 */
const BASELINE = jread('tools/baselines/legacy-baseline.json');
const baselineBad = [];
for (const [f, base] of Object.entries(BASELINE.files)) {
  const mats = jread(`src/data/domainMaterials/${f}.json`).materials || {};
  const original = Object.fromEntries(
    Object.entries(mats).filter(([, m]) => !String(m.source || '').includes('AI 补充')),
  );
  const keys = Object.keys(original).sort();
  const digest = createHash('sha256')
    .update(JSON.stringify(keys.map((k) => [k, original[k]]))).digest('hex').slice(0, 32);
  if (keys.length !== base.count) baselineBad.push(`${f}: 原有条目 ${base.count} → ${keys.length}`);
  else if (digest !== base.sha256) baselineBad.push(`${f}: 原有条目内容被改动（指纹不符）`);
}
ok('14. 原始四领域原有条目内容指纹与冻结基线一致（未被误改）',
  baselineBad.length === 0, baselineBad.join(' | ') || Object.keys(BASELINE.files).join(', '));

/* 4 个原始领域不得被删或改板块 */
const legacyStill = LEGACY.filter((id) => INTEREST_DOMAINS[id]);
ok('14b. 原始四领域仍全部在册', legacyStill.length === 4, legacyStill.join(', '));

/* ---------------- 输出 ---------------- */
console.log('=========== 扩展兴趣库 / 领域板块 校验 ===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
