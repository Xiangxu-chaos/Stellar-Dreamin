/**
 * 问题一专项回归：领域单词必须始终小写显示。
 *
 * 背景：用户截图——杀戮尖塔 / 王者荣耀领域的单词显示成全大写
 *       （basement → BASEMENT，lane → LANE），其他领域正常。
 *
 * 真实根因（不是 CSS text-transform，也不是数据大写）：
 *   slay_the_spire 与 honor_of_kings 的 theme.fontDisplay 用了 'Cinzel'，
 *   而 Cinzel 是「全大写 / 小型大写」字体（源自罗马石碑铭文），
 *   字体文件里没有真正的小写字形 → 浏览器用大写字形替代 → 视觉全大写。
 *
 * 本测试断言：
 *   A. 两个问题领域的 fontDisplay 仍然是 Cinzel（记录现状，说明根因）
 *   B. 所有渲染「单词本身」的 CSS 类都改用 --font-body，且带 text-transform: lowercase
 *   C. Cinzel 只允许出现在装饰性标题类，不允许出现在 word 相关类
 *   D. 每个领域的 fontDisplay 都不等于正文字体时（即装饰字体存在），单词类仍不被污染
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(`${c ? '✔' : '✘'} ${n}${x ? ' — ' + x : ''}`);

const css = readFileSync(path.join(ROOT, 'src/styles/components.css'), 'utf8');
const cfg = readFileSync(path.join(ROOT, 'src/config/interestsConfig.js'), 'utf8');

/** 提取某个 CSS 类的规则体（去掉注释，避免注释里提到的 Cinzel 干扰判定） */
function rule(className) {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  if (!m) return null;
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '');  // 剥掉块注释
}

/* A. 记录根因：两个问题领域的 theme.fontDisplay 用 Cinzel */
const cinzelDomains = [];
for (const id of ['slay_the_spire', 'honor_of_kings', 'hollow_knight', 'valorant']) {
  const idx = cfg.indexOf(`id: '${id}'`);
  const seg = cfg.slice(idx, idx + 3000);         // 覆盖到 theme 块
  const m = seg.match(/fontDisplay:\s*(.+?),\s*\n/);
  const fonts = m ? m[1] : '';
  if (/Cinzel/.test(fonts)) cinzelDomains.push(id);
}
ok('根因确认：slay/hok 使用 Cinzel（无小写字形）',
  cinzelDomains.includes('slay_the_spire') && cinzelDomains.includes('honor_of_kings')
    && !cinzelDomains.includes('hollow_knight') && !cinzelDomains.includes('valorant'),
  `用 Cinzel 的领域: ${cinzelDomains.join(', ')}`);

/* B. 所有「单词」渲染类必须是可读字体 + 强制小写 */
const WORD_CLASSES = ['wordcard__word', 'flip__word', 'detail__word', 'quiz__word', 'quiz-card__prompt'];
for (const cls of WORD_CLASSES) {
  const body = rule(cls);
  if (!body) { ok(`${cls} 存在`, false, '未找到该类的 CSS 规则'); continue; }
  ok(`${cls} 使用正文字体（非全大写装饰字体）`, /font-family:\s*var\(--font-body\)/.test(body),
    (body.match(/font-family:[^;]*/) || ['(无)'])[0]);
  ok(`${cls} 带 text-transform: lowercase 兜底`, /text-transform:\s*lowercase/.test(body));
  ok(`${cls} 不含 uppercase`, !/uppercase/.test(body));
}

/* C. 单词类里不允许出现 Cinzel / font-display */
for (const cls of WORD_CLASSES) {
  const body = rule(cls) || '';
  ok(`${cls} 不含 Cinzel`, !/Cinzel/.test(body));
  ok(`${cls} 不用 --font-display`, !/var\(--font-display\)/.test(body));
}

/* D. 装饰性标题仍可用 font-display（确认我们没有把整站字体都改掉） */
const decorative = ['empty__title', 'history-item__word'];
ok('装饰性标题类仍可使用 --font-display（未被误伤）',
  decorative.some((c) => /var\(--font-display\)/.test(rule(c) || '')),
  decorative.map((c) => (rule(c) || '').includes('--font-display') ? c : null).filter(Boolean).join(', '));

/* E. 数据层面：材料文件的键都是小写（排除「数据本身大写」这一猜测） */
import { readdirSync } from 'node:fs';
const dir = path.join(ROOT, 'src/data/domainMaterials');
let upperKeys = 0;
let totalKeys = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  for (const k of Object.keys(j.materials || {})) {
    totalKeys++;
    if (k !== k.toLowerCase()) upperKeys++;
  }
}
ok('材料数据键全为小写（证明不是数据大写）', upperKeys === 0, `${totalKeys} 键，${upperKeys} 个大写`);

console.log('=== 问题一回归：单词大小写 ===\n');
console.log(pass.join('\n'));
if (fail.length) console.log('\n--- 失败 ---\n' + fail.join('\n'));
console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
