/**
 * clearImageUrls.mjs
 * ----------------------------------------------------------------------------
 * 清理脚本：把 src/data/domainMaterials/*.json 里「每一条」词条的 imageUrl
 * 字段统一清空为 ""（保留字段，不删除），使所有卡片回到统一的「暂无配图」
 * 占位状态。
 *
 * 背景：用户决定暂时放弃自动配图，保留纯文字卡片。
 *  - 只改 imageUrl 一个字段，其余字段（generalMeaning / domainMeaning /
 *    example / story / source / unverified …）一律不动。
 *  - 字段本身保留，以兼容「以后人工补图只需往 JSON 里填链接」的约定。
 *
 * 用法：node tools/clearImageUrls.mjs
 * ----------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src/data/domainMaterials');
const FILES = ['slayTheSpire.json', 'hollowKnight.json', 'honorOfKings.json', 'valorant.json'];

let total = 0, cleared = 0, alreadyEmpty = 0;

for (const f of FILES) {
  const p = path.join(DIR, f);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  const mats = json.materials || {};
  for (const [word, m] of Object.entries(mats)) {
    total++;
    if (m && typeof m === 'object') {
      if (m.imageUrl) {
        m.imageUrl = '';
        cleared++;
      } else {
        // 字段缺失也补成空串，确保结构一致
        if (!('imageUrl' in m)) { m.imageUrl = ''; }
        alreadyEmpty++;
      }
    }
  }
  writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`✓ ${f} 已写入（词条 ${Object.keys(mats).length} 条）`);
}

console.log(`\n汇总：词条总数 ${total}，清空有值图链 ${cleared} 条，原本已为空 ${alreadyEmpty} 条。`);
console.log('所有 imageUrl 字段已统一为 ""（占位，无真实图链）。');
