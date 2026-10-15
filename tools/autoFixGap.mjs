#!/usr/bin/env node
/**
 * autoFixGap.mjs —— 自动补齐「领域词没有记忆材料」的缺口（DeepSeek 驱动）
 * ============================================================================
 * 解决的问题：
 *   领域里能召回的词，与 src/data/domainMaterials/*.json 里**预生成过材料**的词
 *   不是同一集合。差集里的词在卡片背面本来就无话可说 —— 历史上靠
 *   wordCard/flipCard/detailModal 的 localDomainHint() 兜底文案填空，
 *   于是出现了「该词在《X》的语境中较为常见，可与游戏场景建立联想」这类废话。
 *   渲染层已彻底删除这些兜底（无材料 → 整块隐藏）；本脚本负责从数据层
 *   **把这些缺口真正补上**。
 *
 * 脚本自带循环（这是本文件的核心）：
 *   1. 自动扫描所有领域，算出缺材料的词 → 组成待办队列；
 *   2. `for` 循环按 --batch（默认 30）条一批处理；
 *   3. **每循环一次就把该批结果写入对应 JSON 文件**（不是等全部跑完才写），
 *      同时打印带进度的日志；
 *   4. 单批内先整体请求；对不达标的词**二分递归重拆小批**，最后单条重试；
 *   5. 网络错误 / 限流 / 超时 → 指数退避自动重试（--retries，默认 4 次）；
 *   6. 全部批次跑完后再整体重扫一次并打印核对报告；脚本自动退出。
 *      若仍有残留（极少），再跑一次同样的命令即可继续 —— 已补齐的词自动跳过。
 *   ⇒ 中途 Ctrl+C 也安全：已完成的批次早已落盘，重跑会自动跳过已补齐的词。
 *
 * 用法：
 *   node tools/autoFixGap.mjs                       # 补齐全部缺口（核心命令）
 *   node tools/autoFixGap.mjs --dry                 # 只扫描、只打印计划，不联网不写盘
 *   node tools/autoFixGap.mjs --mock                # 离线自检：本地假内容跑通全流程
 *   node tools/autoFixGap.mjs --domain=basketball   # 只补一个领域
 *   node tools/autoFixGap.mjs --batch=20            # 每批词数（默认 30）
 *   node tools/autoFixGap.mjs --limit=30            # 本次最多补 N 个词（小样验证）
 *   node tools/autoFixGap.mjs --retries=6           # 网络错误重试次数（默认 4）
 *   node tools/autoFixGap.mjs --tips=tools/patches/gapTips.json   # 注入逐词「陷阱提示」
 *   node tools/autoFixGap.mjs --targets             # 按领域类别目标扩充材料
 *                                                   # （游戏 300 / 影视 200 / 体育 200 / 其他 150；
 *                                                   #  可召回词条不足目标时以可召回为准）
 *   node tools/autoFixGap.mjs --repair              # 只修「残缺条目」（example/exampleZh 为空、
 *                                                   #  story 字数不足 / 含空泛话术、必填字段为空），
 *                                                   #  只替换残缺字段，其余字段一字节不动
 *   node tools/autoFixGap.mjs --noun-fix            # 只重写「例句看不出领域」的条目
 *                                                   #（example/exampleZh，强制含领域专有名词）
 *
 * API Key 读取顺序（与 genDomainMaterials.mjs 同源）：
 *   1) 环境变量 DEEPSEEK_API_KEY
 *   2) 项目根目录 .deepseek-key 文件（一行纯文本）
 *
 * ⚠️ 仅开发期使用。运行时（浏览器）永不调用任何 AI API，材料是静态 JSON。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/data/domainMaterials');
const REPORT_DIR = path.join(ROOT, 'tools/reports');
const LOG_FILE = path.join(REPORT_DIR, 'autoFixGap.log');

const {
  checkMaterial, exampleHasWord, storyLength, VAGUE_PHRASES, STORY_MIN, STORY_MAX,
  deepseekChat, hasDeepSeekKey, DEEPSEEK_MODEL,
} = await import('./genDomainMaterials.mjs');

/* ==========================================================================
 * 0. 命令行参数
 * ======================================================================= */
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const DRY = argv.includes('--dry');
const MOCK = argv.includes('--mock');
const BATCH = Math.max(1, Number(getArg('batch', 30)));
const RETRIES = Math.max(1, Number(getArg('retries', 4)));
const LIMIT = Math.max(0, Number(getArg('limit', 0)));
const DOMAIN_ARG = getArg('domain', '');
const PER_WORD_RETRY = 2;
/* --noun-fix：不补缺口，而是重写「例句看不出领域」的条目（只换 example / exampleZh） */
const NOUN_FIX = argv.includes('--noun-fix');
const NOUN_LISTS_PATH = getArg('nouns', 'tools/patches/nounLists.json');
/* --repair：只修「残缺条目」（example / exampleZh 为空、story 字数不足或含空泛话术、
   root / generalMeaning / domainMeaning 为空），不补「领域词没有材料」的缺口。
   字段级合并：只替换真正残缺的字段，其余字段一字节不动（沿用 fixDefectiveMaterials 的隔离原则）。 */
const REPAIR_ONLY = argv.includes('--repair');

