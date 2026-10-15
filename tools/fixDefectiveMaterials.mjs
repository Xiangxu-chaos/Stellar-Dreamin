#!/usr/bin/env node
/**
 * fixDefectiveMaterials.mjs —— 精准修复「坏词条」（DeepSeek 驱动）
 * ============================================================================
 * 设计原则（对应用户要求）：
 *   1. **只改坏的那几个字段**：好词条、好字段一个字节都不碰。
 *      - story 不合格  → 只替换 story
 *      - example 不合格 → 只替换 example + exampleZh
 *      - 完全没有材料   → 新建整条（--gap 模式）
 *   2. 红线校验复用 genDomainMaterials.mjs 的 checkMaterial()，与生成器同源，
 *      不合格的结果一律丢弃、重试，绝不写进 JSON。
 *   3. 全程有据可查：修复前后写入 tools/reports/，控制台打印对比。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-xxx node tools/fixDefectiveMaterials.mjs                # 修复全部坏字段
 *   DEEPSEEK_API_KEY=sk-xxx node tools/fixDefectiveMaterials.mjs --gap          # 额外补齐「领域词没有材料」
 *   ... --domain=basketball     只处理一个领域
 *   ... --limit=20              最多处理 N 条（先小样验证）
 *   ... --concurrency=3         并发请求数（默认 2，避免限流）
 *   ... --dry                   只扫描并打印坏词条，不调用 AI、不写盘
 *   ... --mock                  离线自检：用本地假内容跑通全流程（不联网、不消耗额度）
 *
 * ⚠️ 仅开发期使用；运行时（浏览器）永不调用 AI。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/data/domainMaterials');
const REPORT_DIR = path.join(ROOT, 'tools/reports');

const {
  checkMaterial, exampleHasWord, storyLength, VAGUE_PHRASES,
  deepseekChat, hasDeepSeekKey, DEEPSEEK_MODEL,
} = await import('./genDomainMaterials.mjs');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const MOCK = argv.includes('--mock');
const GAP = argv.includes('--gap');
const domainArg = (argv.find((a) => a.startsWith('--domain=')) || '').split('=')[1];
const limit = Number((argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const concurrency = Number((argv.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1] || 2);
const BATCH = Number((argv.find((a) => a.startsWith('--batch=')) || '').split('=')[1] || 6);
const patchArg = (argv.find((a) => a.startsWith('--patch=')) || '').split('=')[1];

/* 补丁模式：内容不来自 AI，而来自一个显式撰写的 JSON 补丁文件。
 * 与 AI 模式共用同一套红线校验、字段级合并、写盘与报告逻辑。 */
let PATCH = null;
if (patchArg) {
  const pp = path.resolve(ROOT, patchArg);
  if (!fs.existsSync(pp)) { console.error(`✘ 找不到补丁文件：${patchArg}`); process.exit(1); }
  PATCH = JSON.parse(fs.readFileSync(pp, 'utf8'));
}

/* ---------------- 本地 fetch shim（供 studyService 在 Node 下读 JSON）----------------
 * ⚠️ 只拦截 file://，其余 URL 透传给原生 fetch（否则 DeepSeek 请求会 404）。 */
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (!s.startsWith('file:')) return nativeFetch(url, init);
  const p = decodeURIComponent(s.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  const txt = fs.readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
};

/* ---------------- 载入领域上下文 ---------------- */
const { INTEREST_DOMAINS } = await import('../src/config/interestsConfig.js');
const CET6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cet6Core.json'), 'utf8'));
const CET6_MAP = new Map((Array.isArray(CET6) ? CET6 : CET6.words).map((w) => [String(w.word).toLowerCase(), w]));

const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const domains = [];
for (const f of FILES) {
  const full = path.join(DIR, f);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  const key = f.replace(/\.json$/, '');
  const cfg = INTEREST_DOMAINS[json.domainIdInConfig] || {};
  domains.push({
    file: f, full, key,
    domainIdInConfig: json.domainIdInConfig,
    domainName: json.domainName || cfg.name || key,
    gameNameEn: json.gameNameEn || '',
    terms: cfg.domainTerms || {},
    materials: json.materials || {},
    raw: json,
  });
}

