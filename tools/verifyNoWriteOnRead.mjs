/**
 * verifyNoWriteOnRead.mjs
 * ============================================================================
 * 修复验证：进入收藏夹 / 复习收藏夹 —— 绝对只读不写。
 *
 * 覆盖用户给的 6 步验收流程：
 *   1. 收藏一个词 → 数字 1
 *   2. 点开收藏夹 → 数字仍 1，列表有该词
 *   3. 刷新页面   → 数字仍 1
 *   4. 再收藏一个词 → 数字 2
 *   5. 点开复习收藏夹 → 数字仍 2，能从收藏出题
 *   6. 取消收藏 → 数字 1，列表剩 1
 * 并额外断言：读取 API（getFavorites / getFavoriteKeys / isFavorite）调用前后，
 * localStorage 的原始字符串【逐字节不变】。
 * ============================================================================
 */
import dataService from '../src/services/dataService.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---- fetch shim：把请求映射到本地文件（供 wordBankService 载入词库）---- */
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404 ' + p); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};

/* ---- localStorage shim，记录每一次 setItem 调用（用于抓「写入点」）---- */
const store = new Map();
const setItemLog = [];
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { setItemLog.push({ key: String(k), value: String(v) }); store.set(String(k), String(v)); },
  removeItem: (k) => store.delete(String(k)),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i],
  get length() { return store.size; },
};

const KEY = 'wb:cet6:favorites';
const rawFav = () => store.get(KEY) ?? null;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✓ ${n}${x ? '  ' + x : ''}`); } else { fail++; console.log(`  ✗ ${n}${x ? '  ' + x : ''}`); } };

console.log('\n=== [A] 读取 API 不得写盘（核心回归）===\n');

/* 预置真实收藏数据 + 一条历史脏数据 */
store.clear(); setItemLog.length = 0;
store.set(KEY, JSON.stringify({
  __v: 1,
  data: {
    'slay_the_spire::ascension': { word: 'ascension', domainId: 'slay_the_spire', favoritedAt: 1700000001000 },
    soul: 1700000000000, // 旧格式脏数据
  },
}));
const before = rawFav();
setItemLog.length = 0; // 清空日志，只看读取期间有没有写入

const listA = await dataService.getFavorites();
const keysA = await dataService.getFavoriteKeys();
const isA = await dataService.isFavorite('slay_the_spire', 'ascension');
await dataService.getFavorites('slay_the_spire'); // 带过滤的读取

ok('getFavorites() 读到了合法记录', listA.length === 1, `list=${listA.length}`);
ok('getFavoriteKeys() 与列表同源', keysA.length === listA.length, `keys=${keysA.length}`);
ok('isFavorite() 命中', isA === true);
ok('脏数据不计入数量（不膨胀）', keysA.length === 1);
ok('读取期间 setItem 调用次数 = 0（只读不写）', setItemLog.length === 0, `calls=${setItemLog.length}`);
ok('localStorage 原始字符串逐字节不变', rawFav() === before, rawFav() === before ? '未改动' : `after=${rawFav()}`);

console.log('\n=== [B] 全脏数据下读取也不得清空 ===\n');
store.clear(); setItemLog.length = 0;
store.set(KEY, JSON.stringify({ __v: 1, data: { soul: 1700000000000, nail: 1700000001000 } }));
const dirtyBefore = rawFav();
const dirtyList = await dataService.getFavorites();
ok('全脏数据：列表为空（无法归一化）', dirtyList.length === 0);
ok('全脏数据：读取期间零写入', setItemLog.length === 0, `calls=${setItemLog.length}`);
ok('全脏数据：原始数据未被清空', rawFav() === dirtyBefore, `after=${rawFav()}`);

console.log('\n=== [C] 用户 6 步验收流程 ===\n');
store.clear(); setItemLog.length = 0;

// 1. 收藏一个词
await dataService.setFavorite('slay_the_spire', 'ascension', true);
await dataService.flushWrites();
ok('1) 收藏后数字 = 1', (await dataService.getFavorites()).length === 1);

// 2. 点开收藏夹（= 读取 getAll + 计数）
const step2 = await dataService.getFavorites();
ok('2) 进收藏夹后数字仍 = 1', step2.length === 1);
ok('2) 列表里能看到该词', step2[0]?.word === 'ascension');

// 3. 刷新页面（重新读 localStorage，模拟 boot()）
const step3 = await dataService.getFavorites();
ok('3) 刷新后数字仍 = 1', step3.length === 1);

// 4. 再收藏一个词
await dataService.setFavorite('hollow_knight', 'ritual', true);
await dataService.flushWrites();
ok('4) 再收藏后数字 = 2', (await dataService.getFavorites()).length === 2);

// 5. 点开复习收藏夹（= 再次读取 + 计数）
const step5 = await dataService.getFavorites();
ok('5) 复习收藏夹前数字仍 = 2', step5.length === 2);
const study = await import('../src/services/studyService.js');
const bank = await study.buildFavorites();
ok('5) 能从收藏的词出题（取到 2 条）', bank.length === 2, bank.map((b) => b.word).join(', '));

// 6. 取消收藏
await dataService.setFavorite('slay_the_spire', 'ascension', false);
await dataService.flushWrites();
const step6 = await dataService.getFavorites();
ok('6) 取消后数字 = 1', step6.length === 1);
ok('6) 列表只剩另一个词', step6[0]?.word === 'ritual');

console.log('\n=== [D] toggleFavorite 语义（存在则移除/不存在则添加）===\n');
store.clear();
const t1 = await dataService.toggleFavorite('slay_the_spire', 'barrier');
ok('D) 首次 toggle → true（添加）', t1 === true && (await dataService.getFavorites()).length === 1);
const t2 = await dataService.toggleFavorite('slay_the_spire', 'barrier');
ok('D) 再次 toggle → false（移除）', t2 === false && (await dataService.getFavorites()).length === 0);

console.log('\n=== [E] 写入路径仍能安全迁移旧脏数据 ===\n');
store.clear();
store.set(KEY, JSON.stringify({ __v: 1, data: { soul: 1700000000000 } }));
await dataService.setFavorite('slay_the_spire', 'ascension', true);
await dataService.flushWrites();
const afterWrite = await dataService.getFavorites();
const persistedE = JSON.parse(rawFav()).data;
ok('E) 用户主动写入时，脏数据被安全清理', !('soul' in persistedE), Object.keys(persistedE).join(','));
ok('E) 新收藏写入成功', afterWrite.length === 1 && afterWrite[0].word === 'ascension');

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
