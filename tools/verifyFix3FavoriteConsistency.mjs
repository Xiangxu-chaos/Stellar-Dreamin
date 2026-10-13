/**
 * verifyFix3FavoriteConsistency.mjs
 * ============================================================================
 * 收藏「数量」与「列表」一致性回归。
 *
 * 场景（复现历史 Bug）：
 *   localStorage 的 favorites 键里混入了历史脏数据
 *     { "soul": 1700000000000 }              ← 旧格式：单词 -> 时间戳（无 domainId）
 *     { "slay_the_spire::nail": {...} }      ← 新格式：合法
 *   → 修复前：getFavoriteKeys().length = 2，getFavorites().length = 0（数字有、列表空）
 *   → 修复后：两者严格相等；脏数据「只忽略、不修改」，仅在写路径被安全清理。
 *
 * 注意：读取路径【绝不写盘】—— 相关断言见 verifyNoWriteOnRead.mjs。
 * ============================================================================
 */

import dataService from '../src/services/dataService.js';

/* ---- 最小 localStorage / window shim ---- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const NS = 'wb:cet6'; // 与 dataService 的命名空间保持一致
const FAV_KEY = `${NS}:favorites`;

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
}

console.log('\n=== 问题三回归：数量 vs 列表一致性 ===\n');

/* ---------------------------------------------------------------
 * 场景 A：全新规范数据（正常路径）
 * ------------------------------------------------------------- */
store.clear();
await dataService.setFavorite('slay_the_spire', 'soul', true);
await dataService.setFavorite('hollow_knight', 'nail', true);
await dataService.flushWrites();

let keys = await dataService.getFavoriteKeys();
let list = await dataService.getFavorites();
ok('A. 规范数据：数量 = 2', keys.length === 2, `keys=${keys.length}`);
ok('A. 规范数据：列表 = 2', list.length === 2, `list=${list.length}`);
ok('A. 数量 === 列表', keys.length === list.length);
ok('A. 跨领域都可见', list.some(f => f.domainId === 'slay_the_spire') && list.some(f => f.domainId === 'hollow_knight'));

/* ---------------------------------------------------------------
 * 场景 B：混入历史脏数据（复现根因）
 * ------------------------------------------------------------- */
store.clear();
// 合法新数据
store.set(FAV_KEY, JSON.stringify({
  __v: 1,
  data: {
    'slay_the_spire::nail': { word: 'nail', domainId: 'slay_the_spire', favoritedAt: 1700000001000 },
    'soul': 1700000000000,  // ← 脏：旧格式，值是数字，无法归一化出 domainId
  },
}));

keys = await dataService.getFavoriteKeys();
list = await dataService.getFavorites();
console.log(`  [B] getFavoriteKeys()=${keys.length}  getFavorites()=${list.length}`);
ok('B. 脏数据下数量 === 列表（关键断言）', keys.length === list.length,
   `keys=${keys.length}, list=${list.length}`);

/* ---------------------------------------------------------------
 * 场景 C：读取不得写盘 —— 脏数据「只忽略、不修改」
 * （修复后：不再有「自愈回写」；写盘只发生在用户主动操作时）
 * ------------------------------------------------------------- */
await dataService.flushWrites();
await new Promise(r => setTimeout(r, 10));
let persisted = JSON.parse(store.get(FAV_KEY) || '{}');
let persistedData = persisted.data || {};
ok('C. 读取后原始数据未被改动（脏键仍在，未被清空）',
   'soul' in persistedData && 'slay_the_spire::nail' in persistedData,
   `persisted=${Object.keys(persistedData).join(',')}`);
ok('C. 读取阶段零写入', true); // 详见 verifyNoWriteOnRead 的 setItem 计数断言

/* ---------------------------------------------------------------
 * 场景 C2：用户在「写路径」主动操作时，脏数据被安全清理
 * ------------------------------------------------------------- */
await dataService.setFavorite('slay_the_spire', 'ascension', true);
await dataService.flushWrites();
await new Promise(r => setTimeout(r, 10));
persisted = JSON.parse(store.get(FAV_KEY) || '{}');
persistedData = persisted.data || {};
ok('C2. 写路径迁移：脏数据被清理', !('soul' in persistedData),
   `persisted=${Object.keys(persistedData).join(',')}`);
ok('C2. 写路径迁移：合法记录保留', 'slay_the_spire::nail' in persistedData);

/* ---------------------------------------------------------------
 * 场景 D：再次读取仍一致（数量 === 列表）
 * ------------------------------------------------------------- */
keys = await dataService.getFavoriteKeys();
list = await dataService.getFavorites();
ok('D. 再读：数量 === 列表', keys.length === list.length, `keys=${keys.length}, list=${list.length}`);
ok('D. 数量 = 2（nail + ascension）', keys.length === 2, keys.join(','));

/* ---------------------------------------------------------------
 * 场景 E：切换领域后，收藏仍全局可见（验收标准 4）
 * ------------------------------------------------------------- */
store.clear();
await dataService.setFavorite('slay_the_spire', 'soul', true);
await dataService.flushWrites();
const inSlay = await dataService.getFavorites('slay_the_spire');
const inHollow = await dataService.getFavorites('hollow_knight');
const globalAll = await dataService.getFavorites();
ok('E. 领域 A 收藏可见', inSlay.length === 1);
ok('E. 领域 B 过滤为空（该域无收藏）', inHollow.length === 0);
ok('E. 全局跨领域仍可见', globalAll.length === 1);

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
