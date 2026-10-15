#!/usr/bin/env node
/**
 * verifyMaterialQuality.mjs —— 领域材料质量 + 生成器硬性拦截规则
 * ============================================================================
 * 锁死三件事：
 *   A. 磁盘上 8 个新领域 JSON 的每条材料都合格
 *      （story ∈ [15,60] 字、无空泛话术、example 含该单词、必填字段非空）
 *   B. genDomainMaterials.mjs 导出的 validate() 能识别各类坏数据
 *   C. 生成器 CLI 在遇到坏数据时「报错退出且一个字都不写盘」（真实子进程验证）
 *
 * 运行：node tools/verifyMaterialQuality.mjs
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  STORY_MIN, STORY_MAX, VAGUE_PHRASES, storyLength, validate,
} from './genDomainMaterials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/data/domainMaterials');

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`${name}${detail ? ' → ' + detail : ''}`);
}

/* 8 个新领域（原始四领域不在本次范围内） */
const NEW_FILES = {
  slayTheSpire2: '杀戮尖塔2',
  arknights: '明日方舟',
  genshinImpact: '原神',
  breakingBad: '绝命毒师',
  sherlock: '神探夏洛克',
  classicMovies: '经典电影',
  basketball: '篮球',
  badminton: '羽毛球',
};

const REQUIRED_FIELDS = ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh', 'source', 'exampleSource'];

function exampleHasWord(example, word) {
  const bare = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
  const ex = String(example).toLowerCase().replace(/[^a-zA-Z]/g, '');
  const stem = bare.replace(/e$/, '');
  return ex.includes(bare) || (stem.length >= 5 && ex.includes(stem));
}

/* ==========================================================================
 * A. 磁盘数据检查
 * ======================================================================= */
console.log('—— A. 磁盘数据质量 ——');
let grand = 0;
const allEntries = [];
for (const [file, cn] of Object.entries(NEW_FILES)) {
  const p = path.join(DIR, `${file}.json`);
  ok(`A0. ${file}.json 存在`, fs.existsSync(p));
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const mats = j.materials || {};
  const keys = Object.keys(mats);
  grand += keys.length;
  let bad = 0;

  for (const k of keys) {
    const m = mats[k];
    allEntries.push({ file, word: k, m });
    /* 必填字段非空 */
    for (const f of REQUIRED_FIELDS) {
      if (typeof m[f] !== 'string' || !m[f].trim()) { bad++; failures.push(`${file}/${k}.${f} 为空`); }
    }
    if (m.imageUrl !== '') { bad++; failures.push(`${file}/${k}.imageUrl 非空串`); }
    if (typeof m.unverified !== 'boolean') { bad++; failures.push(`${file}/${k}.unverified 非 boolean`); }

    /* story 字数 */
    const len = storyLength(m.story);
    if (len < STORY_MIN || len > STORY_MAX) { bad++; failures.push(`${file}/${k}.story ${len} 字越界`); }

    /* story 空泛话术 */
    const v = VAGUE_PHRASES.find((x) => String(m.story).includes(x));
    if (v) { bad++; failures.push(`${file}/${k}.story 含空泛话术「${v}」`); }

    /* example 含该词 */
    if (!exampleHasWord(m.example, k)) { bad++; failures.push(`${file}/${k}.example 不含该词`); }
  }

  ok(`A1. ${cn}（${file}）全部 ${keys.length} 条合格`, bad === 0, bad ? `${bad} 项问题` : '');
  /* 抽查：不得出现「暂无例句」这类占位文案 */
  const placeholder = keys.filter((k) => /暂无例句|待补充|TODO|占位/.test(String(mats[k].example) + String(mats[k].story)));
  ok(`A2. ${cn} 无「暂无例句 / 待补充」占位`, placeholder.length === 0, placeholder.join(', '));
}
ok('A3. 8 个新领域材料总量 ≥ 200 条', grand >= 200, `${grand} 条`);
console.log(`   8 个新领域共 ${grand} 条材料`);

/* story 长度整体分布 */
const lens = allEntries.map((e) => storyLength(e.m.story));
ok('A4. 全库 story 最短 ≥ 15 字', Math.min(...lens) >= STORY_MIN, `最短 ${Math.min(...lens)} 字`);
ok('A5. 全库 story 最长 ≤ 60 字', Math.max(...lens) <= STORY_MAX, `最长 ${Math.max(...lens)} 字`);

/* ==========================================================================
 * A6~A9. 全库 12 个文件统一红线（含原始四领域）
 *   2026-10-15：老库的 story 空/过短问题已全部修复，因此不再豁免。
 *   唯一例外：exampleSource 是后加的历史字段，原始三库尚无（渲染层有兜底）。
 * ======================================================================= */
console.log('—— A6~A9. 全库统一红线（12 个文件）——');
const ALL = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const LEGACY_WITHOUT_EXAMPLE_SOURCE = new Set(['honorOfKings.json', 'slayTheSpire.json', 'valorant.json']);