/* --targets：按「领域类别目标条数」扩充材料。取值是每类目标的**上限**
   （游戏 300 / 影视 200 / 体育 200 / 其他 150），即每个领域最多补到该条数；
   若某领域「可召回词条总数」低于目标，则以全部可召回词条为准
   （gap 本身已经是上限：searchGaps 只返回能召回、且还没有材料的词）。 */
const USE_TARGETS = argv.includes('--targets');
/* --prune-orphans：删除「材料词不在本领域召回集合内」的孤儿条目。
   ⚠️ 只在 8 个「纯 AI 生成的新领域」上启用；老领域有手工编写的合法条目
   （如 hollowKnight 的 95 条专名材料）不在召回集合内，绝不能误删。 */
const PRUNE_ORPHANS = argv.includes('--prune-orphans');
const PRUNE_SCOPE = new Set([
  'algorithm', 'animation', 'aviation', 'billiard',
  'football', 'identity_fifth', 'rick_and_morty', 'stardew_valley',
]);
const TARGETS = {
  /* 场景泛化层上线后：上限放到「不封顶」的水平，让每个领域补到自己的召回上限 */
  /* 游戏类 */
  slay_the_spire: 1500, hollow_knight: 1500, honor_of_kings: 1500, valorant: 1500,
  slay_the_spire2: 1500, arknights: 1500, genshin_impact: 1500,
  identity_fifth: 1500, stardew_valley: 1500,
  /* 影视类 */
  breaking_bad: 900, sherlock: 900, classic_movies: 900, rick_and_morty: 900, animation: 900,
  /* 体育类 */
  basketball: 800, badminton: 800, football: 800, billiard: 800,
  /* 其他类 */
  aviation: 800, algorithm: 800,
};

/* ==========================================================================
 * 1. 日志（控制台 + 追加写入 tools/reports/autoFixGap.log）
 * ======================================================================= */
fs.mkdirSync(REPORT_DIR, { recursive: true });
function log(msg, level = 'info') {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${stamp}] ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch { /* 日志失败不影响主流程 */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==========================================================================
 * 2. Node 环境下的 fetch shim
 *    ⚠️ 只拦截 `file://`（让 studyService / wordBankService 读本地 JSON）；
 *       其余 URL **必须原样透传给原生 fetch**，否则 DeepSeek 的 HTTPS 请求
 *       会被当成文件路径解析，得到 HTTP 404 空响应体。
 * ======================================================================= */
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (!s.startsWith('file:')) return nativeFetch(url, init);
  const p = decodeURIComponent(s.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  const txt = fs.readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
};

/* ==========================================================================
 * 3. 载入领域上下文
 * ======================================================================= */
const { INTEREST_DOMAINS } = await import('../src/config/interestsConfig.js');
const CET6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cet6Core.json'), 'utf8'));
const CET6_MAP = new Map(
  (Array.isArray(CET6) ? CET6 : CET6.words).map((w) => [String(w.word).toLowerCase(), w]),
);

const domains = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const full = path.join(DIR, f);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  const key = f.replace(/\.json$/, '');
  const cfg = INTEREST_DOMAINS[json.domainIdInConfig] || {};
  domains.push({
    key, file: f, full, raw: json,
    domainIdInConfig: json.domainIdInConfig || key,
    domainName: json.domainName || cfg.name || key,
    gameNameEn: json.gameNameEn || '',
    terms: cfg.domainTerms || {},
    materials: json.materials || {},
  });
}

/* ==========================================================================
 * 4. 扫描缺口：领域能召回、但材料里没有的词
 * ======================================================================= */
let studyService = null;
/** 该领域的「召回词条」列表（按相关度排序），供缺口/孤儿判定共用 */
async function buildRecalled(d) {
  if (!studyService) {
    studyService = (await import(pathToFileURL(path.join(ROOT, 'src/services/studyService.js')).href)).default;
  }
  const r = await studyService.buildRelatedWords(d.domainIdInConfig, { localLimit: 5000 });
  return r.words.map((x) => String(x.word).toLowerCase());
}
async function scanGaps(d) {
  const words = await buildRecalled(d);
  const have = new Set(Object.keys(d.materials));
  return words.filter((w) => !have.has(w));
}

/* ==========================================================================
 * 4b. 扫描「残缺条目」：已存在、但字段不合格的词条
 *   判定口径与生成器红线同源（story ∈ [15,60]、禁空泛话术、example 必含该词、
 *   必填字段不得为空）。用于「接口不稳定导致部分词条字段缺失」的补齐场景。
 * ======================================================================= */

/**
 * 计算某个词条需要修复的字段集合（空数组 = 合格）。
 * 注意：只检查「内容字段」，**故意不含** source / exampleSource，
 * 避免把原始四领域「历史缺 exampleSource」的老数据卷进来（旧数据保持不动）。
 * @returns {string[]} 需要重写的字段名
 */
export function defectFields(w, m) {
  const fix = new Set();
  /* 必填文本字段为空 */
  for (const f of ['root', 'generalMeaning', 'domainMeaning']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) fix.add(f);
  }
  /* story：为空 / 字数越界 / 含空泛话术 */
  const story = String(m.story || '');
  const len = storyLength(story);
  if (!story.trim() || len < STORY_MIN || len > STORY_MAX) fix.add('story');
  else if (VAGUE_PHRASES.find((v) => story.includes(v))) fix.add('story');
  /* example：为空 / 不含该单词原形 / 夹杂中文 → 连带 exampleZh 一起重写 */
  const ex = String(m.example || '').trim();
  const exZh = String(m.exampleZh || '').trim();
  if (!ex || !exampleHasWord(w, ex) || /[\u4e00-\u9fff]/.test(ex)) { fix.add('example'); fix.add('exampleZh'); }
  else if (!exZh) fix.add('exampleZh');
  return [...fix];
}

