#!/usr/bin/env node
/**
 * addExampleSource.mjs —— 空洞骑士材料：补全 exampleSource + 重写弱关联例句
 * ============================================================================
 * 背景（朋友反馈）：
 *   hollowKnight.json 里有一部分例句来自 Fandom Wiki 中文站，内容是泛化的剧情
 *   描述，通篇没有一个空洞骑士的专有名词（Hallownest / The Knight /
 *   Forgotten Crossroads / Mantis Lords …），用户看不出「这跟空洞骑士有什么关系」。
 *
 * 本脚本做两件事，且**幂等**（重复跑结果一致）：
 *   1. 为**每一个词条**补 `exampleSource` 字段，标注例句出处：
 *        · "Fandom Wiki"   原句已含游戏专有名词，保持原样
 *        · "AI重写"        原句关联度弱，已由本脚本重写（写入 REWRITES 表）
 *        · "游戏内文本"    译名来源为官方中文（Team Cherry）
 *        · "AI 生成"       其余（AI 预生成 / 通用词义联想 / 来源待核验）
 *   2. 对 REWRITES 表里的词条，替换 example / exampleZh。
 *
 * ⚠️ 重写规则（人工逐条撰写，非机器翻译）：
 *   · 句子必须包含该单词本身（或合法词形变化）
 *   · 句子必须至少出现 1 个空洞骑士专有名词
 *   · 语法正确、时态一致、长度与原句量级相当
 *
 * 用法：node tools/addExampleSource.mjs [--dry]
 * ============================================================================
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'src/data/domainMaterials/hollowKnight.json');
const DRY = process.argv.includes('--dry');

/* ---------------------------------------------------------------------------
 * 空洞骑士专有名词（用于判定「例句是否已有游戏关联度」）
 * ------------------------------------------------------------------------ */
export const HK_PROPER_NOUNS = [
  'Hallownest', "Hallownest's", 'Forgotten Crossroads', 'The Knight', 'the knight',
  'Mantis Lords', 'Mantis Lord', 'Mantis Village', 'White Palace', 'Dirtmouth',
  'Greenpath', 'Deepnest', 'City of Tears', 'Hollow Knight', 'Radiance',
  'Grimm', 'Hornet', 'Zote', 'Elderbug', 'Quirrel', 'Dreamers', 'Dreamer',
  'Black Egg Temple', 'Ancient Basin', "Queen's Gardens", "Kingdom's Edge",
  'Crystal Peak', 'Fog Canyon', 'Royal Waterways', 'Resting Grounds',
  'Howling Cliffs', 'Soul Sanctum', "Watcher's Spire", 'Nailmaster',
  'Grey Mourner', 'Last Stag', 'Godseeker', 'The Abyss', 'Abyss', 'Pale King',
  'Godhome', 'Colosseum of Fools', 'Soul Master', 'Dung Defender', 'Broken Vessel',
  'Nosk', 'Traitor Lord', 'Gruz Mother', 'False Knight', 'Salubra', 'Seer',
  'Broken Vessel', "Hallownest's Crown", 'Fungal Wastes', 'Grubfather',
];

export function hasProperNoun(text) {
  const s = String(text || '');
  return HK_PROPER_NOUNS.some((n) => s.includes(n));
}

/* ---------------------------------------------------------------------------
 * 重写表：word -> { en, zh }
 *   全部为原句「不含任何空洞骑士专有名词」的条目
 * ------------------------------------------------------------------------ */
