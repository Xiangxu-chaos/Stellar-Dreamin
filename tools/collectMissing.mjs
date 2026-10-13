/**
 * 收集缺口：每个领域「被筛选出来、但没有预生成材料」的词。
 * 输出 tools/_missing.json，供批量补全脚本使用。
 */
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL_DIR = path.join(ROOT, 'src/data/domainMaterials');

/* 最小 DOM/localStorage shim，让 wordBankService（内部可能用不到 DOM）能跑 */
globalThis.localStorage = globalThis.localStorage || {
  _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404 ' + p); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};
globalThis.document = { createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, setAttribute() {}, appendChild() {} }), documentElement: { style: { setProperty() {} }, setAttribute() {} }, body: { classList: { add() {}, remove() {} } }, querySelector: () => null, querySelectorAll: () => [] };

const wb = await import('../src/services/wordBankService.js');
await wb.ensureLoaded();

const DOMAINS = {
  honor_of_kings: 'honorOfKings',
  slay_the_spire: 'slayTheSpire',
  hollow_knight: 'hollowKnight',
  valorant: 'valorant',
};

const out = {};
for (const [domainId, file] of Object.entries(DOMAINS)) {
  const json = JSON.parse(readFileSync(path.join(MATERIAL_DIR, file + '.json'), 'utf8'));
  const have = new Set(Object.keys(json.materials || {}).map((w) => w.toLowerCase()));
  const matched = wb.filterByDomainSync(domainId, { limit: 100000 });
  const missing = [];
  for (const w of matched) {
    if (!have.has(w.word.toLowerCase())) {
      missing.push({
        word: w.word,
        translation: w.translation || '',
        phonetic: w.phonetic || '',
        root: w.root || '',
        level: w.relevance?.level || 'vocab',
        domainTermZh: w.relevance?.domainTermZh || '',
      });
    }
  }
  out[domainId] = { file, total: matched.length, have: have.size, missingCount: missing.length, missing };
  console.log(`${domainId}: 命中 ${matched.length}，已有材料 ${have.size}，缺 ${missing.length}`);
}

writeFileSync(path.join(ROOT, 'tools/_missing.json'), JSON.stringify(out, null, 2), 'utf8');
const grand = Object.values(out).reduce((s, d) => s + d.missingCount, 0);
console.log(`\n合计缺口：${grand} 词 → tools/_missing.json`);
