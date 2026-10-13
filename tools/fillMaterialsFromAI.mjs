/**
 * 批量补全领域材料（调用 DeepSeek / OpenAI 兼容 API）
 * ============================================================================
 * 用法：
 *   1. 把 API Key 写入 tools/.ai-key（一行，仅 key 本身）或设置环境变量 DEEPSEEK_API_KEY
 *   2. node tools/fillMaterialsFromAI.mjs --domain honor_of_kings --limit 50
 *      可反复运行，已生成的词会自动跳过（增量续跑）。
 *
 * 设计：
 *   - 分批（默认每批 8 个词一次请求）→ 控制 token、避免超时
 *   - 每批成功立即落盘 → 中断也不丢已生成内容
 *   - 例句必须含该词：本地校验，不合格的进 retry 列表
 *   - 只增不覆盖：已存在的词条不动
 * ============================================================================
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL_DIR = path.join(ROOT, 'src/data/domainMaterials');

/* ---------------- 参数 ---------------- */
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const ONLY_DOMAIN = arg('domain', null);
const LIMIT = Number(arg('limit', '999999'));
const BATCH = Number(arg('batch', '8'));
const MODEL = arg('model', 'deepseek-chat');
const BASE = arg('base', 'https://api.deepseek.com');
const REDO = arg('redo', null);   // --redo w1,w2 强制重做指定词

/* ---------------- Key ---------------- */
function loadKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const f = path.join(ROOT, 'tools/.ai-key');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  throw new Error('未找到 API Key：请写入 tools/.ai-key 或设置 DEEPSEEK_API_KEY 环境变量');
}

/* ---------------- 领域元信息 ---------------- */
const DOMAIN_META = {
  honor_of_kings: { file: 'honorOfKings', zh: '王者荣耀', en: 'Honor of Kings', flavor: 'MOBA 对局：分路、防御塔、水晶、打野、团战、段位' },
  slay_the_spire: { file: 'slayTheSpire', zh: '杀戮尖塔', en: 'Slay the Spire', flavor: '卡牌构筑 Roguelike：能量、卡组、遗物、精英战、进阶难度' },
  hollow_knight: { file: 'hollowKnight', zh: '空洞骑士', en: 'Hollow Knight', flavor: '类银河恶魔城：圣巢、护符、吉欧、Boss 战、地图探索' },
  valorant: { file: 'valorant', zh: '无畏契约', en: 'VALORANT', flavor: '战术射击：特工技能、下包、回合经济、枪械、点位控制' },
};

const key = loadKey();

/* ---------------- prompt ---------------- */
function buildPrompt(domainId, items) {
  const m = DOMAIN_META[domainId];
  const list = items.map((it, i) => `${i + 1}. ${it.word}（通用释义：${it.translation || '略'}${it.domainTermZh ? '；领域术语：' + it.domainTermZh : ''}）`).join('\n');
  return `你是英语单词记忆材料生成助手。为下面的单词各生成一条记忆材料，语境贴合游戏《${m.zh}》（${m.en}）。

游戏语境参考：${m.flavor}

单词列表：
${list}

严格要求：
1. 只输出一个 JSON 对象，结构为 {"materials": {"<单词小写>": {...}, ...}}，不要任何解释、不要 markdown 代码块。
2. 每个词条必须包含且仅包含这 6 个字符串字段：
   - root: 词根/派生说明（如 "拉丁语 ascendere（上升）"），不确定就写 "核心词"
   - generalMeaning: 通用释义，必须准确，格式如 "n. 上升，登高"（词性 + 中文）
   - domainMeaning: 该词在《${m.zh}》里为什么会被匹配到，用"该词在${m.zh}中常用于描述……"这类句式，说明游戏场景
   - story: 一句**纯中文**微故事/场景联想（<=30 字），贴合游戏；**不要在中文句子里夹英文单词**
   - example: **一个英文例句，必须包含该单词本身**（原词或其合法变形），语境贴合该游戏，长度 8~20 词
   - exampleZh: 上一句的准确中文翻译
3. example 里必须出现该单词；exampleZh 必须与 example 对应。
4. 禁止编造官方译名；不确定的领域译名不要写进 domainMeaning。
5. story 必须是通顺的纯中文，不要出现英文单词（example 字段除外）。
6. 只输出 JSON。`;
}

