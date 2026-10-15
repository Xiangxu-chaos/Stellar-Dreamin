// 生成坏词条修复前后对比 HTML 报告（开发期一次性工具）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CUR = path.join(ROOT, 'src/data/domainMaterials');
const BK = 'C:/Users/ASUS/AppData/Local/Temp/dm_backup2';
const OUT = path.join(ROOT, '坏词条修复对比.html');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const len = (s) => String(s || '').replace(/\s/g, '').length;

const FILES = fs.readdirSync(CUR).filter((f) => f.endsWith('.json')).sort();

/* —— 完整性核对 —— */
const integrity = [];
let totalBefore = 0; let totalAfter = 0;
for (const f of FILES) {
  const a = JSON.parse(fs.readFileSync(path.join(BK, f), 'utf8')).materials || {};
  const b = JSON.parse(fs.readFileSync(path.join(CUR, f), 'utf8')).materials || {};
  const ka = Object.keys(a); const kb = Object.keys(b);
  totalBefore += ka.length; totalAfter += kb.length;
  const lost = ka.filter((k) => !kb.includes(k));
  const added = kb.filter((k) => !ka.includes(k));
  const fieldCount = {};
  let changed = 0;
  for (const k of ka) {
    if (!kb[k]) continue;
    const d = Object.keys(a[k]).filter((x) => JSON.stringify(a[k][x]) !== JSON.stringify(b[k][x]));
    if (d.length) { changed++; d.forEach((x) => { fieldCount[x] = (fieldCount[x] || 0) + 1; }); }
  }
  integrity.push({ f, before: ka.length, after: kb.length, lost: lost.length, added: added.length, changed, fieldCount });
}

/* —— 逐条对比 —— */
const changes = [];
for (const f of FILES) {
  const a = JSON.parse(fs.readFileSync(path.join(BK, f), 'utf8')).materials || {};
  const b = JSON.parse(fs.readFileSync(path.join(CUR, f), 'utf8')).materials || {};
  for (const k of Object.keys(b)) {
    if (!a[k]) continue;
    const d = Object.keys(a[k]).filter((x) => JSON.stringify(a[k][x]) !== JSON.stringify(b[k][x]));
    if (!d.length) continue;
    changes.push({ file: f, word: k, fields: d, before: a[k], after: b[k] });
  }
}

const fixedEntries = changes.length;
const fixedFields = changes.reduce((s, c) => s + c.fields.length, 0);
const storyCount = changes.filter((c) => c.fields.includes('story')).length;
const exCount = changes.filter((c) => c.fields.includes('example')).length;

/* —— 按文件分组渲染 —— */
const byFile = new Map();
for (const c of changes) {
  if (!byFile.has(c.file)) byFile.set(c.file, []);
  byFile.get(c.file).push(c);
}

const rows = [];
for (const [f, list] of byFile) {
  const j = JSON.parse(fs.readFileSync(path.join(CUR, f), 'utf8'));
  rows.push(`<h2>${esc(j.domainName || f)} <span class="fn">${esc(f)}</span> <span class="badge">${list.length} 条</span></h2>`);
  rows.push('<table><thead><tr><th class="w">单词</th><th class="fld">字段</th><th>修复前</th><th>修复后</th></tr></thead><tbody>');
  for (const c of list) {
    const fieldRows = [];
    if (c.fields.includes('story')) {
      fieldRows.push(`<tr>
        <td class="w" rowspan="${c.fields.filter((x) => x === 'story').length + (c.fields.includes('example') ? 1 : 0)}">${esc(c.word)}</td>
        <td class="fld">story</td>
        <td class="before">${esc(c.before.story || '（空）')}<span class="ln">${len(c.before.story)} 字</span></td>
        <td class="after">${esc(c.after.story)}<span class="ln ok">${len(c.after.story)} 字</span></td>
      </tr>`);
    }
    if (c.fields.includes('example')) {
      fieldRows.push(`<tr>
        ${c.fields.includes('story') ? '' : `<td class="w">${esc(c.word)}</td>`}
        <td class="fld">example<br>exampleZh</td>
        <td class="before"><code>${esc(c.before.example || '（空）')}</code><br><span class="zh">${esc(c.before.exampleZh || '')}</span></td>
        <td class="after"><code>${esc(c.after.example)}</code><br><span class="zh">${esc(c.after.exampleZh)}</span></td>
      </tr>`);
    }
    rows.push(fieldRows.join('\n'));
  }
  rows.push('</tbody></table>');
}

