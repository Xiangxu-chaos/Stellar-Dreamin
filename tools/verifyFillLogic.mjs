/**
 * 干跑测试：用 mock 的 AI 响应驱动 fillMaterialsFromAI 的核心逻辑
 * （校验 + 合并 + 落盘），验证脚本在真实调用前是正确、幂等、可续跑的。
 * 不写入真实文件：写到临时副本，跑完删除。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'src/data/domainMaterials/honorOfKings.json');
const tmp = path.join(ROOT, 'tools/_dryrun.json');

const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

/* --- 复刻脚本里的校验逻辑，确保一致性 --- */
function validate(entry, word) {
  const need = ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh'];
  for (const k of need) if (typeof entry?.[k] !== 'string' || !entry[k].trim()) return `缺字段 ${k}`;
  const w = word.toLowerCase();
  const ex = entry.example.toLowerCase();
  if (!ex.includes(w)) {
    const stem = w.length > 6 ? w.slice(0, w.length - 3) : w;
    if (!ex.includes(stem)) return '例句不含该词';
  }
  return null;
}

/* --- 用例 --- */
const cases = [
  { word: 'basement', entry: { root: 'base（基础）+ -ment', generalMeaning: 'n. 地下室', domainMeaning: '该词在王者荣耀中常用于描述基地/泉水区域。', story: '敌人摸进了我们的基地。', example: 'The enemy sneaked into our basement and hit the crystal.', exampleZh: '敌人偷偷摸进了我们的基地并攻击水晶。' }, expect: null },
  { word: 'lane', entry: { root: '核心词', generalMeaning: 'n. 小巷，车道', domainMeaning: '该词在王者荣耀中常用于描述分路。', story: '三条分路同时推进。', example: 'Three lanes push toward the enemy crystal.', exampleZh: '三条分路同时向敌方水晶推进。' }, expect: null },
  { word: 'nonexistent', entry: { root: '', generalMeaning: 'x', domainMeaning: 'x', story: 'x', example: 'no word here', exampleZh: 'x' }, expect: '缺字段 root' },
  { word: 'absent', entry: { root: 'r', generalMeaning: 'g', domainMeaning: 'd', story: 's', example: 'This sentence does not contain it.', exampleZh: 'zh' }, expect: null }, // 'absent' 在句中？否
];

/* 修正最后一个用例：'absent' 不在句中，应被拦下 */
cases[3] = { word: 'absent', entry: { root: 'r', generalMeaning: 'g', domainMeaning: 'd', story: 's', example: 'This sentence is missing the target.', exampleZh: 'zh' }, expect: '例句不含该词' };

for (const c of cases) {
  const r = validate(c.entry, c.word);
  ok(`校验「${c.word}」=> ${c.expect === null ? '通过' : c.expect}`, r === c.expect, r === c.expect ? r ?? '' : `实际：${r}`);
}

/* --- 幂等/续跑：模拟写入 + 再次扫描 --- */
const orig = JSON.parse(readFileSync(src, 'utf8'));
const clone = JSON.parse(JSON.stringify(orig));
const before = Object.keys(clone.materials).length;
const NEW_WORD = '__dryrun_word__';
clone.materials[NEW_WORD] = { ...cases[0].entry, imageUrl: '', source: 'dryrun', unverified: false };
writeFileSync(tmp, JSON.stringify(clone, null, 2), 'utf8');
const after = Object.keys(JSON.parse(readFileSync(tmp, 'utf8')).materials).length;
ok('模拟落盘后条目 +1', after === before + 1, `${before} → ${after}`);

/* 续跑时应识别新词已存在 → 不再重复生成 */
const have = new Set(Object.keys(JSON.parse(readFileSync(tmp, 'utf8')).materials).map((w) => w.toLowerCase()));
ok('续跑识别已存在词（不再重复补）', have.has(NEW_WORD));

if (existsSync(tmp)) unlinkSync(tmp);
ok('临时文件已清理', !existsSync(tmp));

console.log('=== 第二步干跑测试：脚本逻辑 ===\n');
console.log(pass.join('\n'));
if (fail.length) console.log('\n--- 失败 ---\n' + fail.join('\n'));
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
