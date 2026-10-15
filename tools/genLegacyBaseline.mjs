#!/usr/bin/env node
/**
 * genLegacyBaseline.mjs —— 生成「原始四领域原有条目」的内容指纹基线
 * ============================================================================
 * 为什么需要：
 *   补缺口（tools/autoFixGap.mjs）会往老库里**新增**条目，所以「条数不变」不再是
 *   有效的验伪手段。真正要锁死的是「原有条目一个字节都没被改」。
 *   本脚本对每个老库里**非 AI 补充**的条目（source 不含「AI 补充」）按 key 排序后
 *   计算 sha256 指纹，写入 tools/baselines/legacy-baseline.json。
 *   tools/verifyDomainExpansion.mjs 断言 14 会重新计算并与该基线比对。
 *
 * 何时重跑：
 *   只在「确需重新冻结基线」时（例如有意整批修订老数据）——重跑等于承认当前状态是新的
 *   真值，请务必在提交信息里说明原因。
 *
 * 用法：
 *   node tools/genLegacyBaseline.mjs                            # 以当前数据为准
 *   node tools/genLegacyBaseline.mjs --from=<目录>               # 以某个备份快照为准（推荐）
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(ROOT, 'src/data/domainMaterials');
const OUT = path.join(ROOT, 'tools/baselines/legacy-baseline.json');

const argv = process.argv.slice(2);
const fromArg = (argv.find((a) => a.startsWith('--from=')) || '').split('=').slice(1).join('=');
const DIR = fromArg ? path.resolve(fromArg) : DEFAULT_DIR;
if (!fs.existsSync(DIR)) { console.error(`✘ 目录不存在：${DIR}`); process.exit(1); }

/* 原始四领域（第一批上线时就在的四个库） */
const FILES = ['slayTheSpire', 'hollowKnight', 'honorOfKings', 'valorant'];

/** 只取「非 AI 补充」的条目 —— AI 补缺口新增的条目不计入基线 */
export function fingerprint(materials) {
  const original = Object.fromEntries(
    Object.entries(materials).filter(([, m]) => !String(m.source || '').includes('AI 补充')),
  );
  const keys = Object.keys(original).sort();
  return {
    count: keys.length,
    sha256: createHash('sha256')
      .update(JSON.stringify(keys.map((k) => [k, original[k]]))).digest('hex').slice(0, 32),
  };
}

const files = {};
for (const f of FILES) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, `${f}.json`), 'utf8'));
  files[f] = { ...fingerprint(j.materials || {}), total: Object.keys(j.materials || {}).length };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  _comment: [
    '原始四领域「原有条目」内容指纹基线（不含 AI 补充的新增条目）。',
    '由 tools/genLegacyBaseline.mjs 生成；tools/verifyDomainExpansion.mjs 断言 14 使用。',
    '不要手改本文件 —— 需要重新冻结时请重跑生成脚本并说明原因。',
  ],
  frozenAt: new Date().toISOString(),
  files,
}, null, 2) + '\n', 'utf8');

for (const [f, v] of Object.entries(files)) {
  console.log(`${f.padEnd(16)} 原有条目 ${String(v.count).padStart(4)} 条（当前总计 ${v.total}）| ${v.sha256}`);
}
console.log(`\n✔ 基线已写入 ${path.relative(ROOT, OUT)}`);
