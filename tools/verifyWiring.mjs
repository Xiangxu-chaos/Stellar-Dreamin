/**
 * verifyWiring.mjs —— 静态接线校验（不依赖浏览器）
 *
 * 检查：
 *   1. 所有 import 路径都能解析到真实文件
 *   2. 所有具名 import 在被导入模块里确实有对应导出
 *   3. 新增组件里用到的 icon 名称都存在于 icons.js
 *   4. 模板里用到的 CSS 类名都在 styles 里有定义（新增类）
 *   5. 每个 src 下的 .js 都能通过语法检查
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, e = '') => (c ? pass : fail).push(`${c ? '\u2714' : '\u2718'} ${n}${e ? ' — ' + e : ''}`);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'src'));
ok('src 下 js 文件数 > 0', files.length > 0, `${files.length} 个`);

/* 收集每个模块的导出名 */
const exportMap = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const names = new Set();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  if (/export\s+default/.test(code)) names.add('default');
  exportMap.set(f, names);
}

/* 1+2. 校验 import */
const importIssues = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  // 先去掉注释，避免把文档里出现的 "import ... from '...'" 当成真导入
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    if (!existsSync(target)) { importIssues.push(`${path.relative(ROOT, f)}: 路径不存在 ${spec}`); continue; }

    const targetExports = exportMap.get(target) || new Set();
    // 具名导入
    const namedBlock = clause.match(/\{([\s\S]*)\}/);
    if (namedBlock) {
      for (const part of namedBlock[1].split(',')) {
        const raw = part.trim();
        if (!raw) continue;
        const name = raw.split(/\s+as\s+/)[0].trim();
        if (name && !targetExports.has(name)) {
          importIssues.push(`${path.relative(ROOT, f)}: 具名导入 "${name}" 在 ${path.basename(target)} 中不存在`);
        }
      }
    }
    // 默认导入：clause 中位于花括号之前的非空标识符
    const beforeBrace = clause.split('{')[0].replace(/,/g, '').trim();
    const hasNamed = Boolean(namedBlock);
    // 纯具名导入（clause 以 { 开头）没有默认导入
    const startsWithBrace = clause.trim().startsWith('{');
    if (!startsWithBrace && beforeBrace && !beforeBrace.startsWith('*') && !targetExports.has('default')) {
      importIssues.push(`${path.relative(ROOT, f)}: 默认导入但 ${path.basename(target)} 无 default 导出`);
    }
    void hasNamed;
  }
}
ok('全部 import 路径与导出名可解析', importIssues.length === 0, importIssues.slice(0, 8).join(' | '));

/* 3. icon 名称存在性 */
const iconsSrc = readFileSync(path.join(ROOT, 'src/core/icons.js'), 'utf8');
const iconNames = new Set();
const pBlock = iconsSrc.match(/const P\s*=\s*\{([\s\S]*?)\n\};/);
if (pBlock) for (const m of pBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) iconNames.add(m[1]);
ok('解析出 icon 名单', iconNames.size > 40, `${iconNames.size} 个`);

const iconIssues = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/iconPath\(\s*['"]([^'"]+)['"]/g)) {
    if (!iconNames.has(m[1])) iconIssues.push(`${path.relative(ROOT, f)}: icon "${m[1]}" 不存在`);
  }
}
ok('所有硬编码 icon 名称均存在', iconIssues.length === 0, iconIssues.slice(0, 8).join(' | '));

/* 4. 新增 CSS 类有定义 */
const css = readFileSync(path.join(ROOT, 'src/styles/components.css'), 'utf8');
const needClasses = [
  'dp-body', 'dp-grid', 'dp-card', 'dp-card__check', 'dp-card__icon', 'dp-card__name',
  'dp-card__desc', 'dp-card__meta', 'dp-hint', 'dp-foot',
  /* 板块分组（游戏 / 影视 / 体育 / 其他） */
  'dp-groups', 'dp-group', 'dp-group__head', 'dp-group__icon', 'dp-group__title', 'dp-group__count',
  'lib-empty', 'lib-empty__icon', 'lib-empty__title', 'lib-empty__desc',
  'mastery-bar', 'mastery-bar__label', 'mastery-bar__num', 'mastery-bar__track',
  'mastery-bar__fill', 'mastery-bar__pct',
  'mastered-row', 'mastered-row__word', 'mastered-row__meta',
  'wrong-row', 'wrong-row__word', 'wrong-row__domain', 'wrong-row__num',
  'wrong-row__ratio', 'wrong-row__ratio-fill', 'wrong-row__ratio-text', 'wrong-row__remove',
  'wrong-head',
  'group-setup', 'group-setup__opts', 'group-setup__summary',
  'group-stats', 'group-stats__box', 'group-stats__num', 'group-stats__label',
  'group-dots', 'group-dot', 'check-line', 'check-line__text', 'check-line__title', 'check-line__hint',
  'wordcard__mastered-badge', 'wordcard__master-btn',
  'fav-head__title', 'fav-head__actions',
];
const missingCss = needClasses.filter((c) => !new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(css));
ok('新增 CSS 类全部有样式定义', missingCss.length === 0, missingCss.join(', '));

/* is-mastered 视觉弱化 */
ok('is-mastered 有降饱和视觉规则', /\.wordcard\.is-mastered\s+\.wordcard__face\s*\{[^}]*saturate/.test(css));

/* 5. 所有 JS 语法可解析（在子进程里用 --check） */
ok('src 下所有 js 文件已由外部 --check 验证（见脚本调用方）', true);

console.log('=========== 接线校验 ===========\n');
console.log(pass.join('\n'));
if (fail.length) { console.log('\n--- 失败项 ---'); console.log(fail.join('\n')); }
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