/** 扫描一个领域的全部残缺条目 @returns {{word:string, fields:string[]}[]} */
function scanDefects(d) {
  const out = [];
  for (const [w, m] of Object.entries(d.materials)) {
    const fields = defectFields(w, m);
    if (fields.length) out.push({ word: w, fields });
  }
  return out;
}

/**
 * 字段级合并：只把 AI 结果里「本次标记为残缺」的字段写回，其余字段一字节不动。
 * example 与 exampleZh 始终成对更新，保证中英一致。
 */
export function mergeDefect(prev, it, fields) {
  const out = { ...prev };
  const set = new Set(fields);
  if (set.has('story')) out.story = String(it.story).trim();
  if (set.has('example')) {
    out.example = String(it.example).trim();
    out.exampleZh = String(it.exampleZh).trim();
  } else if (set.has('exampleZh')) {
    out.exampleZh = String(it.exampleZh).trim();
  }
  for (const f of ['root', 'generalMeaning', 'domainMeaning']) {
    if (set.has(f)) out[f] = String(it[f]).trim();
  }
  return out;
}

/* ==========================================================================
 * 5. Prompt
 * ======================================================================= */

/* 难词提示：某些单词 AI 天然容易写成变形或同义替换（如 consultant → consulting），
 * 可在 --tips=<json> 里给出逐词提示，直接注入该词的 prompt 行。 */
const TIPS_PATH = getArg('tips', '');
let TIPS = {};
if (TIPS_PATH) {
  const tp = path.resolve(ROOT, TIPS_PATH);
  if (!fs.existsSync(tp)) { console.error(`✘ 找不到提示文件：${TIPS_PATH}`); process.exit(1); }
  TIPS = JSON.parse(fs.readFileSync(tp, 'utf8'));
  log(`已载入难词提示 ${Object.keys(TIPS).length} 条（${TIPS_PATH}）`);
}
function termsBlock(d, max = 40) {
  const entries = Object.entries(d.terms).slice(0, max);
  if (!entries.length) return '（无）';
  return entries.map(([en, zh]) => `- ${en} → ${zh}`).join('\n');
}

function wordLine(w) {
  const c = CET6_MAP.get(w);
  const t = c ? String(c.translation || '').replace(/\n/g, ' ').slice(0, 40) : '';
  const tip = TIPS[w.toLowerCase()];
  return `- ${w}${t ? `（六级释义：${t}）` : ''}${tip ? `\n    ⚠️ 该词有陷阱，务必遵守：${tip}` : ''}`;
}