/* ==========================================================================
 * 一、扫描：找出「坏词条」
 * ======================================================================= */
function scanDefects(d) {
  const out = [];
  for (const [w, m] of Object.entries(d.materials)) {
    const storyBad = [];
    const exBad = [];
    const s = String(m.story || '').trim();
    if (!s) storyBad.push('story 为空');
    else if (storyLength(s) < 15) storyBad.push(`story 仅 ${storyLength(s)} 字`);
    else if (storyLength(s) > 60) storyBad.push(`story 超长 ${storyLength(s)} 字`);
    else {
      const v = VAGUE_PHRASES.find((x) => s.includes(x));
      if (v) storyBad.push(`story 含空泛话术「${v}」`);
    }
    const ex = String(m.example || '').trim();
    if (!ex) exBad.push('example 为空');
    else if (!exampleHasWord(w, ex)) exBad.push('example 未含该单词');
    if (!String(m.exampleZh || '').trim()) exBad.push('exampleZh 为空');
    if (storyBad.length || exBad.length) out.push({ w, m, storyBad, exBad });
  }
  return out;
}

async function scanGaps(d) {
  const s = (await import(pathToFileURL(path.join(ROOT, 'src/services/studyService.js')).href)).default;
  const r = await s.buildRelatedWords(d.domainIdInConfig, { localLimit: 800 });
  const words = r.words.map((x) => x.word);
  const have = new Set(Object.keys(d.materials));
  return words.filter((w) => !have.has(w));
}

/* ==========================================================================
 * 二、Prompt 构建
 * ======================================================================= */
function termsBlock(d, max = 40) {
  const entries = Object.entries(d.terms).slice(0, max);
  if (!entries.length) return '（无）';
  return entries.map(([en, zh]) => `- ${en} → ${zh}`).join('\n');
}

function wordLine(w) {
  const c = CET6_MAP.get(w);
  const t = c ? String(c.translation || '').replace(/\n/g, ' ').slice(0, 40) : '';
  return `- ${w}${t ? `（六级释义：${t}）` : ''}`;
}