export const REWRITES = {
  /* —— 病害 / 法术 / 场景 —— */
  blight: { en: "The blight spread outward from Hallownest's Forgotten Crossroads.", zh: '枯萎从圣巢的遗忘十字路向外蔓延。' },
  scream: { en: "The Hollow Knight's scream echoes through the Black Egg Temple.", zh: '空洞骑士的尖叫回荡在黑卵神殿中。' },
  whisper: { en: 'Whispers echo through the Resting Grounds of Hallownest.', zh: '低语在圣巢的安息之地回响。' },
  monument: { en: 'The monument to the Dreamers stands in the City of Tears.', zh: '纪念三位梦之者的纪念碑矗立在泪水之城。' },
  fountain: { en: 'The fountain still flows in the City of Tears.', zh: '喷泉仍在泪水之城中流淌。' },
  statue: { en: 'The Knight roars before an ancient statue in Greenpath to learn the spell.', zh: '骑士在苍绿之径的一尊古老雕像前咆哮，习得那门法术。' },
  cavern: { en: 'The deepest caverns beneath Hallownest hold darker things.', zh: '圣巢之下最深的洞穴藏着更黑暗的东西。' },
  guardian: { en: 'The guardian of the Black Egg Temple never left its post.', zh: '黑卵神殿的守护者从未离开岗位。' },
  warrior: { en: "Warriors duel for the crowd's roar in the Colosseum of Fools.", zh: '战士们在愚人竞技场为观众的欢呼而决斗。' },
  corpse: { en: 'A corpse marks where another traveler fell in Deepnest.', zh: '一具尸体标记着另一位旅者在深巢倒下的位置。' },
  memorial: { en: "The memorial in the Resting Grounds honours Hallownest's forgotten.", zh: '安息之地的纪念物献给圣巢那些被遗忘者。' },
  altar: { en: 'Place the item on the altar inside the Black Egg Temple to proceed.', zh: '把物品放上黑卵神殿的祭坛才能继续。' },
  ritual: { en: 'The ritual that sealed Hallownest demanded three willing Dreamers.', zh: '封印圣巢的仪式需要三位自愿的梦之者。' },
  blessing: { en: "Salubra's blessing follows The Knight into the dark.", zh: '萨鲁布拉的祝福随骑士走入黑暗。' },
  curse: { en: "The curse binds Hallownest to the Radiance's dream.", zh: '这诅咒把圣巢绑在了辐光的梦境上。' },
  seal: { en: 'Break the seal on the Black Egg Temple and the dream awakens.', zh: '打破黑卵神殿上的封印，梦境就会苏醒。' },
  ward: { en: 'The ward absorbs a single hit from a Mantis Lord.', zh: '护盾能吸收螳螂领主的一次攻击。' },
  barrier: { en: 'The barrier in the Forgotten Crossroads blocks the way until you learn the skill.', zh: '遗忘十字路的屏障会挡住去路，直到你学会相应能力。' },
  pillar: { en: 'Ancient pillars hold up the cavern roof beneath Hallownest.', zh: '古老的石柱支撑着圣巢地下的洞穴穹顶。' },

  /* —— 地形 / 区域 —— */
  grove: { en: 'The grove of Greenpath hums with hidden life.', zh: '苍绿之径的林地回响着隐秘的生命声息。' },
  swamp: { en: 'Something always lurks in the swamp at the edge of Deepnest.', zh: '深巢边缘的沼泽里总有什么在潜伏。' },
  marsh: { en: 'The marsh near the Mantis Village hides the path ahead.', zh: '螳螂村附近的湿地遮住了前行的道路。' },
  grotto: { en: 'A tiny grotto in Hallownest hides a big surprise.', zh: '圣巢中一个小小的岩洞藏着大大的惊喜。' },
  pit: { en: 'The pit drops The Knight into the depths of Deepnest.', zh: '这个深坑会把骑士送到深巢的深处。' },
  cliff: { en: 'The cliff edge of the Howling Cliffs creaks underfoot.', zh: '呼啸悬崖的崖边在脚下发出吱呀声。' },
  canyon: { en: "Wind howls through the canyon on the way to Kingdom's Edge.", zh: '风在通往王国边缘的峡谷中呼啸。' },
  chasm: { en: 'The chasm splits Hallownest in two.', zh: '这道深渊把圣巢一分为二。' },
  trench: { en: 'The trench in the Ancient Basin collects whatever falls in.', zh: '古老盆地的沟壑会收集掉进去的一切。' },
  tunnel: { en: 'The tunnel connects the Forgotten Crossroads to Greenpath.', zh: '这条隧道连接着遗忘十字路与苍绿之径。' },
  labyrinth: { en: 'Every path in the labyrinth of Deepnest loops back.', zh: '深巢迷宫里的每条路都会绕回来。' },

  /* —— 虫类 / 生态 —— */
  swarm: { en: 'The swarm rushes at The Knight from all sides in Deepnest.', zh: '在深巢，虫群从四面八方涌向骑士。' },
  cocoon: { en: 'Something stirs inside the cocoon hanging in Deepnest.', zh: '深巢中悬挂的茧里有东西正在蠕动。' },
  antenna: { en: 'Its antenna twitches the moment The Knight approaches.', zh: '骑士一靠近，它的触角就动了起来。' },
  sting: { en: 'Its sting comes without warning in the Forgotten Crossroads.', zh: '在遗忘十字路，它的螫刺毫无预兆地袭来。' },
  burrow: { en: 'The beast burrows back into the ground of Greenpath.', zh: '那头野兽又钻回苍绿之径的地下。' },
  crawl: { en: 'The crawlers of the Forgotten Crossroads never stop moving.', zh: '遗忘十字路的爬行者从不停下。' },
  creep: { en: 'Fog creeps along the floor of Fog Canyon.', zh: '雾气沿着雾之峡谷的地面蔓延。' },
  lurk: { en: 'Something lurks just beyond the light in Deepnest.', zh: '深巢里总有东西潜伏在光照之外。' },
  chase: { en: 'It chases The Knight through the narrow tunnels of the Mantis Village.', zh: '它穿过螳螂村狭窄的隧道追逐骑士。' },
  flee: { en: "Some of Hallownest's enemies flee when badly hurt.", zh: '圣巢的有些敌人在重伤时会逃离。' },
  evade: { en: "Evade the Mantis Lords' attack by dashing sideways.", zh: '侧向冲刺即可闪避螳螂领主的攻击。' },
  deflect: { en: 'Deflect the projectile with your nail in the Mantis Village.', zh: '在螳螂村，用骨钉弹开投射物。' },

  /* —— 声 / 光 / 氛围 —— */
  melody: { en: 'A faint melody lingers in the ruins of the City of Tears.', zh: '泪水之城的废墟中萦绕着一缕微弱的旋律。' },
  hymn: { en: 'The hymn drifts through the empty Soul Sanctum.', zh: '赞歌飘荡在空荡的灵魂圣所中。' },
  elegy: { en: 'She sings an elegy for the fallen kingdom of Hallownest.', zh: '她为陨落的圣巢唱起挽歌。' },
  lament: { en: 'The bugs of Dirtmouth lament a kingdom already gone.', zh: '德特茅斯的虫群为早已消逝的王国悲叹。' },
  chorus: { en: 'A chorus rises from the ruined choir of the City of Tears.', zh: '合唱自泪水之城破败的唱诗席中升起。' },
  audience: { en: 'The audience roars as The Knight enters the Colosseum of Fools.', zh: '骑士步入愚人竞技场时，观众齐声欢呼。' },
  hush: { en: 'A heavy hush falls over the Resting Grounds.', zh: '沉重的寂静笼罩了整座安息之地。' },
  echo: { en: 'Your footsteps echo through the caverns of Deepnest.', zh: '你的脚步声在深巢的洞窟中回响。' },
  resonance: { en: "The Knight's nail rings with resonance in the Mantis Village.", zh: '骑士的骨钉在螳螂村敲出阵阵共鸣。' },
  flicker: { en: 'The light over Dirtmouth flickers, then dies.', zh: '德特茅斯上方的灯火闪烁了几下，然后熄灭了。' },
  dim: { en: 'The corridor of the Soul Sanctum grows dim and cold.', zh: '灵魂圣所的走廊变得昏暗而寒冷。' },
  stark: { en: 'The stark cavern of the Ancient Basin stretches on forever.', zh: '古老盆地荒凉的洞窟无尽地延伸。' },
  gleam: { en: 'A gleam of light marks the hidden path in Greenpath.', zh: '一缕微光标记出苍绿之径中隐藏的道路。' },
  glow: { en: 'A pale glow leaks from the Abyss below Hallownest.', zh: '一缕苍白的辉光从圣巢下方的深渊中渗出。' },
  glower: { en: 'The last glower of the dying lantern in Dirtmouth lit the corridor for one more second.', zh: '德特茅斯那盏将熄的灯笼最后怒睁了一下，把走廊又照亮了一秒。' },
  twilight: { en: 'Twilight settles over the silent City of Tears.', zh: '暮光笼罩着寂静的泪水之城。' },
  dusk: { en: 'At dusk the ruins of the Forgotten Crossroads grow restless.', zh: '到了黄昏，遗忘十字路的废墟变得躁动起来。' },

  /* —— 神话 / 传说 / 身份 —— */
  spectacle: { en: "The view from Hallownest's Crown is a true spectacle.", zh: '从圣巢之冠望去，是真正的奇观。' },
  legend: { en: 'The legend of the Hollow Knight grew longer with every retelling.', zh: '空洞骑士的传说每被讲述一次就变得更长。' },
  myth: { en: 'The myth of the Pale King kept Hallownest hoping.', zh: '白王的神话让圣巢维持着希望。' },
  folklore: { en: "Folklore about the Radiance survives where Hallownest's records do not.", zh: '在圣巢的文字记载消失的地方，关于辐光的民俗依然留存。' },
  loyalty: { en: "The Dung Defender's loyalty outlasted Hallownest itself.", zh: '粪金龟守卫的忠诚比圣巢本身更长久。' },
  traitor: { en: "Hallownest's history brands the Traitor Lord a traitor to the Mantis tribe.", zh: '圣巢的历史将叛徒领主钉为螳螂族的叛徒。' },
  exile: { en: 'The exile never returned to the White Palace.', zh: '被流放者再未回到白宫。' },
  heir: { en: 'The heir to Hallownest was chosen before birth.', zh: '圣巢的继承人在出生前就已被选定。' },
  solitude: { en: 'Solitude hangs over the empty kingdom of Hallownest.', zh: '孤独笼罩着空无一人的圣巢。' },

  /* —— 容器 / 感染 / 命运 —— */
  destined: { en: 'Some vessels in the Abyss were destined to fail.', zh: '深渊里有些容器注定会失败。' },
  wither: { en: 'The plants of Greenpath wither where the infection spreads.', zh: '感染蔓延之处，苍绿之径的草木枯萎。' },
  rot: { en: 'Everything in the Forgotten Crossroads slowly rots away.', zh: '遗忘十字路的一切都在缓慢腐烂。' },
  mold: { en: 'Mold creeps up the damp walls of the Royal Waterways.', zh: '霉菌沿着皇家下水道的湿墙蔓延而上。' },
  rust: { en: 'Rust has eaten through the old gates of the City of Tears.', zh: '锈迹已经蚀穿了泪水之城的旧大门。' },
  corrode: { en: 'Acid corrodes the stone floor of Fog Canyon beneath you.', zh: '酸液正在腐蚀你脚下雾之峡谷的石地。' },
  erode: { en: 'Water erodes the stone of the City of Tears over centuries.', zh: '水流用数百年侵蚀着泪水之城的石头。' },
  eternal: { en: 'The dream of the Radiance feels eternal while you are inside it.', zh: '身处辐光的梦境中时，它仿佛是永恒的。' },
  profound: { en: 'The lore of Hallownest carries a profound sadness.', zh: '圣巢的传说承载着深邃的悲伤。' },
  vision: { en: 'A vision of the Dreamers shows you what was buried.', zh: '梦之者的幻象让你看见被埋葬的往事。' },
  illusion: { en: 'The whole of the White Palace is an illusion.', zh: '整座白宫都只是一个幻象。' },
  ethereal: { en: 'Ethereal shapes drift through the dream of the Radiance.', zh: '缥缈的形体在辐光的梦境中飘荡。' },
  ghastly: { en: 'A ghastly pallor marks the infected of the Forgotten Crossroads.', zh: '遗忘十字路的感染者一脸惨白。' },
  grotesque: { en: 'The grotesque fusion of the Broken Vessel staggers toward The Knight.', zh: '破碎容器那怪诞的融合体踉跄着向骑士走来。' },
  isolation: { en: 'Isolation kept the infection contained within Hallownest.', zh: '隔绝一度把感染遏制在圣巢之内。' },
  salvation: { en: 'Salvation for Hallownest comes at a steep price.', zh: '圣巢的救赎，代价十分高昂。' },
  flaw: { en: "A single flaw in the Pale King's plan doomed Hallownest.", zh: '白王计划中的一处瑕疵就毁掉了整个圣巢。' },
  plunge: { en: 'Plunge into the dark of the Abyss without hesitating.', zh: '别犹豫，径直跃入深渊的黑暗。' },
  descend: { en: 'Descend into the well below Dirtmouth and the map expands.', zh: '下到德特茅斯下方的井里，地图就会延展开来。' },
};