function buildMessages(d, words) {
  const sample = Object.values(d.terms)[0] || d.domainName;
  const system = [
    '你是一名资深领域内容作者 + 英语词汇专家，为一个「用兴趣领域记忆六级单词」的学习产品撰写记忆材料。',
    '只输出 JSON 对象，不要解释、不要 markdown 代码块、不要任何多余文字。',
  ].join('\n');

  const user = [
    `领域：${d.domainName}${d.gameNameEn ? `（${d.gameNameEn}）` : ''}`,
    '',
    '该领域官方中文专有名词参照表（写故事和例句时优先使用这些译名）：',
    termsBlock(d),
    '',
    '请为下列每个单词撰写完整的记忆材料。',
    '',
    '单词列表：',
    words.map(wordLine).join('\n'),
    '',
    '输出 JSON 结构：',
    '{"items":[{"word":"单词","root":"词根/派生说明","generalMeaning":"通用中文释义",'
      + '"domainMeaning":"该词在本领域语境中的具体含义","story":"微故事","example":"英文例句",'
      + '"exampleZh":"例句翻译"}]}',
    '',
    '硬性要求（不满足会被程序直接丢弃并重试）：',
    '1. story：15–60 个汉字（含标点）。必须是本领域里的**具体场景、具体事件或具体机制**，',
    '   让人一眼看出是这个领域（谁、在哪、做了什么、结果如何）。',
    '   严禁出现「较为常见」「较常见」「可用以」「可联想」「可以建立」「可与游戏场景建立联想」',
    '   「可结合场景」「与之相关」「值得一提」「众所周知」「一般来说」这类空泛套话。',
    '2. example：英文句子，**必须出现该单词的原形拼写**（不区分大小写）。',
    '   这是硬性要求，程序会逐字比对，只写变形会被判为不合格并打回重写。常见陷阱：',
    '     · exemplify → 句子写成 exemplifies ✘ ／ 原形 ✓（These cases exemplify …）',
    '     · overcome  → 句子写成 overcame  ✘ ／ 原形 ✓（They must overcome …）',
    '     · consultant→ 句子写成 consulting ✘ ／ 原形 ✓（He is a consultant.）',
    '   请调整句式让原形自然出现，不要为了凑词写出别扭的句子。',
    `   语法完整、语境贴合本领域，并尽量包含 1 个本领域专有名词（例如 ${sample}）。`,
    '3. exampleZh：example 的准确中文翻译。',
    '3b. ⚠️ example 必须是**纯英文**：绝对不要把中文（尤其领域术语的中文写法，如「洛谷」',
    '    「贪心」「密码机」）混进英文句子。若某个专有名词只有中文，改用它的英文名',
    '    （如 Luogu / greedy / cipher machine），或换一个自带英文的专有名词。',
    '4. root / generalMeaning / domainMeaning 均不得为空。',
    '5. 不要编造不存在的官方译名；不确定的专有名词宁可不用。',
  ].join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** --noun-fix 模式：只重写 example / exampleZh，且强制包含领域专有名词 */
function buildExampleMessages(d, words, nouns) {
  const system = [
    '你是一名领域内容作者 + 英语词汇专家，为一个「用兴趣领域记忆六级单词」的产品撰写英文例句。',
    '只输出 JSON 对象，不要解释、不要 markdown 代码块、不要任何多余文字。',
  ].join('\n');

  const user = [
    `领域：${d.domainName}${d.gameNameEn ? `（${d.gameNameEn}）` : ''}`,
    '',
    '本领域的专有名词（例句中**必须**出现下列至少一个，原样拼写、区分大小写）：',
    (nouns && nouns.length ? nouns.map((n) => `- ${n}`).join('\n') : termsBlock(d)),
    '',
    '该领域官方中文术语参照表（写例句时可参考）：',
    termsBlock(d),
    '',
    '为下列每个单词重写「英文例句 example」与「例句翻译 exampleZh」两项，不要写别的字段。',
    '',
    '单词列表：',
    words.map(wordLine).join('\n'),
    '',
    '输出 JSON：{"items":[{"word":"单词","example":"英文句子","exampleZh":"中文翻译"}]}',
    '',
    '硬性要求（不满足会被程序直接丢弃并重试）：',
    '1. example 必须**原样出现该单词的原形拼写**（不区分大小写）。常见陷阱：',
    '   exemplify ✘exemplifies ／ overcome ✘overcame ／ consultant ✘consulting。',
    '2. example 必须包含上面「专有名词」里的至少一个名字，让用户一眼看出是这个领域。',
    '3. example 必须是语法完整、语义自然的英文句子，不要为了塞词而写出别扭的句子。',
    '4. exampleZh 是 example 的准确中文翻译。',
    '5. 一门领域最多用 2–3 个不同的专有名词，不要每条都堆同一串名字。',
  ].join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/* ==========================================================================
 * 6. 解析 AI 返回
 * ======================================================================= */
function parseItems(text) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    const items = Array.isArray(obj) ? obj : obj.items;
    if (!Array.isArray(items)) return null;
    const map = new Map();
    for (const it of items) {
      const w = String(it.word || '').toLowerCase().trim();
      if (w) map.set(w, it);
    }
    return map;
  } catch {
    return null;
  }
}

/* ---------------- 离线自检（--mock）：本地假内容，不联网、不消耗额度 ---------------- */
function mockItems(d, words, mode = 'full', nouns = []) {
  const proper = nouns[0] || Object.values(d.terms)[0] || d.domainName;
  const map = new Map();
  for (const w of words) {
    if (mode === 'example') {
      map.set(w, {
        word: w,
        example: `In the ${proper} match, the team's ${w} decided the outcome.`,
        exampleZh: `在${proper}的比赛中，球队在这一项上的表现决定了结果。`,
      });
      continue;
    }
    map.set(w, {
      word: w,
      root: `派生自 ${w}`,
      generalMeaning: '（自检样本）通用释义',
      domainMeaning: `（自检样本）${d.domainName}中的具体含义`,
      story: `【自检样本】${d.domainName}里，${proper}这一局的关键全压在这个词上，一步走错就满盘皆输。`,
      example: `In ${d.domainName}, the ${proper} round turned on how well they handled the ${w}.`,
      exampleZh: `在${d.domainName}里，${proper}那一局的胜负，取决于他们把这个词对应的东西处理得多好。`,
    });
  }
  return map;
}

/* ==========================================================================
 * 7. 红线校验（复用生成器同源实现，单条判定）
 * ======================================================================= */
function candidateProblems(w, it) {
  if (!it) return ['未返回该词'];
  const problems = [];
  const s = String(it.story || '').trim();
  const len = storyLength(s);
  if (!s) problems.push('story 为空');
  else if (len < 15) problems.push(`story 仅 ${len} 字`);
  else if (len > 60) problems.push(`story 超长 ${len} 字`);
  else {
    const v = VAGUE_PHRASES.find((x) => s.includes(x));
    if (v) problems.push(`story 含空泛话术「${v}」`);
  }
  const ex = String(it.example || '').trim();
  if (!ex) problems.push('example 为空');
  else if (!exampleHasWord(w, ex)) problems.push('example 未含该单词');
  if (!String(it.exampleZh || '').trim()) problems.push('exampleZh 为空');
  for (const f of ['root', 'generalMeaning', 'domainMeaning']) {
    if (!String(it[f] || '').trim()) problems.push(`${f} 为空`);
  }
  return problems;
}

