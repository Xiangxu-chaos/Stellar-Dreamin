/**
 * exportDomainWordsCsv.mjs
 * ----------------------------------------------------------------------------
 * 人工抽查脚本：把四个兴趣领域（杀戮尖塔 / 空洞骑士 / 王者荣耀 / 无畏契约）
 * 里「所有匹配到的单词」导出成一份 CSV，供人工快速过一遍词义是否准确。
 *
 * 输出列：
 *   单词, 通用释义, 领域释义, 领域, 来源, 待确认
 *   - 单词：材料条目的 key（小写词形）
 *   - 通用释义：generalMeaning（标准英语 → 中文）
 *   - 领域释义：domainMeaning（该领域下的对应物 / 官方译名）
 *   - 领域：domainName（中文领域名）
 *   - 来源：source（译名来源说明，便于核验）
 *   - 待确认：unverified 标记（true 的行需重点人工确认）
 *
 * 编码：UTF-8 + BOM，确保 Excel 直接打开中文不乱码。
 *
 * 用法：node tools/exportDomainWordsCsv.mjs
 * 输出：tools/domain_words_review.csv
 * ----------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src/data/domainMaterials');
const FILES = ['slayTheSpire.json', 'hollowKnight.json', 'honorOfKings.json', 'valorant.json'];

/** CSV 字段转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍 */
function esc(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const rows = [['单词', '通用释义', '领域释义', '领域', '来源', '待确认']];
let count = 0;

for (const f of FILES) {
  const json = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
  const domainName = json.domainName || f;
  const mats = json.materials || {};
  for (const [word, m] of Object.entries(mats)) {
    if (!m || typeof m !== 'object') continue;
    rows.push([
      word,
      m.generalMeaning || '',
      m.domainMeaning || '',
      domainName,
      m.source || '',
      m.unverified ? '是' : '',
    ]);
    count++;
  }
}

const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
const out = path.join(__dirname, 'domain_words_review.csv');
writeFileSync(out, csv, 'utf8');

console.log(`✓ 已导出 ${count} 条单词到：${out}`);
console.log('  列：单词, 通用释义, 领域释义, 领域, 来源, 待确认');
