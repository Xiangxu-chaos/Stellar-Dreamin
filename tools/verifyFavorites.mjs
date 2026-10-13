/**
 * 收藏与持久化专项回归
 * 覆盖：并发写入不丢、刷新不丢、同词多领域互不干扰、数据结构、收藏夹读取路径
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = []; const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

/* ---- 最小 DOM shim（service 层不依赖 DOM，但 wordBankService 需要 fetch） ---- */
class El {
  constructor() { this.nodeType = 1; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.classList = { add() {}, remove() {}, contains() { return false; }, toggle() { return true; } }; }
  appendChild(c) { this.children.push(c); return c; } append() {} replaceChildren() {} setAttribute() {} getAttribute() { return null; } addEventListener() {} querySelector() { return null; } querySelectorAll() { return []; } set textContent(v) { this._t = v; } get textContent() { return this._t || ''; } set innerHTML(v) {} get innerHTML() { return ''; }
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { reload() {} }, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null), setItem: (k, v) => store.set(String(k), String(v)), removeItem: (k) => store.delete(String(k)), clear: () => store.clear(), key: (i) => [...store.keys()][i], get length() { return store.size; } };
globalThis.document = { createElement: () => new El(), createTextNode: () => ({ nodeType: 3 }), createElementNS: () => new El(), body: new El(), documentElement: new El(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
globalThis.Node = El;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404'); } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};

const ds = (await import('../src/services/dataService.js')).default;
const wb = (await import('../src/services/wordBankService.js')).default;
const study = (await import('../src/services/studyService.js')).default;

await wb.ensureLoaded();
await ds.clearFavorites();
await ds.clearQuizStats();
await ds.clearHistory();

console.log('=========== 收藏与持久化专项回归 ===========\n');

/* 1. 并发写入不丢（核心回归：修复前的根因） */
const words = ['ascension', 'barrier', 'bleed', 'cleave', 'corruption', 'entropy', 'intangible', 'ritual', 'strike', 'upgrade'];
await Promise.all(words.map((w) => ds.toggleFavorite('slay_the_spire', w)));
await ds.flushWrites();
const afterConcurrent = await ds.getFavorites('slay_the_spire');
ok('并发收藏 10 个全部写入', afterConcurrent.length === 10, `${afterConcurrent.length}/10`);

/* 更极端的并发：奇数次点击最终应为「已收藏」，偶数次应为「未收藏」 */
await ds.clearFavorites('slay_the_spire');
const burst = [];
for (let i = 0; i < 25; i++) burst.push(ds.toggleFavorite('slay_the_spire', 'ascension'));
await Promise.all(burst);
await ds.flushWrites();
ok('并发 toggle 25 次（奇）→ 已收藏', await ds.isFavorite('slay_the_spire', 'ascension'), '25 次');

const burst2 = [];
for (let i = 0; i < 25; i++) burst2.push(ds.toggleFavorite('slay_the_spire', 'ascension'));
await Promise.all(burst2);
await ds.flushWrites();
ok('再并发 toggle 25 次（累计 50，偶）→ 未收藏', !(await ds.isFavorite('slay_the_spire', 'ascension')), '25 次');

/* 交替并发（一半想收一半想取）→ 串行化后状态必须确定，且不出现半写 */
await ds.clearFavorites('slay_the_spire');
await Promise.all([
  ds.setFavorite('slay_the_spire', 'cleave', true),
  ds.setFavorite('slay_the_spire', 'cleave', false),
  ds.setFavorite('slay_the_spire', 'cleave', true),
]);
await ds.flushWrites();
ok('setFavorite 并发最后写入者生效', await ds.isFavorite('slay_the_spire', 'cleave'), '最后一次 true');

/* 2. 数据结构符合要求 */
await ds.clearFavorites();
await ds.setFavorite('slay_the_spire', 'barrier', true);
const rawSaved = JSON.parse(localStorage.getItem('wb:cet6:favorites')).data;
const rec = rawSaved['slay_the_spire::barrier'];
ok('记录结构含 word/domainId/favoritedAt',
  rec && rec.word === 'barrier' && rec.domainId === 'slay_the_spire' && typeof rec.favoritedAt === 'number' && rec.favoritedAt > 0,
  JSON.stringify(rec));

/* 3. 同词多领域互不干扰 */
await ds.setFavorite('hollow_knight', 'barrier', true);
const sp = await ds.getFavorites('slay_the_spire');
const hk = await ds.getFavorites('hollow_knight');
ok('同词在两领域各存一条', sp.length === 1 && hk.length === 1, `slay=${sp.length} hk=${hk.length}`);
ok('按领域筛选正确', sp[0].domainId === 'slay_the_spire' && hk[0].domainId === 'hollow_knight');
await ds.setFavorite('slay_the_spire', 'barrier', false);
ok('取消一个领域不影响另一个', (await ds.getFavorites('slay_the_spire')).length === 0 && (await ds.getFavorites('hollow_knight')).length === 1);

/* 4. 旧数据兼容（字段名 at → favoritedAt） */
localStorage.setItem('wb:cet6:favorites', JSON.stringify({ __v: 1, data: { 'slay_the_spire::legacy': { domainId: 'slay_the_spire', word: 'legacy', at: 1700000000000 } } }));
const legacy = await ds.getFavorites('slay_the_spire');
ok('兼容旧字段 at', legacy.length === 1 && legacy[0].favoritedAt === 1700000000000, JSON.stringify(legacy[0]));

/* 5. 刷新不丢（模拟：重新读 localStorage，不经过任何内存缓存） */
await ds.clearFavorites();
await ds.setFavorite('slay_the_spire', 'ascension', true);
await ds.setFavorite('hollow_knight', 'focus', true);
await ds.flushWrites();
// 直接解析原始存储，检查落盘
const persisted = JSON.parse(localStorage.getItem('wb:cet6:favorites')).data;
ok('已落盘（刷新不丢）', Object.keys(persisted).length === 2, JSON.stringify(Object.keys(persisted)));

/* 6. 收藏夹读取路径：buildFavorites 能拿到全部（含不在词库的词） */
await ds.clearFavorites();
await ds.setFavorite('slay_the_spire', 'ascension', true);   // 在词库
await ds.setFavorite('slay_the_spire', 'cleave', true);      // 在词库
await ds.setFavorite('hollow_knight', 'soul', true);         // ★ 不在六级词库
await ds.flushWrites();
const favCards = await study.buildFavorites();
ok('buildFavorites 返回全部 3 条（不丢不在词库的词）', favCards.length === 3, `${favCards.length} 条: ` + favCards.map((w) => w.word).join(', '));
const soulCard = favCards.find((w) => w.word === 'soul');
ok('不在词库的词有占位结构', Boolean(soulCard && soulCard.__missingInBank), soulCard ? `missingInBank=${soulCard.__missingInBank}` : '');
ok('收藏卡片带 material/domains 字段', favCards.every((w) => Array.isArray(w.domains) && 'material' in w));

/* 7. setFavorite 幂等 */
await ds.clearFavorites();
await Promise.all([ds.setFavorite('slay_the_spire', 'cleave', true), ds.setFavorite('slay_the_spire', 'cleave', true), ds.setFavorite('slay_the_spire', 'cleave', true)]);
await ds.flushWrites();
ok('setFavorite 幂等（并发 true 仍是 1 条）', (await ds.getFavorites('slay_the_spire')).length === 1);

/* 8. 其他写路径同样不丢（quizStats / history / selections / images） */
await ds.clearQuizStats();
await Promise.all(Array.from({ length: 20 }, (_, i) => ds.recordQuizResult('slay_the_spire', `w${i}`, i % 2 === 0)));
await ds.flushWrites();
const qs = await ds.getQuizStats('slay_the_spire');
ok('并发 20 次答题统计不丢', qs.total === 20, `total=${qs.total} correct=${qs.correct}`);
ok('答题统计逐词正确', Object.keys(qs.byWord).length === 20, `${Object.keys(qs.byWord).length} 词`);

await ds.clearHistory();
await Promise.all(Array.from({ length: 10 }, (_, i) => ds.appendHistory('slay_the_spire', { word: `h${i}`, correct: true })));
await ds.flushWrites();
ok('并发 10 次历史不丢', (await ds.getHistory('slay_the_spire')).length === 10);

await ds.setSelection('slay_the_spire', []);
await ds.flushWrites();
ok('勾选写入正常', (await ds.getSelection('slay_the_spire')).size === 0);

await Promise.all([ds.setImageOverride('slay_the_spire', 'a', 'http://x/1.png'), ds.setImageOverride('slay_the_spire', 'b', 'http://x/2.png')]);
await ds.flushWrites();
const imgs = await ds.getAllImageOverrides('slay_the_spire');
ok('并发 2 次配图写入不丢', Object.keys(imgs).length === 2, JSON.stringify(Object.keys(imgs)));

/* 9. 导出/导入包含收藏 */
await ds.clearFavorites();
await ds.setFavorite('slay_the_spire', 'ascension', true);
await ds.flushWrites();
const backup = await ds.exportAll();
ok('exportAll 含 favorites', backup.favorites && Object.keys(backup.favorites).length === 1);
await ds.clearFavorites();
await ds.importAll(backup);
ok('importAll 恢复 favorites', (await ds.getFavorites('slay_the_spire')).length === 1);

console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