/** 例句模式（--noun-fix）：只校验 example / exampleZh，且要求含领域专有名词 */
function exampleProblems(w, it, nouns) {
  if (!it) return ['未返回该词'];
  const problems = [];
  const ex = String(it.example || '').trim();
  if (!ex) problems.push('example 为空');
  else if (!exampleHasWord(w, ex)) problems.push('example 未含该单词（原形）');
  else if (nouns?.length && !nouns.some((n) => ex.includes(n))) {
    problems.push(`example 不含领域专有名词（需含 ${nouns.slice(0, 3).join(' / ')} …之一）`);
  }
  if (!String(it.exampleZh || '').trim()) problems.push('exampleZh 为空');
  return problems;
}

/* 构造写入 JSON 的完整条目（字段顺序与既有数据一致） */
function buildEntry(w, it, d) {
  return {
    root: String(it.root).trim(),
    generalMeaning: String(it.generalMeaning).trim(),
    domainMeaning: String(it.domainMeaning).trim(),
    story: String(it.story).trim(),
    example: String(it.example).trim(),
    exampleZh: String(it.exampleZh).trim(),
    exampleSource: 'AI 生成',
    imageUrl: '',
    source: `${d.domainName}官方中文（AI 补充，待复核）`,
    unverified: true,
  };
}

/* ==========================================================================
 * 8. 网络层：带指数退避的重试
 * ======================================================================= */
function isRetryable(e) {
  const m = String(e?.message || e || '');
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|aborted|timeout|HTTP (408|429|5\d\d)/i.test(m);
}

async function callAIOnce(d, words, mode = 'full', nouns = []) {
  if (MOCK) return mockItems(d, words, mode, nouns);
  const messages = mode === 'example' ? buildExampleMessages(d, words, nouns) : buildMessages(d, words);
  const text = await deepseekChat(messages, {
    json: true, temperature: 0.8, maxTokens: mode === 'example' ? 4000 : 8000, timeoutMs: 180000,
  });
  const map = parseItems(text);
  if (!map) throw new Error('AI 返回内容不是合法 JSON（可重试）');
  return map;
}

/** 一次「整批 / 单条」的 API 调用，网络类错误自动指数退避重试 */
async function callAIWithRetry(d, words, mode = 'full', nouns = []) {
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await callAIOnce(d, words, mode, nouns);
    } catch (e) {
      lastErr = e;
      const retryable = isRetryable(e);
      if (!retryable || attempt === RETRIES) break;
      const wait = Math.min(30, 2 ** attempt) * 1000;   // 2s → 4s → 8s → 16s（上限 30s）
      log(`   ↻ 网络/接口异常（第 ${attempt}/${RETRIES} 次）：${String(e.message).slice(0, 120)} → ${wait / 1000}s 后重试`, 'error');
      await sleep(wait);
    }
  }
  throw lastErr || new Error('未知错误');
}

/* ==========================================================================
 * 9. 单批处理：整体请求 → 不合格二分重拆 → 单条重试
 * ======================================================================= */
async function fetchValidated(d, words, depth = 0, mode = 'full', nouns = []) {
  const accepted = new Map();
  if (!words.length) return accepted;
  const validate = mode === 'example'
    ? (w, it) => exampleProblems(w, it, nouns)
    : (w, it) => candidateProblems(w, it);

  let map = null;
  try {
    map = await callAIWithRetry(d, words, mode, nouns);
  } catch (e) {
    log(`   ✘ 请求失败（${words.length} 词）：${String(e.message).slice(0, 160)}`, 'error');
  }

  const failed = [];
  for (const w of words) {
    const it = map && map.get(w);
    if (validate(w, it).length === 0) accepted.set(w, it);
    else failed.push(w);
  }
  if (!failed.length) return accepted;

  /* 单条：再单独重试 PER_WORD_RETRY 次 */
  if (failed.length === 1 && depth < 6) {
    const w = failed[0];
    for (let a = 1; a <= PER_WORD_RETRY && !accepted.has(w); a++) {
      try {
        const m2 = await callAIWithRetry(d, [w], mode, nouns);
        const it = m2 && m2.get(w);
        if (validate(w, it).length === 0) accepted.set(w, it);
        else log(`   · ${w} 第 ${a} 次单独重试仍不达标：${validate(w, it)[0]}`, 'error');
      } catch (e) {
        log(`   · ${w} 第 ${a} 次单独重试出错：${String(e.message).slice(0, 120)}`, 'error');
      }
    }
    return accepted;
  }

  /* 多条不合格：二分重拆，缩小批次显著提升 JSON 完整率 */
  if (failed.length > 1 && depth < 4) {
    const mid = Math.ceil(failed.length / 2);
    for (const part of [failed.slice(0, mid), failed.slice(mid)]) {
      if (!part.length) continue;
      const sub = await fetchValidated(d, part, depth + 1, mode, nouns);
      for (const [k, v] of sub) accepted.set(k, v);
    }
  }
  return accepted;
}

/* ==========================================================================
 * 10. 写盘（每完成一批立刻写，绝不攒到最后）
 * ======================================================================= */
function persist(d) {
  const body = JSON.stringify({ ...d.raw, materials: d.materials }, null, 2) + '\n';
  fs.writeFileSync(d.full, body, 'utf8');
}

/* ==========================================================================
 * 11b. 例句专名修复模式（--noun-fix）
 *   只重写 example / exampleZh，其他字段一个字节都不碰。
 * ======================================================================= */
