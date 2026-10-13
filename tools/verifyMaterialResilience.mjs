/**
 * 第三步回归：服务层必须能扛住「大文件 / 坏数据」。
 * 断言：
 *   A. 材料文件 JSON 解析失败（截断/非法）→ 降级为空材料，不抛错
 *   B. 文件结构不对（materials 缺失/非对象）→ 降级为空材料
 *   C. 单条材料非法（null / 字符串 / 字段类型错）→ 只跳过该条，其余正常载入
 *   D. 领域正常文件仍能完整载入（不被兜底逻辑误伤）
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};

/* 可控的 fetch：按当前「注入模式」返回不同内容 */
let MODE = 'ok';
const REAL = (p) => readFileSync(p, 'utf8');
const realRead = (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  return path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
};

globalThis.fetch = async (url) => {
  const p = realRead(url);
  if (MODE === 'ok') {
    if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404'); }, async text() { return ''; } };
    return { ok: true, status: 200, async json() { return JSON.parse(REAL(p)); }, async text() { return REAL(p); } };
  }
  // 仅对材料文件注入故障（词库 cet6Core.json 保持正常）
  if (/domainMaterials/.test(p)) {
    if (MODE === 'brokenJson') {
      return { ok: true, status: 200, async json() { throw new SyntaxError('Unexpected token } in JSON at position 12345'); }, async text() { return '{ broken'; } };
    }
    if (MODE === 'badShape') {
      return { ok: true, status: 200, async json() { return { foo: 'bar' }; }, async text() { return '{}'; } };
    }
    if (MODE === 'badEntries') {
      const j = JSON.parse(REAL(p));
      j.materials.__nullEntry = null;
      j.materials.__strEntry = 'i am not an object';
      j.materials.__badTypes = { root: 123, example: 456, generalMeaning: [] };
      j.materials.__good = { root: 'r', generalMeaning: 'g', domainMeaning: 'd', story: 's', example: 'A good example sentence appears here.', exampleZh: '好例句', imageUrl: '', source: 'test', unverified: false };
      return { ok: true, status: 200, async json() { return j; }, async text() { return JSON.stringify(j); } };
    }
  }
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404'); }, async text() { return ''; } };
  return { ok: true, status: 200, async json() { return JSON.parse(REAL(p)); }, async text() { return REAL(p); } };
};

globalThis.document = {
  createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, setAttribute() {}, appendChild() {} }),
  documentElement: { style: { setProperty() {} }, setAttribute() {} },
  body: { classList: { add() {}, remove() {} } }, querySelector: () => null, querySelectorAll: () => [],
};

const wb = await import('../src/services/wordBankService.js');
await wb.ensureLoaded();

const DMS = await import('../src/services/domainMaterialService.js');

/* --- D. 正常模式先验证基线 --- */
MODE = 'ok';
{
  const m = await DMS.getMaterial('honor_of_kings', 'lane');
  ok('D. 正常文件可完整载入（lane 有材料）', Boolean(m && m.example), m?.example);
}

/* --- A. JSON 解析失败 → 不崩 --- */
MODE = 'brokenJson';
{
  const dms = await import('../src/services/domainMaterialService.js?caseA');
  let threw = null;
  let m = null;
  try { m = await dms.getMaterial('honor_of_kings', 'lane'); } catch (e) { threw = e; }
  ok('A. JSON 解析失败不抛错', threw === null, threw && threw.message);
  ok('A. JSON 解析失败降级为空材料（返回 null）', m === null);
}

/* --- B. 结构不对 → 不崩 --- */
MODE = 'badShape';
{
  const dms = await import('../src/services/domainMaterialService.js?caseB');
  let threw = null;
  let m = null;
  try { m = await dms.getMaterial('slay_the_spire', 'ascension'); } catch (e) { threw = e; }
  ok('B. 结构不对不抛错', threw === null, threw && threw.message);
  ok('B. 结构不对降级为空材料', m === null);
}

/* --- C. 单条非法 → 只跳过该条，其余载入 --- */
MODE = 'badEntries';
{
  const dms = await import('../src/services/domainMaterialService.js?caseC');
  let threw = null;
  let good = null;
  let nul = 'unset';
  try {
    good = await dms.getMaterial('honor_of_kings', '__good');
    nul = await dms.getMaterial('honor_of_kings', '__nullEntry');
  } catch (e) { threw = e; }
  ok('C. 含非法条目时不抛错', threw === null, threw && threw.message);
  ok('C. 合法条目正常载入', Boolean(good && good.example), good?.example);
  ok('C. 非法条目（null）返回 null 而非崩溃', nul === null);
}

/* --- E. 正常领域的真实数据条数未被兜底逻辑削减 --- */
MODE = 'ok';
{
  const dms = await import('../src/services/domainMaterialService.js?caseE');
  const all = await dms.getMaterials('hollow_knight');
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'src/data/domainMaterials/hollowKnight.json'), 'utf8'));
  const rawN = Object.keys(raw.materials).length;
  // 载入条数必须与磁盘文件一致（不能因兜底逻辑丢数据）
  ok('E. hollow_knight 材料完整载入（与文件条数一致）', Object.keys(all).length === rawN, `${Object.keys(all).length} / 文件 ${rawN} 条`);
}

console.log('=== 第三步回归：大文件 / 坏数据容错 ===\n');
console.log(pass.join('\n'));
if (fail.length) console.log('\n--- 失败 ---\n' + fail.join('\n'));
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
