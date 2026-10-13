/**
 * buildWordBank.mjs
 * ============================================================================
 * 词库构建脚本（离线，仅用于生成数据文件，不参与页面运行）
 *
 * 职责：
 *   把「紧凑词表源码」（coreTables/*.js，纯数据、体积小、易维护）
 *   编译成运行时使用的 src/data/cet6Core.json（含 word/phonetic/translation/
 *   root/type/bank 字段）。
 *
 * 为什么拆成两步：
 *   1. 5000-6000 词的完整 JSON 直接手写不现实；用紧凑格式书写 + 脚本编译，
 *      可以保证字段一致、去重、可增量维护。
 *   2. 音标/词根由规则 + 人工表补全，避免人工逐条录入出错。
 *
 * 用法：
 *   node tools/buildWordBank.mjs
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------------------------------------------------------------------------
 * 词根人工表：常见前缀 / 后缀 / 词根 → 中文说明
 * 用于给派生词生成 root 字段；未命中者标记为「核心词」。
 * 注意：这是「概览式」词根提示，不追求词源学严谨，目标是辅助记忆。
 * ------------------------------------------------------------------------ */
const PREFIXES = [
  ['anti', 'anti- 反对，抵抗'],
  ['auto', 'auto- 自己，自动'],
  ['bi', 'bi- 二，双'],
  ['co', 'co- 共同'],
  ['com', 'com- 共同，一起'],
  ['con', 'con- 共同，加强'],
  ['contra', 'contra- 相反'],
  ['counter', 'counter- 反对，反向'],
  ['de', 'de- 向下，去除'],
  ['dis', 'dis- 否定，分开'],
  ['en', 'en- 使…成为'],
  ['ex', 'ex- 向外，前任'],
  ['extra', 'extra- 超出'],
  ['fore', 'fore- 前，预先'],
  ['hyper', 'hyper- 过度，超'],
  ['il', 'il- 否定（用于 l 前）'],
  ['im', 'im- 否定 / 进入'],
  ['in', 'in- 否定 / 进入'],
  ['inter', 'inter- 在…之间'],
  ['intra', 'intra- 内部'],
  ['ir', 'ir- 否定（用于 r 前）'],
  ['macro', 'macro- 宏大，宏观'],
  ['micro', 'micro- 微小'],
  ['mis', 'mis- 错误'],
  ['mono', 'mono- 单一'],
  ['multi', 'multi- 多'],
  ['non', 'non- 非'],
  ['over', 'over- 过度，在上'],
  ['post', 'post- 在后'],
  ['pre', 'pre- 在前，预先'],
  ['pro', 'pro- 向前，支持'],
  ['re', 're- 再，回'],
  ['semi', 'semi- 半'],
  ['sub', 'sub- 在下，次'],
  ['super', 'super- 在上，超'],
  ['sur', 'sur- 在上，超过'],
  ['trans', 'trans- 横跨，转变'],
  ['tri', 'tri- 三'],
  ['ultra', 'ultra- 极端，超'],
  ['un', 'un- 否定'],
  ['under', 'under- 在下，不足'],
  ['uni', 'uni- 单一'],
];

const SUFFIXES = [
  ['ability', '-ability 能力（名词后缀）'],
  ['ibility', '-ibility 能力（名词后缀）'],
  ['ation', '-ation 动作/状态（名词后缀）'],
  ['ition', '-ition 动作/状态（名词后缀）'],
  ['sion', '-sion 动作/状态（名词后缀）'],
  ['tion', '-tion 动作/状态（名词后缀）'],
  ['ment', '-ment 行为/结果（名词后缀）'],
  ['ness', '-ness 性质/状态（名词后缀）'],
  ['ance', '-ance 性质/状态（名词后缀）'],
  ['ence', '-ence 性质/状态（名词后缀）'],
  ['ancy', '-ancy 性质/状态（名词后缀）'],
  ['ency', '-ency 性质/状态（名词后缀）'],
  ['ity', '-ity 性质（名词后缀）'],
  ['ty', '-ty 性质（名词后缀）'],
  ['ship', '-ship 身份/状态（名词后缀）'],
  ['hood', '-hood 身份/时期（名词后缀）'],
  ['dom', '-dom 领域/状态（名词后缀）'],
  ['ism', '-ism 主义/学说（名词后缀）'],
  ['ist', '-ist 人（名词后缀）'],
  ['eer', '-eer 从事…的人'],
  ['ian', '-ian 从事…的人'],
  ['ology', '-ology …学（名词后缀）'],
  ['graphy', '-graphy …学/记录法'],
  ['able', '-able 能够…的（形容词后缀）'],
  ['ible', '-ible 能够…的（形容词后缀）'],
  ['al', '-al …的（形容词后缀）'],
  ['ial', '-ial …的（形容词后缀）'],
  ['ic', '-ic …的（形容词后缀）'],
  ['ical', '-ical …的（形容词后缀）'],
  ['ive', '-ive 有…性质的（形容词后缀）'],
  ['ous', '-ous 充满…的（形容词后缀）'],
  ['ious', '-ious 充满…的（形容词后缀）'],
  ['ful', '-ful 充满…的（形容词后缀）'],
  ['less', '-less 无…的（形容词后缀）'],
  ['ly', '-ly …地（副词后缀）'],
  ['ize', '-ize 使…化（动词后缀）'],
  ['ise', '-ise 使…化（动词后缀）'],
  ['ify', '-ify 使…（动词后缀）'],
  ['ate', '-ate 使…（动词后缀）'],
  ['en', '-en 使…（动词后缀）'],
];