async function runNounFix(targets) {
  const np = path.resolve(ROOT, NOUN_LISTS_PATH);
  if (!fs.existsSync(np)) { console.error(`✘ 找不到专名表：${NOUN_LISTS_PATH}`); process.exit(1); }
  const NOUNS = JSON.parse(fs.readFileSync(np, 'utf8'));

  log('============================================================');
  log(`模式：例句专名修复（--noun-fix）| ${MOCK ? '离线自检(--mock)' : `调用 DeepSeek（${DEEPSEEK_MODEL}）`}`);
  log(`专名表：${NOUN_LISTS_PATH} | 每批 ${BATCH} 条`);
  log('============================================================');

  const plan = [];
  let total = 0;
  for (const d of targets) {
    const nouns = NOUNS[d.key] || NOUNS[d.domainIdInConfig] || [];
    if (!nouns.length) { log(`跳过 ${d.domainName}：专名表未定义`); continue; }
    const bad = Object.keys(d.materials)
      .filter((w) => !nouns.some((n) => String(d.materials[w].example || '').includes(n)));
    total += bad.length;
    plan.push({ d, nouns, bad });
    log(`${d.domainName.padEnd(10)} 材料 ${String(Object.keys(d.materials).length).padStart(4)} 条 | 例句缺专名 ${String(bad.length).padStart(3)} 条`);
  }

  if (!total) { log('\n✅ 所有例句都已包含领域专有名词，无需处理，脚本退出。'); return; }

  let budget = LIMIT || Infinity;
  const batches = [];
  for (const { d, nouns, bad } of plan) {
    const todo = bad.slice(0, budget === Infinity ? bad.length : budget);
    budget -= todo.length;
    for (let i = 0; i < todo.length; i += BATCH) batches.push({ d, nouns, words: todo.slice(i, i + BATCH) });
    if (budget <= 0) break;
  }
  log(`\n待重写例句：${total} 条 → ${batches.length} 批`);
  if (DRY) {
    for (const b of batches.slice(0, 5)) log(`   • ${b.d.domainName}：${b.words.join(', ')}`);
    log('（--dry：不联网、不写盘）');
    return;
  }

  let done = 0;
  let failed = 0;
  const started = Date.now();
  for (let i = 0; i < batches.length; i++) {
    const { d, nouns, words } = batches[i];
    log(`[${i + 1}/${batches.length}] ${d.domainName} —— ${words.length} 词：${words.slice(0, 10).join(', ')}${words.length > 10 ? ' …' : ''}`);
    const accepted = await fetchValidated(d, words, 0, 'example', nouns);
    let n = 0;
    for (const w of words) {
      const it = accepted.get(w);
      if (!it) { failed++; continue; }
      const probs = exampleProblems(w, it, nouns);
      if (probs.length) { log(`   ✘ ${w}：${probs[0]}`, 'error'); failed++; continue; }
      d.materials[w] = {
        ...d.materials[w],
        example: String(it.example).trim(),
        exampleZh: String(it.exampleZh).trim(),
      };
      n++;
    }
    if (n) {
      persist(d);
      done += n;
      log(`   💾 已写入 ${d.file}（本批重写 ${n} 条例句）`);
    }
    log(`   进度：本批 ${n}/${words.length} ｜ 累计重写 ${done}/${total} ｜ 失败 ${failed} ｜ 用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  /* 收尾核对 */
  log('\n================ 重新核对 ================');
  let remain = 0;
  for (const { d, nouns } of plan) {
    const bad = Object.keys(d.materials)
      .filter((w) => !nouns.some((n) => String(d.materials[w].example || '').includes(n)));
    remain += bad.length;
    log(`   ${d.domainName.padEnd(10)} 仍缺专名 ${String(bad.length).padStart(3)} 条${bad.length ? '：' + bad.slice(0, 8).join(', ') : ''}`);
  }
  log(`\n重写 ${done} 条 ｜ 失败 ${failed} 条 ｜ 仍缺 ${remain} 条`);
  if (remain) log('⚠️ 再跑一次同样的命令即可继续（已合规的条目会自动跳过）。');
  else log('✅ 全部例句均已含领域专有名词，脚本退出。');
}

/* ==========================================================================
 * 10b. 孤儿清理（--prune-orphans）
 *   删除「材料词**不在**本领域召回集合内」的条目 —— 这类条目在界面上永远不会
 *   出现（既不属于该领域，也没法被该领域召回），属于误写。
 *   仅对 PRUNE_SCOPE 里的 8 个纯 AI 生成领域生效。
 * ======================================================================= */
async function runPruneOrphans(targets) {
  log('============================================================');
  log('模式：清理孤儿材料（--prune-orphans）');
  log('============================================================');
  let removed = 0;
  for (const d of targets) {
    if (!PRUNE_SCOPE.has(d.domainIdInConfig)) {
      log(`跳过 ${d.domainName}（不在清理白名单内，避免误删老领域手工条目）`);
      continue;
    }
    const rec = new Set(await buildRecalled(d));
    const foreign = Object.keys(d.materials).filter((w) => !rec.has(w));
    if (!foreign.length) { log(`${d.domainName.padEnd(10)} 无孤儿条目`); continue; }
    for (const w of foreign) delete d.materials[w];
    persist(d);
    removed += foreign.length;
    log(`${d.domainName.padEnd(10)} 删除孤儿 ${String(foreign.length).padStart(3)} 条 → ${foreign.slice(0, 14).join(', ')}${foreign.length > 14 ? ' …' : ''}`);
  }
  log(`\n共删除 ${removed} 条孤儿材料（随后重跑补齐即可回到正确领域）。`);
}

/* ==========================================================================
 * 11. 主流程
 * ======================================================================= */
async function main() {
  if (!DRY && !MOCK && !hasDeepSeekKey()) {
    console.error('✘ 缺少 DeepSeek API Key。三种任选其一：');
    console.error('   1) DEEPSEEK_API_KEY=sk-xxx node tools/autoFixGap.mjs      （Linux/macOS/Git Bash）');
    console.error('   2) set DEEPSEEK_API_KEY=sk-xxx && node tools/autoFixGap.mjs  （Windows cmd）');
    console.error('   3) 把 Key 单独写进项目根目录的 .deepseek-key 文件，然后直接 node tools/autoFixGap.mjs');
    process.exit(1);
  }

  const targets = domains.filter((d) => !DOMAIN_ARG || d.key === DOMAIN_ARG || d.domainIdInConfig === DOMAIN_ARG);
  if (!targets.length) { console.error(`✘ 未匹配到领域：${DOMAIN_ARG}`); process.exit(1); }

  if (PRUNE_ORPHANS) return runPruneOrphans(targets);
  if (NOUN_FIX) return runNounFix(targets);

  log('============================================================');
  log(`模式：${MOCK ? '离线自检(--mock)' : DRY ? '只扫描(--dry)' : `调用 DeepSeek（${DEEPSEEK_MODEL}）`}`);
  log(`领域：${targets.length} 个 | 每批 ${BATCH} 条 | 串行执行 | 网络重试 ${RETRIES} 次`);
  log('============================================================');

  /* —— 第 0 步：扫描「缺口」+「残缺条目」——
   *   gap    = 领域能召回、但材料里完全没有这个词（卡片背面无内容）
   *   defect = 材料里已有这个词，但 example / exampleZh / story 等字段残缺 */
  const plan = [];
  let totalGap = 0;
  let totalDefect = 0;
  for (const d of targets) {
    let gaps = REPAIR_ONLY ? [] : await scanGaps(d);
    const defects = scanDefects(d);
    const have = Object.keys(d.materials).length;
    let targetNote = '';
    if (USE_TARGETS) {
      const cap = TARGETS[d.domainIdInConfig];
      if (typeof cap === 'number') {
        const budget = Math.max(0, cap - have);
        if (gaps.length > budget) gaps = gaps.slice(0, budget);
        targetNote = gaps.length < budget
          ? ` ｜ 目标 ${cap}（可召回上限 ${have + gaps.length}，以可召回为准）`
          : ` ｜ 目标 ${cap}`;
      }
    }
    totalGap += gaps.length;
    totalDefect += defects.length;
    plan.push({ d, gaps, defects });
    log(`扫描：${d.domainName.padEnd(10)} 材料 ${String(have).padStart(4)} 条 | 领域词缺口 ${String(gaps.length).padStart(4)} 个 | 残缺条目 ${String(defects.length).padStart(4)} 条${targetNote}`);
  }
  log(`\n缺口合计：${totalGap} 个词 ｜ 残缺条目合计：${totalDefect} 条。`);

  if (!totalGap && !totalDefect) {
    log('\n✅ 所有领域既无缺口、也无残缺条目，脚本退出。');
    return;
  }

  /* —— 待办队列（先缺口后残缺，按领域分组成批；--limit 用于小样验证）—— */
  const items = [];
  for (const { d, gaps, defects } of plan) {
    for (const w of gaps) items.push({ d, w, kind: 'gap', fields: null });
    for (const x of defects) items.push({ d, w: x.word, kind: 'defect', fields: x.fields });
  }
  const budget = LIMIT || Infinity;
  const tasks = budget === Infinity ? items : items.slice(0, budget);
  /* ⚠️ 分批时必须**按领域断开**：绝不能让一批里混进两个领域的词，
     否则 AI 结果会写进「批次第一个词所属的领域」，造成跨领域污染。
     规则：领域变了 → 开新批；批满 BATCH → 开新批。 */
  const batches = [];
  let curBatch = null;
  for (const it of tasks) {
    if (!curBatch || curBatch.d !== it.d || curBatch.items.length >= BATCH) {
      curBatch = { d: it.d, domain: it.d, items: [] };
      batches.push(curBatch);
    }
    curBatch.items.push(it);
  }

  log(`待办：${batches.length} 批（每批 ≤ ${BATCH} 条）｜ 缺口 ${items.filter((x) => x.kind === 'gap').length} ｜ 残缺 ${items.filter((x) => x.kind === 'defect').length}`);

  /* —— 队列清单留证据 —— */
  const queueFile = path.join(REPORT_DIR, 'gap-queue.json');
  fs.writeFileSync(queueFile, JSON.stringify({
    at: new Date().toISOString(), totalGap, totalDefect, batchSize: BATCH,
    items: plan.map((p) => ({
      domain: p.d.domainName, id: p.d.domainIdInConfig,
      gaps: p.gaps, defects: p.defects,
    })),
  }, null, 2) + '\n', 'utf8');
  log(`队列清单已写：${path.relative(ROOT, queueFile)}`);

  if (DRY) {
    log('\n（--dry：不联网、不写盘）前 3 批预览：');
    for (const b of batches.slice(0, 3)) {
      log(`   • ${b.domain.domainName}：${b.items.slice(0, 12).map((x) => (x.kind === 'defect' ? `~${x.w}[${x.fields.join('/')}]` : x.w)).join(', ')}${b.items.length > 12 ? ' …' : ''}`);
    }
    return;
  }

  /* —— 核心循环：一批一循环，一批一落盘 —— */
  const started = Date.now();
  let done = 0;
  let failedTotal = 0;
  const created = [];

  for (let i = 0; i < batches.length; i++) {
    const { domain: d, items: batchItems } = batches[i];
    /* 断点续跑：缺口类若已存在则跳过；残缺类若已合格则跳过 */
    /* 一律用 it.d（批次所属领域），保证写入位置与该词的归属领域一致 */
    const todo = batchItems.filter((it) => (
      it.kind === 'gap' ? !it.d.materials[it.w] : defectFields(it.w, it.d.materials[it.w] || {}).length > 0
    ));
    if (!todo.length) {
      log(`[${i + 1}/${batches.length}] ${d.domainName} —— 本批已全部处理，跳过`);
      continue;
    }

    const words = todo.map((it) => it.w);
    log(`[${i + 1}/${batches.length}] ${d.domainName} —— 本批 ${todo.length} 条：${words.slice(0, 10).join(', ')}${words.length > 10 ? ' …' : ''}`);

    const accepted = await fetchValidated(d, words);

    /* 只接受通过红线的结果；逐条再跑一次完整 checkMaterial 作为最后闸门 */
    const rows = [];
    for (const it of todo) {
      const ai = accepted.get(it.w);
      if (!ai) { failedTotal++; continue; }
      let entry;
      let tag;
      if (it.kind === 'gap') {
        entry = buildEntry(it.w, ai, it.d);
        tag = '+';
      } else {
        entry = mergeDefect(it.d.materials[it.w], ai, it.fields);
        tag = '~';
      }
      const problems = checkMaterial(it.d.key, it.w, entry);
      if (problems.length) {
        log(`   ✘ ${it.w}：最终校验未通过，丢弃 → ${problems[0]}`, 'error');
        failedTotal++;
        continue;
      }
      it.d.materials[it.w] = entry;
      rows.push({ w: it.w, kind: it.kind, tag });
    }

    /* —— 每循环一次就写盘 —— */
    if (rows.length) {
      persist(d);
      done += rows.length;
      created.push(...rows.map((r) => ({ domain: d.domainName, file: d.file, word: r.w, kind: r.kind, fields: r.kind === 'defect' ? (todo.find((x) => x.w === r.w)?.fields || []) : null })));
      const nGap = rows.filter((r) => r.kind === 'gap').length;
      const nFix = rows.filter((r) => r.kind === 'defect').length;
      log(`   💾 已写入 ${d.file}（本批 新增 ${nGap} 条 / 修复 ${nFix} 条）`);
    }
    log(`   进度：本批成功 ${rows.length} / ${todo.length} ｜ 累计 ${done} / ${tasks.length} ｜ 失败 ${failedTotal} ｜ 用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  /* —— 收尾：重新扫描，报告剩余 —— */
  log('\n================ 重新扫描核对 ================');
  let remainGap = 0;
  let remainDefect = 0;
  for (const d of targets) {
    const gaps = REPAIR_ONLY ? [] : await scanGaps(d);
    const defects = scanDefects(d);
    remainGap += gaps.length;
    remainDefect += defects.length;
    log(`   ${d.domainName.padEnd(10)} 材料 ${String(Object.keys(d.materials).length).padStart(4)} 条 | 仍缺 ${String(gaps.length).padStart(3)} 个 | 仍残 ${String(defects.length).padStart(3)} 条`);
  }
  const remain = remainGap + remainDefect;

  const summary = {
    at: new Date().toISOString(),
    mode: MOCK ? 'mock' : 'deepseek',
    model: MOCK ? null : DEEPSEEK_MODEL,
    batchSize: BATCH,
    gapBefore: totalGap,
    defectBefore: totalDefect,
    created: created.length,
    fixed: created.filter((x) => x.kind === 'defect').length,
    filled: created.filter((x) => x.kind === 'gap').length,
    failed: failedTotal,
    remain,
    remainGap,
    remainDefect,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    items: created,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rp = path.join(REPORT_DIR, `autoFixGap-${stamp}.json`);
  fs.writeFileSync(rp, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  log('\n================ 汇总 ================');
  log(`开始时 —— 缺口 ${totalGap} 个 ｜ 残缺条目 ${totalDefect} 条`);
  log(`本脚本处理 —— 新增 ${summary.filled} 条 ｜ 修复 ${summary.fixed} 条 ｜ 合计 ${created.length} 条`);
  log(`仍缺 / 失败：${remainGap} 个缺口 + ${remainDefect} 条残缺 = ${remain}`);
  log(`耗时：          ${summary.elapsedSec}s`);
  log(`报告：          ${path.relative(ROOT, rp)}`);
  if (remain > 0) {
    log(`\n⚠️ 仍有 ${remain} 项未处理完。直接把本命令再跑一次即可继续（已补齐 / 已合格的会自动跳过）。`);
  } else {
    log('\n✅ 缺口与残缺条目已全部处理完，脚本退出。');
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((e) => { console.error('✘ 运行失败：', e); process.exit(1); });

export { scanDefects, REPAIR_ONLY };