let badStory = []; let badVague = []; let badExample = []; let badRequired = [];
let totalAll = 0;
for (const f of ALL) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const [w, m] of Object.entries(j.materials || {})) {
    totalAll++;
    const len = storyLength(m.story);
    if (len < STORY_MIN || len > STORY_MAX) badStory.push(`${f}/${w}(${len})`);
    const v = VAGUE_PHRASES.find((x) => String(m.story).includes(x));
    if (v) badVague.push(`${f}/${w}「${v}」`);
    if (!exampleHasWord(m.example, w)) badExample.push(`${f}/${w}`);
    for (const fld of ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh', 'source']) {
      if (typeof m[fld] !== 'string' || !m[fld].trim()) badRequired.push(`${f}/${w}.${fld}`);
    }
    if (f === 'hollowKnight.json' || !LEGACY_WITHOUT_EXAMPLE_SOURCE.has(f)) {
      if (typeof m.exampleSource !== 'string' || !m.exampleSource.trim()) badRequired.push(`${f}/${w}.exampleSource`);
    }
    if (m.imageUrl !== '') badRequired.push(`${f}/${w}.imageUrl`);
  }
}
ok('A6. 全库 story 字数均在 [15, 60]', badStory.length === 0, badStory.slice(0, 8).join(', '));
ok('A7. 全库 story 无空泛话术', badVague.length === 0, badVague.slice(0, 8).join(', '));
ok('A8. 全库 example 均含该单词', badExample.length === 0, badExample.slice(0, 8).join(', '));
ok('A9. 全库必填字段非空 / imageUrl 为空串', badRequired.length === 0, badRequired.slice(0, 8).join(', '));
console.log(`   全库合计 ${totalAll} 条`);

/* ==========================================================================
 * B. validate() 单测
 * ======================================================================= */
console.log('—— B. validate() 规则单测 ——');

const SAMPLE_WORDS = ['amber', 'bravo', 'cedar', 'delta', 'eagle', 'flint', 'grape', 'hotel', 'ivory', 'jolly',
  'knack', 'lemon', 'mango', 'noble', 'ocean', 'piano', 'quilt', 'raven', 'sugar', 'tango'];

const GOOD = {
  domainName: '测试域',
  materials: Object.fromEntries(SAMPLE_WORDS.map((w) => [w, {
    root: w,
    generalMeaning: 'n. 词',
    domainMeaning: '释义',
    story: '这是一段足够长的微故事，用来通过字数下限校验。',
    example: `The ${w} appears right here in this sentence.`,
    exampleZh: '例句翻译。',
    exampleSource: 'AI 生成',
    imageUrl: '',
    source: '测试来源',
    unverified: false,
  }])),
};
ok('B0. 合法样本 validate() 无问题', validate('t', GOOD).length === 0, validate('t', GOOD).join(' | '));

function mutate(fn) {
  const clone = JSON.parse(JSON.stringify(GOOD));
  fn(clone.materials[SAMPLE_WORDS[0]]);
  return validate('t', clone);
}

const cases = [
  ['B1. story 为空 → 报错', (m) => { m.story = ''; }, '为空'],
  ['B2. story 仅 14 字 → 报错', (m) => { m.story = '一二三四五六七八九十一二三四'; }, 'story 仅'],
  ['B3. story 含「常见」→ 报错', (m) => { m.story = '这个词在游戏语境中较为常见，可以联想一下。'; }, '空泛话术'],
  ['B4. story 含「可用以」→ 报错', (m) => { m.story = '该词可用以描述某种动作，凑够十五个字。'; }, '空泛话术'],
  ['B5. story 含「可以建立」→ 报错', (m) => { m.story = '看到这个词，你可以建立与场景之间的联系。'; }, '空泛话术'],
  ['B6. example 为空 → 报错', (m) => { m.example = ''; }, '为空'],
  ['B7. example 不含该词 → 报错', (m) => { m.example = 'This sentence deliberately omits the target token entirely.'; }, '不含该单词'],
  ['B8. story 超过 60 字 → 报错', (m) => { m.story = '很'.repeat(61); }, '≤ 60'],
  ['B9. domainMeaning 为空 → 报错', (m) => { m.domainMeaning = ''; }, '为空'],
];
for (const [name, fn, expect] of cases) {
  const probs = mutate(fn);
  ok(name, probs.length > 0 && probs.some((p) => p.includes(expect)), probs.join(' | ') || '未报错');
}
/* 反向：合规样本不得被误判 */
ok('B10. 合规故事（≥15 字、无话术）不触发 story 规则',
  !mutate((m) => { m.story = '亡灵契约师把躯体当作容器，装得下多少灵魂，就敢挑战多深的尖塔。'; })
    .some((p) => p.includes('story')), '被误判');

/* ==========================================================================
 * C. CLI 拦截：坏数据 → exit(1) 且不写盘（真实子进程）
 * ======================================================================= */