/**
 * 生成词根/派生说明
 * @param {string} word
 * @param {string} type 'core' | 'derived'
 */
function makeRootNote(word, type) {
  if (type === 'core') return '核心词';
  const w = word.toLowerCase();
  const parts = [];
  for (const [p, note] of PREFIXES) {
    // 前缀匹配：长度 >= 3 才命中，避免误判（如 "in" 命中 "ink"）
    if (p.length >= 3 && w.startsWith(p) && w.length > p.length + 2) {
      parts.push(note);
      break;
    }
  }
  // 后缀匹配，从长到短
  const sorted = [...SUFFIXES].sort((a, b) => b[0].length - a[0].length);
  for (const [s, note] of sorted) {
    if (s.length >= 3 && w.endsWith(s) && w.length > s.length + 2) {
      parts.push(note);
      break;
    }
  }
  if (parts.length === 0) return '派生词（由核心词根扩展而来）';
  return parts.join('；');
}

/* ---------------------------------------------------------------------------
 * 读入紧凑词表
 * 紧凑格式（TSV 风格，每行一词）：
 *   word \t phonetic \t translation \t type \t derivedFrom(可选)
 * type: c = core（核心词）, d = derived（派生词）
 * ------------------------------------------------------------------------ */
function parseCompact(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split('\t').map((s) => s.trim());
    const [word, phonetic, translation, t, derivedFrom] = cells;
    if (!word || !translation) continue;
    rows.push({
      word,
      phonetic: phonetic || '',
      translation,
      type: t === 'd' ? 'derived' : 'core',
      derivedFrom: derivedFrom || '',
    });
  }
  return rows;
}

function main() {
  const tableDir = path.join(__dirname, 'coreTables');
  if (!fs.existsSync(tableDir)) {
    console.error('[buildWordBank] 缺少 tools/coreTables 目录');
    process.exit(1);
  }
  const files = fs.readdirSync(tableDir).filter((f) => f.endsWith('.txt')).sort();

  const seen = new Map(); // word -> entry
  for (const f of files) {
    const text = fs.readFileSync(path.join(tableDir, f), 'utf8');
    for (const row of parseCompact(text)) {
      const key = row.word.toLowerCase();
      if (seen.has(key)) continue;
      seen.set(key, row);
    }
  }

  const words = [...seen.values()].map((row) => {
    let translation = row.translation;
    let rootNote;
    if (row.type === 'derived' && row.derivedFrom) {
      const base = row.derivedFrom;
      const baseEntry = seen.get(base.toLowerCase());
      const baseZh = baseEntry ? baseEntry.translation.split(/[；;，,]/)[0] : '';
      rootNote = `派生自 ${base}${baseZh ? `（${baseZh}）` : ''}；${makeRootNote(row.word, 'derived')}`;
    } else {
      rootNote = makeRootNote(row.word, row.type);
    }
    return {
      word: row.word,
      phonetic: row.phonetic,
      translation,
      root: rootNote,
      type: row.type,
      bank: 'cet6',
    };
  });

  words.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

  const outPath = path.join(ROOT, 'src', 'data', 'cet6Core.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(words), 'utf8');
  console.log(`[buildWordBank] 写入 ${words.length} 词 -> ${outPath}`);
}

main();