/* ---------------- 调用 API ---------------- */
async function callAI(prompt) {
  const res = await fetch(`${BASE.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你只输出合法 JSON，不输出任何其他内容。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); }
  catch { try { return JSON.parse(s.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')); } catch { return null; } }
}

/* ---------------- 校验 ---------------- */
/** 词形匹配：例句里出现原词、或它的合法变形（-s/-es/-ed/-ing/-d 等）都算命中 */
function exampleHasWord(example, word) {
  const ex = String(example || '').toLowerCase();
  const w = String(word || '').toLowerCase().trim();
  if (!w) return false;
  if (ex.includes(w)) return true;
  const stems = new Set([w]);
  for (const suf of ['ing', 'edly', 'ied', 'ed', 'es', 's', 'd']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) stems.add(w.slice(0, w.length - suf.length));
  }
  // 去尾 e：defuse → defus（覆盖 defusing / defused）
  if (w.endsWith('e')) stems.add(w.slice(0, -1));
  for (const s of [...stems]) if (/([bdfglmnprt])\1$/.test(s)) stems.add(s.slice(0, -1));
  const tokens = ex.split(/[^a-z']+/).filter(Boolean);
  for (const t of tokens) {
    if (stems.has(t)) return true;
    for (const s of stems) if (s.length >= 4 && (t.startsWith(s) || s.startsWith(t))) return true;
  }
  return false;
}

function validate(entry, word) {
  const need = ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh'];
  for (const k of need) {
    if (typeof entry?.[k] !== 'string' || !entry[k].trim()) return `缺字段 ${k}`;
  }
  if (!exampleHasWord(entry.example, word)) return '例句不含该词';
  return null;
}

/* ---------------- 主流程 ---------------- */
const missingAll = JSON.parse(readFileSync(path.join(ROOT, 'tools/_missing.json'), 'utf8'));
const domains = ONLY_DOMAIN ? [ONLY_DOMAIN] : Object.keys(DOMAIN_META);

let totalAdded = 0;
for (const domainId of domains) {
  const meta = DOMAIN_META[domainId];
  if (!meta) { console.warn('跳过未知领域', domainId); continue; }
  const file = path.join(MATERIAL_DIR, meta.file + '.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const have = new Set(Object.keys(json.materials || {}).map((w) => w.toLowerCase()));

  const todo = (missingAll[domainId]?.missing || [])
    .filter((it) => REDO ? REDO.split(',').map((s) => s.trim().toLowerCase()).includes(it.word.toLowerCase()) : !have.has(it.word.toLowerCase()))
    .slice(0, LIMIT);

  console.log(`\n=== ${domainId}：待补 ${todo.length} 词（已有 ${have.size}）===`);
  let added = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    let parsed = null;
    let err = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        parsed = await callAI(buildPrompt(domainId, chunk));
        if (parsed?.materials) break;
        err = '返回结构不正确';
      } catch (e) { err = e.message; }
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
    if (!parsed?.materials) {
      console.warn(`  [批 ${i}-${i + chunk.length}] 失败：${err}`);
      continue;
    }
    let okN = 0;
    for (const it of chunk) {
      const keyName = Object.keys(parsed.materials).find((k) => k.toLowerCase() === it.word.toLowerCase());
      const entry = keyName ? parsed.materials[keyName] : null;
      const bad = validate(entry, it.word);
      if (bad) { console.warn(`  ✗ ${it.word}: ${bad}`); continue; }
      json.materials[it.word.toLowerCase()] = {
        root: entry.root.trim(),
        generalMeaning: entry.generalMeaning.trim(),
        domainMeaning: entry.domainMeaning.trim(),
        story: entry.story.trim(),
        example: entry.example.trim(),
        exampleZh: entry.exampleZh.trim(),
        imageUrl: '',
        source: `AI 生成（${new Date().toISOString().slice(0, 10)}）`,
        unverified: false,
      };
      okN++;
    }
    added += okN;
    totalAdded += okN;
    // 每批立即落盘
    json.materialsVersion = (json.materialsVersion || 1) + 1;
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`  批 ${Math.floor(i / BATCH) + 1}: +${okN}/${chunk.length}（本领域累计 ${added}，落盘 ${Object.keys(json.materials).length}）`);
  }
  console.log(`=== ${domainId} 完成：新增 ${added}，现共 ${Object.keys(json.materials).length} ===`);
}
console.log(`\n合计新增 ${totalAdded} 条`);