console.log('—— C. CLI 拦截（真实子进程）——');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'genbad-'));
const tmpTools = path.join(TMP, 'tools');
const tmpOut = path.join(TMP, 'src/data/domainMaterials');
fs.mkdirSync(tmpTools, { recursive: true });
fs.mkdirSync(tmpOut, { recursive: true });

const srcGen = fs.readFileSync(path.join(ROOT, 'tools/genDomainMaterials.mjs'), 'utf8');

/* C1：把生成器原样搬到临时目录，跑篮球 → 应成功写盘 */
fs.writeFileSync(path.join(tmpTools, 'genDomainMaterials.mjs'), srcGen, 'utf8');
let r = spawnSync(process.execPath, [path.join(tmpTools, 'genDomainMaterials.mjs'), '--domain=basketball'], { encoding: 'utf8' });
ok('C1. 合规数据 CLI 退出码 0', r.status === 0, `status=${r.status} ${r.stderr.slice(0, 120)}`);
ok('C2. 合规数据确实写盘', fs.existsSync(path.join(tmpOut, 'basketball.json')));

/* C2：注入一条「只有 3 个字」的坏 story → 必须 exit(1) 且不写盘 */
const broken = srcGen.replace(
  "      '进攻能帮你赢下常规赛，但真正把冠军奖杯带回家的，永远是防守。',",
  "      '防守。',",
);
ok('C3. 负向样本注入成功（源码确实被改动）', broken !== srcGen);
fs.writeFileSync(path.join(tmpTools, 'genDomainMaterials.mjs'), broken, 'utf8');
fs.rmSync(path.join(tmpOut, 'basketball.json'), { force: true });
r = spawnSync(process.execPath, [path.join(tmpTools, 'genDomainMaterials.mjs'), '--domain=basketball'], { encoding: 'utf8' });
ok('C4. 坏数据 CLI 退出码非 0', r.status !== 0, `status=${r.status}`);
ok('C5. 坏数据被拦截时「一个字都不写盘」', !fs.existsSync(path.join(tmpOut, 'basketball.json')), '竟然写了盘');
ok('C6. 报错信息指出 story 字数问题', /story 仅 \d+ 字/.test(r.stderr), r.stderr.slice(0, 200));

/* C3：注入空泛话术 → 必须 exit(1) */
const vague = srcGen.replace(
  "      '进攻能帮你赢下常规赛，但真正把冠军奖杯带回家的，永远是防守。',",
  "      '这个词在篮球语境里较为常见，可用以描述防守动作。',",
);
fs.writeFileSync(path.join(tmpTools, 'genDomainMaterials.mjs'), vague, 'utf8');
r = spawnSync(process.execPath, [path.join(tmpTools, 'genDomainMaterials.mjs'), '--domain=basketball'], { encoding: 'utf8' });
ok('C7. 空泛话术 CLI 退出码非 0', r.status !== 0, `status=${r.status}`);
ok('C8. 报错信息指出空泛话术', /空泛话术/.test(r.stderr), r.stderr.slice(0, 200));
ok('C9. 空泛话术同样不写盘', !fs.existsSync(path.join(tmpOut, 'basketball.json')));

/* C4：注入 example 不含该词的条目 → 必须 exit(1) */
const noWord = srcGen.replace(
  "'Their defense held the NBA champions under 90 points for the first time.'",
  "'Their game plan stopped the NBA champions for the first time.'",
);
fs.writeFileSync(path.join(tmpTools, 'genDomainMaterials.mjs'), noWord, 'utf8');
r = spawnSync(process.execPath, [path.join(tmpTools, 'genDomainMaterials.mjs'), '--domain=basketball'], { encoding: 'utf8' });
ok('C10. example 缺词 CLI 退出码非 0', r.status !== 0, `status=${r.status}`);
ok('C11. 报错信息指出例句不含该词', /例句不含该单词/.test(r.stderr), r.stderr.slice(0, 200));

fs.rmSync(TMP, { recursive: true, force: true });

/* ==========================================================================
 * D. 生成器源码常量
 * ======================================================================= */
console.log('—— D. 生成器常量 ——');
ok('D1. STORY_MIN === 15', STORY_MIN === 15, String(STORY_MIN));
ok('D2. STORY_MAX === 60', STORY_MAX === 60, String(STORY_MAX));
ok('D3. 空泛话术黑名单覆盖用户点名的三类',
  ['常见', '可用以', '可联想'].every((x) => VAGUE_PHRASES.includes(x)), VAGUE_PHRASES.join(','));
ok('D4. 源码中先全量校验、后统一写盘', /第一段：全量校验/.test(srcGen) && /第二段：全部通过后才写盘/.test(srcGen));

/* ==========================================================================
 * 汇总
 * ======================================================================= */
console.log('\n========================================');
if (fail) {
  console.log(`结果：✘ ${fail} 项失败 / 共 ${pass + fail} 项`);
  failures.slice(0, 40).forEach((f) => console.log('  ✘ ' + f));
  process.exit(1);
}
console.log(`结果：✔ 全部通过（${pass} 项断言）`);