function buildMessages(d, words, mode) {
  const sample = Object.values(d.terms)[0] || d.domainName;
  const system = [
    '你是一名资深领域内容作者 + 英语词汇专家，为一个「用兴趣领域记忆六级单词」的学习产品撰写记忆材料。',
    '只输出 JSON 对象，不要解释、不要 markdown 代码块、不要多余文字。',
  ].join('\n');

  const ask = mode === 'story-example'
    ? '为下列每个单词重写「微故事 story」「英文例句 example」「例句翻译 exampleZh」三项。其余字段不用管。'
    : '为下列每个单词撰写完整的记忆材料。';

  const user = [
    `领域：${d.domainName}${d.gameNameEn ? `（${d.gameNameEn}）` : ''}`,
    '',
    '该领域官方中文专有名词参照表（写故事和例句时优先使用这些译名）：',
    termsBlock(d),
    '',
    ask,
    '',
    '单词列表：',
    words.map(wordLine).join('\n'),
    '',
    '输出 JSON 结构：',
    mode === 'story-example'
      ? '{"items":[{"word":"单词","story":"微故事","example":"英文例句","exampleZh":"例句翻译"}]}'
      : '{"items":[{"word":"单词","root":"词根/派生说明","generalMeaning":"通用中文释义","domainMeaning":"该词在本领域中的具体含义","story":"微故事","example":"英文例句","exampleZh":"例句翻译"}]}',
    '',
    '硬性要求（不满足会被程序丢弃）：',
    `1. story：15–60 个汉字（含标点）。必须是本领域里的**具体场景、具体事件或具体机制**，`,
    '   让人一眼看出是这个领域。禁止出现「较为常见」「可用以」「可联想」「可以建立」',
    '   「可与游戏场景建立联想」「可结合场景」「与之相关」「值得一提」「众所周知」这类空泛套话。',
    '2. example：英文句子，**必须原样包含该单词**（不区分大小写；允许 -ing/-ed/-s 等常规变形），',
    `   并尽量包含 1 个本领域专有名词（例如 ${sample}）。必须是语法完整的句子。`,
    '3. exampleZh：example 的准确中文翻译。',
    '4. 不要编造不存在的官方译名；不确定的专有名词宁可不用。',
  ].join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/* ==========================================================================
 * 三、解析 AI 返回
 * ======================================================================= */
function parseItems(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
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

/* ---------------- 离线自检用假内容（--mock，不联网）---------------- */
function mockItems(words, d, mode) {
  const map = new Map();
  const proper = Object.values(d.terms)[0] || d.domainName;
  for (const w of words) {
    map.set(w, mode === 'story-example'
      ? {
        word: w,
        story: `【自检样本】${d.domainName}里，${proper}这一局的关键就压在 ${w} 上，一着不慎满盘皆输。`,
        example: `In ${d.domainName}, the outcome of the ${proper} round turned on how well they handled the ${w}.`,
        exampleZh: `在${d.domainName}里，${proper}那一局的胜负，取决于他们把这个词对应的东西处理得多好。`,
      }
      : {
        word: w,
        root: `派生自 ${w}`,
        generalMeaning: '（自检样本）通用释义',
        domainMeaning: `（自检样本）${d.domainName}中的具体含义`,
        story: `【自检样本】${d.domainName}里，${proper}这一局的关键就压在 ${w} 上，一着不慎满盘皆输。`,
        example: `In ${d.domainName}, the outcome of the ${proper} round turned on how well they handled the ${w}.`,
        exampleZh: `在${d.domainName}里，${proper}那一局的胜负，取决于他们把这个词对应的东西处理得多好。`,
      });
  }
  return map;
}

/* ==========================================================================
 * 四、主流程
 * ======================================================================= */
async function callAI(d, words, mode) {
  if (PATCH) {
    const src = PATCH[d.key] || {};
    const map = new Map();
    for (const w of words) {
      const it = src[w];
      if (it) map.set(w, { word: w, ...it });
    }
    return map.size ? map : null;
  }
  if (MOCK) return mockItems(words, d, mode);
  const text = await deepseekChat(buildMessages(d, words, mode), { json: true, temperature: 0.8, maxTokens: 4000 });
  return parseItems(text);
}

function isUsable(w, it, mode, needStory, needExample) {
  if (!it) return false;
  if (needStory) {
    const s = String(it.story || '').trim();
    if (!s || storyLength(s) < 15 || storyLength(s) > 60) return false;
    if (VAGUE_PHRASES.some((v) => s.includes(v))) return false;
  }
  if (needExample) {
    if (!String(it.example || '').trim() || !exampleHasWord(w, it.example)) return false;
    if (!String(it.exampleZh || '').trim()) return false;
  }
  return true;
}

async function main() {
  if (!DRY && !MOCK && !PATCH && !hasDeepSeekKey()) {
    console.error('✘ 缺少 DEEPSEEK_API_KEY。');
    console.error('  用法：DEEPSEEK_API_KEY=sk-xxx node tools/fixDefectiveMaterials.mjs');
    console.error('  或：  node tools/fixDefectiveMaterials.mjs --patch=tools/patches/xxx.json');
    console.error('  或把 Key 单独写进项目根目录的 .deepseek-key 文件（不要提交到版本库）。');
    process.exit(1);
  }

  const targets = domains.filter((d) => !domainArg || d.key === domainArg || d.domainIdInConfig === domainArg);
  if (!targets.length) { console.error(`✘ 未匹配到领域：${domainArg}`); process.exit(1); }

  const modeLabel = PATCH ? `补丁文件(--patch=${patchArg})`
    : MOCK ? '离线自检(--mock)'
      : DRY ? '只扫描(--dry)' : `调用 DeepSeek(${DEEPSEEK_MODEL})`;
  console.log(`模式：${modeLabel}`);
  console.log(`领域：${targets.map((d) => d.domainName).join('、')}\n`);

  const changes = [];      // 供报告
  let fixedEntries = 0;    // 修复的条目数
  let fixedFields = 0;     // 修复的字段数
  let createdEntries = 0;  // 新建条目数

  for (const d of targets) {
    const defects = scanDefects(d);
    let queue = defects.map((x) => ({ w: x.w, m: x.m, storyBad: x.storyBad, exBad: x.exBad, isNew: false }));

    if (GAP) {
      const gaps = await scanGaps(d);
      queue = queue.concat(gaps.map((w) => ({ w, m: null, storyBad: ['无材料'], exBad: ['无材料'], isNew: true })));
    }

    /* 补丁文件中显式给出的额外覆盖（例如老库里按严格口径仍算缺词的例句） */
    if (PATCH && PATCH[d.key]) {
      for (const [w, it] of Object.entries(PATCH[d.key])) {
        if (w.startsWith('_')) continue;
        if (queue.some((x) => x.w === w)) continue;
        const m = d.materials[w];
        if (!m) continue;
        queue.push({
          w, m, isNew: false,
          storyBad: it.story ? ['显式覆盖'] : [],
          exBad: it.example ? ['显式覆盖'] : [],
        });
      }
    }

    if (limit) queue = queue.slice(0, limit);

    console.log(`—— ${d.domainName}（${d.key}）—— 坏词条 ${defects.length} 条` +
      (GAP ? `，缺材料 ${queue.length - defects.length} 条` : '') +
      `，本次处理 ${queue.length} 条`);

    if (!queue.length) continue;
    if (DRY) {
      for (const q of queue.slice(0, 10)) {
        console.log(`   • ${q.w}：${[...q.storyBad, ...q.exBad].join('；')}`);
        if (q.m && q.m.story) console.log(`     story="${q.m.story}"`);
        if (q.m && q.m.example) console.log(`     example="${q.m.example}"`);
      }
      if (queue.length > 10) console.log(`   … 另有 ${queue.length - 10} 条`);
      continue;
    }

    /* —— 分批调用 —— */
    const batches = [];
    for (let i = 0; i < queue.length; i += BATCH) batches.push(queue.slice(i, i + BATCH));

    const results = new Map();
    let bi = 0;
    const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (bi < batches.length) {
        const idx = bi++;
        const batch = batches[idx];
        const words = batch.map((x) => x.w);
        const mode = batch.every((x) => x.m && !x.isNew) ? 'story-example' : 'full';
        try {
          const map = await callAI(d, words, mode);
          if (map) for (const [w, it] of map) results.set(w, it);
          process.stdout.write(`   批次 ${idx + 1}/${batches.length} 完成（${words.length} 词）\n`);
        } catch (e) {
          console.error(`   批次 ${idx + 1}/${batches.length} 失败：${e.message}`);
        }
      }
    });
    await Promise.all(workers);

    /* —— 校验 + 单条重试 —— */
    for (const q of queue) {
      const needStory = q.storyBad.length > 0;
      const needExample = q.exBad.length > 0;
      let it = results.get(q.w);
      if (!isUsable(q.w, it, q.isNew ? 'full' : 'story-example', needStory, needExample)) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const map = await callAI(d, [q.w], q.isNew ? 'full' : 'story-example');
            const cand = map && map.get(q.w);
            if (isUsable(q.w, cand, q.isNew ? 'full' : 'story-example', needStory, needExample)) { it = cand; break; }
          } catch { /* 继续重试 */ }
        }
      }
      if (!isUsable(q.w, it, q.isNew ? 'full' : 'story-example', needStory, needExample)) {
        console.error(`   ✘ ${q.w}：重写后仍不达标，已丢弃（保持原样）`);
        continue;
      }

      /* —— 只改坏的字段 —— */
      const before = q.m ? { ...q.m } : null;
      const next = q.m ? { ...q.m } : {
        root: String(it.root || `派生自 ${q.w}`).trim(),
        generalMeaning: String(it.generalMeaning || '').trim(),
        domainMeaning: String(it.domainMeaning || '').trim(),
        imageUrl: '',
        source: `${d.domainName}官方中文（AI 补充，待复核）`,
        unverified: true,
        exampleSource: 'AI 生成',
      };
      const touched = [];
      if (needStory) { next.story = String(it.story).trim(); touched.push('story'); }
      if (needExample) {
        next.example = String(it.example).trim();
        next.exampleZh = String(it.exampleZh).trim();
        touched.push('example', 'exampleZh');
      }
      if (q.isNew) {
        for (const f of ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh']) {
          if (!String(next[f] || '').trim()) next[f] = String(it[f] || '').trim();
        }
        touched.push('root', 'generalMeaning', 'domainMeaning');
      }
      if (q.isNew) {
        next.story = String(it.story).trim();
        next.example = String(it.example).trim();
        next.exampleZh = String(it.exampleZh).trim();
      }

      /* —— 写回前的最后一道闸门：只针对「本次实际修改的字段」——
       * 老库可能缺少 exampleSource / unverified 等历史字段，
       * 只要不是本次要改的字段，就不该阻止这次 story/example 修复。 */
      const problems = checkMaterial(d.key, q.w, next);
      const touchedSet = new Set(touched);
      const blocking = problems.filter((p) => {
        if (p.includes('.exampleSource')) return false;           // 历史字段，与本次修复无关
        if (p.includes('.story')) return touchedSet.has('story');
        if (p.includes('.exampleZh') || p.includes('例句')) return touchedSet.has('example');
        if (p.includes('.imageUrl') || p.includes('.unverified') || p.includes('.source')) return q.isNew;
        return q.isNew;                                           // root / 释义等只在新建时校验
      });
      if (blocking.length) {
        console.error(`   ✘ ${q.w}：最终校验未通过，已丢弃 → ${blocking[0]}`);
        continue;
      }

      d.materials[q.w] = next;
      const rec = {
        domain: d.domainName, file: d.file, word: q.w, fields: [...new Set(touched)], isNew: q.isNew,
        before: before ? { story: before.story, example: before.example, exampleZh: before.exampleZh } : null,
        after: { story: next.story, example: next.example, exampleZh: next.exampleZh },
      };
      changes.push(rec);
      if (q.isNew) createdEntries++; else fixedEntries++;
      fixedFields += new Set(touched).size;
    }
  }

  /* —— 写盘 —— */
  if (!DRY) {
    const byFile = new Map();
    for (const c of changes) byFile.set(c.file, true);
    for (const f of byFile.keys()) {
      const d = domains.find((x) => x.file === f);
      const body = JSON.stringify({ ...d.raw, materials: d.materials }, null, 2) + '\n';
      fs.writeFileSync(d.full, body, 'utf8');
      console.log(`💾 已写入 ${f}`);
    }
  }

  /* —— 报告 —— */
  if (!DRY && changes.length) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rp = path.join(REPORT_DIR, `fix-${stamp}.json`);
    fs.writeFileSync(rp, JSON.stringify({
      mode: MOCK ? 'mock' : 'deepseek', model: MOCK ? null : DEEPSEEK_MODEL,
      at: new Date().toISOString(), fixedEntries, createdEntries, fixedFields, changes,
    }, null, 2), 'utf8');
    console.log(`\n📄 报告：${path.relative(ROOT, rp)}`);
  }

  /* —— 汇总 —— */
  console.log('\n================ 汇总 ================');
  console.log(`修复坏字段的条目：${fixedEntries} 条`);
  console.log(`新建整条材料：  ${createdEntries} 条`);
  console.log(`改动字段总数：  ${fixedFields} 个`);
  if (changes.length) {
    console.log('\n修复前后对比（前 10 条）：');
    for (const c of changes.slice(0, 10)) {
      console.log(`\n[${c.domain} / ${c.word}] 字段：${c.fields.join(', ')}`);
      if (c.before) {
        console.log(`  修前 story  : ${c.before.story || '（空）'}`);
        console.log(`  修后 story  : ${c.after.story}`);
        if (c.fields.includes('example')) {
          console.log(`  修前 example: ${c.before.example || '（空）'}`);
          console.log(`  修后 example: ${c.after.example}`);
        }
      } else {
        console.log(`  （新建）story  : ${c.after.story}`);
        console.log(`  （新建）example: ${c.after.example}`);
      }
    }
  }
}

main().catch((e) => { console.error('✘ 运行失败：', e.message); process.exit(1); });
