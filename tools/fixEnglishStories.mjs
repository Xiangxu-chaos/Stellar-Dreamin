/**
 * 修复 story 字段：把历史遗留的「story 内容是英文句子」的条目，
 * 用 AI 重写成纯中文微故事（贴合领域），example / exampleZh 等其余字段保持不变。
 * 用法：node tools/fixEnglishStories.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/data/domainMaterials');

const key = (process.env.DEEPSEEK_API_KEY || readFileSync(path.join(ROOT, 'tools/.ai-key'), 'utf8')).trim();
const BASE = 'https://api.deepseek.com';
const MODEL = 'deepseek-chat';

const META = {
  honorOfKings: { zh: '王者荣耀', flavor: 'MOBA 对局：分路、防御塔、水晶、打野、团战、段位' },
  slayTheSpire: { zh: '杀戮尖塔', flavor: '卡牌构筑 Roguelike：能量、卡组、遗物、精英战、进阶难度' },
  hollowKnight: { zh: '空洞骑士', flavor: '类银河恶魔城：圣巢、护符、吉欧、Boss 战、地图探索' },
  valorant: { zh: '无畏契约', flavor: '战术射击：特工技能、下包、回合经济、枪械、点位控制' },
};

function looksEnglish(s) {
  const letters = [...String(s || '')].filter((c) => /[a-zA-Z]/.test(c));
  if (!letters.length) return false;
  const cn = [...String(s || '')].filter((c) => /[\u4e00-\u9fa5]/.test(c)).length;
  return letters.length >= 12 && cn === 0;
}

async function callAI(prompt) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: '你只输出合法 JSON。' }, { role: 'user', content: prompt }], temperature: 0.7, max_tokens: 3000, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const s = (j?.choices?.[0]?.message?.content || '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
}

let totalFixed = 0;
for (const [file, meta] of Object.entries(META)) {
  const p = path.join(DIR, file + '.json');
  const json = JSON.parse(readFileSync(p, 'utf8'));
  const targets = Object.entries(json.materials).filter(([, m]) => looksEnglish(m.story));
  if (!targets.length) { console.log(`${file}: 无需修复`); continue; }
  console.log(`\n=== ${file}：需重写 story ${targets.length} 条 ===`);
  for (let i = 0; i < targets.length; i += 10) {
    const chunk = targets.slice(i, i + 10);
    const list = chunk.map(([w, m], k) => `${k + 1}. ${w}（释义：${m.generalMeaning}；领域：${m.domainMeaning}）`).join('\n');
    const prompt = `为下列单词各写一句**纯中文**微故事/场景联想（<=30 字），语境贴合游戏《${meta.zh}》。
参考场景：${meta.flavor}
要求：只输出 JSON {"stories":{"<单词小写>":"<中文故事>"}}；故事必须是通顺中文，绝对不能出现英文单词；不要编造官方译名。

${list}`;
    let parsed = null;
    for (let a = 1; a <= 3; a++) {
      try { parsed = await callAI(prompt); if (parsed?.stories) break; } catch (e) { if (a === 3) console.warn('  失败:', e.message); }
      await new Promise((r) => setTimeout(r, 700 * a));
    }
    if (!parsed?.stories) continue;
    let n = 0;
    for (const [w] of chunk) {
      const k = Object.keys(parsed.stories).find((x) => x.toLowerCase() === w.toLowerCase());
      const st = k ? String(parsed.stories[k] || '').trim() : '';
      if (st && !looksEnglish(st)) { json.materials[w].story = st; n++; totalFixed++; }
    }
    json.materialsVersion = (json.materialsVersion || 1) + 1;
    writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`  批 ${Math.floor(i / 10) + 1}: 修复 ${n}/${chunk.length}`);
  }
}
console.log(`\n合计修复 story ${totalFixed} 条`);