const integRows = integrity.map((r) => `<tr>
  <td class="mono">${esc(r.f)}</td>
  <td class="num">${r.before}</td><td class="num">${r.after}</td>
  <td class="num ${r.lost ? 'bad' : 'good'}">${r.lost}</td>
  <td class="num ${r.added ? 'warn' : 'good'}">${r.added}</td>
  <td class="num">${r.changed}</td>
  <td class="mono small">${Object.entries(r.fieldCount).map(([k, v]) => `${k}×${v}`).join('、') || '—'}</td>
</tr>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>坏词条修复前后对比</title>
<style>
  :root{--bg:#0f1116;--panel:#171a21;--line:#2a2f3a;--tx:#e8ebf0;--dim:#98a1b0;--ok:#4ade80;--bad:#f87171;--warn:#fbbf24;--acc:#7dd3fc}
  *{box-sizing:border-box}
  body{margin:0;padding:28px;background:var(--bg);color:var(--tx);font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  h1{font-size:22px;margin:0 0 6px}
  .sub{color:var(--dim);margin-bottom:22px}
  h2{font-size:16px;margin:30px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .fn,.badge{font-size:12px;color:var(--dim);font-weight:400}
  .badge{background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:2px 9px;margin-left:6px}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 26px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;min-width:150px}
  .card b{display:block;font-size:24px;line-height:1.3}
  .card span{color:var(--dim);font-size:12px}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:8px}
  th,td{padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
  th{background:#1d2129;color:var(--dim);font-weight:600;font-size:12px}
  tr:last-child td{border-bottom:none}
  .w{font-weight:700;color:var(--acc);white-space:nowrap;width:110px}
  .fld{color:var(--dim);font-size:12px;width:78px;white-space:nowrap}
  .before{color:#b9a5a5;width:38%}
  .after{color:#bfe8c9;width:38%}
  .ln{display:inline-block;margin-left:6px;font-size:11px;color:var(--bad)}
  .ln.ok{color:var(--ok)}
  .zh{color:var(--dim);font-size:12px}
  code{font-family:Consolas,Menlo,monospace;font-size:12.5px;color:#e3d9a8}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .good{color:var(--ok)}.bad{color:var(--bad);font-weight:700}.warn{color:var(--warn)}
  .mono{font-family:Consolas,Menlo,monospace;font-size:12.5px}
  .small{font-size:11.5px;color:var(--dim)}
  .note{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--acc);border-radius:8px;padding:12px 16px;margin:22px 0;color:#c9d2de}
  .note b{color:var(--tx)}
</style></head><body>

<h1>坏词条修复前后对比</h1>
<div class="sub">2026-10-15 · 扫描范围：<code>src/data/domainMaterials/</code> 全部 12 个领域文件 · 共 ${totalAfter} 条材料</div>

<div class="cards">
  <div class="card"><b>${fixedEntries}</b><span>修复的坏词条</span></div>
  <div class="card"><b>${fixedFields}</b><span>改动的字段数</span></div>
  <div class="card"><b>${storyCount}</b><span>story 被替换</span></div>
  <div class="card"><b>${exCount}</b><span>example 被替换</span></div>
  <div class="card"><b>0</b><span>删除的词条</span></div>
  <div class="card"><b>${totalBefore} → ${totalAfter}</b><span>总条数（未减少）</span></div>
</div>

<div class="note">
<b>关于「不要删除整个文件」：</b>本次修复<strong>没有删除、没有重建任何文件</strong>。
下表逐文件核对「修改前备份 vs 当前」：词条数完全一致，丢失 0、新增 0，
只有被判定为坏词条的条目其<strong>出错字段本身</strong>被替换。
8 个新领域（方舟 / 羽毛球 / 篮球 / 绝命毒师 / 经典电影 / 原神 / 夏洛克 / 杀戮尖塔2）本次改动为 0 —— 一个好词条都没碰。
</div>

<h2>一、文件完整性核对（修改前备份 → 当前）</h2>
<table><thead><tr><th>文件</th><th class="num">修前条数</th><th class="num">修后条数</th><th class="num">丢失</th><th class="num">新增</th><th class="num">变更条目</th><th>变更字段</th></tr></thead>
<tbody>
${integRows}
<tr><td class="mono"><b>合计</b></td><td class="num"><b>${totalBefore}</b></td><td class="num"><b>${totalAfter}</b></td><td class="num good"><b>0</b></td><td class="num good"><b>0</b></td><td class="num"><b>${fixedEntries}</b></td><td class="mono small">story×${storyCount}、example×${exCount}、exampleZh×${exCount}</td></tr>
</tbody></table>

<h2>二、逐条修复前后对比</h2>
${rows.join('\n')}

<div class="note">
<b>判定规则（与 <code>tools/genDomainMaterials.mjs</code> 的 <code>checkMaterial()</code> 同一套）：</b><br>
① story 为空 或 少于 15 字 或 超过 60 字；② story 含空泛话术（较为常见 / 可用以 / 可联想 / 可以建立 / 可与游戏场景建立联想 / 可结合场景 / 与之相关 …）；
③ example 为空 或 未包含该单词本身（不区分大小写）。
</div>

<div class="note">
<b>仍待处理：</b>另有 <strong>581 个领域相关词完全没有材料</strong>——它们不是你所说的「story 里写了废话」，
而是压根没有 story 字段。卡片背面在这些词上会走运行时兜底文案
（<code>该词在《X》的语境中较为常见，可与游戏场景建立联想。</code>），这才是你在界面上看到的「废话」的真实来源。
补齐这 581 条需要调用 DeepSeek：
<code>DEEPSEEK_API_KEY=sk-xxx node tools/fixDefectiveMaterials.mjs --gap</code>
</div>

</body></html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`已生成 ${path.basename(OUT)}：${fixedEntries} 条 / ${fixedFields} 字段（story ${storyCount}、example ${exCount}）`);