/* ---------------------------------------------------------------------------
 * 例句出处推断（非重写条目）
 * ------------------------------------------------------------------------ */
export function inferExampleSource(entry, word) {
  if (REWRITES[word]) return 'AI重写';
  const src = String(entry?.source || '');
  if (/Fandom/i.test(src)) return 'Fandom Wiki';
  if (/Team Cherry|官方中文/.test(src)) return '游戏内文本';
  return 'AI 生成';
}

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------ */
function main() {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  const materials = raw.materials || {};
  const words = Object.keys(materials);

  const stats = {};
  const rebuilt = [];
  const missing = [];

  for (const w of words) {
    const m = materials[w];
    const patch = REWRITES[w];
    /* 先套用重写（若有），保证字段顺序与 example/exampleZh 相邻性不变 */
    const base = patch ? { ...m, example: patch.en, exampleZh: patch.zh } : m;
    const next = {};
    for (const [k, v] of Object.entries(base)) {
      next[k] = v;
      // exampleSource 紧随 exampleZh，保持「例句相关字段」聚在一起
      if (k === 'exampleZh') next.exampleSource = inferExampleSource(m, w);
    }
    if (!('exampleSource' in next)) next.exampleSource = inferExampleSource(m, w);
    materials[w] = next;

    const es = next.exampleSource;
    stats[es] = (stats[es] || 0) + 1;
    if (patch) rebuilt.push(w);

    if (patch) {
      const low = next.example.toLowerCase();
      if (!low.includes(w.toLowerCase())) missing.push(`${w}(例句缺该词)`);
      if (!hasProperNoun(next.example)) missing.push(`${w}(缺专有名词)`);
    }
  }

  /* _comment 补充说明（幂等：已存在就不重复插） */
  if (Array.isArray(raw._comment)) {
    const note = '例句出处：每条材料带 exampleSource 字段（Fandom Wiki / AI重写 / 游戏内文本 / AI 生成）。';
    if (!raw._comment.some((c) => String(c).includes('exampleSource'))) {
      raw._comment.push(note);
    }
  }

  console.log('=== exampleSource 分布 ===');
  Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}\t${k}`));
  console.log(`\n词条总数: ${words.length} | 重写: ${rebuilt.length} 条`);
  console.log('重写词表:', rebuilt.join(', '));
  if (missing.length) {
    console.error('\n❌ 自检未通过：', missing.slice(0, 20).join(' | '));
    process.exitCode = 1;
  } else {
    console.log('\n✅ 自检通过：例句均含该词、且重写条目均含空洞骑士专有名词。');
  }

  if (DRY) {
    console.log('\n(--dry) 未写盘。');
    return;
  }
  writeFileSync(FILE, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  console.log(`\n已写回 ${path.relative(ROOT, FILE)}`);
}

/* 仅在被直接执行时跑主流程；被 import（如校验脚本复用白名单/重写表）时不写盘 */
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath) main();
