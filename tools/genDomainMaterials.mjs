#!/usr/bin/env node
/**
 * genDomainMaterials.mjs —— 新增兴趣领域的预生成记忆材料生成器（分批）
 * ============================================================================
 * 为什么用脚本生成而不是手写 JSON：
 *   1. 每条材料有 10 个字段，手写 200 条极易出现「少一个字段 / 引号错位」；
 *   2. 生成前可以机械校验（含该单词、example 非空、imageUrl 必为 ''、
 *      unverified 必须是 boolean），不合格直接退出，不落盘；
 *   3. 幂等：同样的输入永远产出同样的 JSON，方便 diff 与回滚。
 *
 * 用法：
 *   node tools/genDomainMaterials.mjs --domain=slay_the_spire2   # 只生成一个领域
 *   node tools/genDomainMaterials.mjs --batch=1                  # 生成第 N 批
 *   node tools/genDomainMaterials.mjs --all
 *   追加 --dry 只校验不写盘。
 *
 * ⚠️ 本脚本只在开发期跑，运行时不调用任何 AI、不产生任何网络请求。
 * ============================================================================
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/data/domainMaterials');

/* ---------------------------------------------------------------------------
 * DeepSeek 接入（仅开发期使用；运行时永不调用 AI）
 *   Key 读取顺序：环境变量 DEEPSEEK_API_KEY → 项目根 .deepseek-key 文件（可选）
 *   ⚠️ 任何情况下都不要把 Key 硬编码进本文件，也不要提交到版本库。
 *   用法：DEEPSEEK_API_KEY=sk-xxx node tools/genDomainMaterials.mjs --all
 * ------------------------------------------------------------------------ */
export const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE || 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export function getDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const keyFile = path.join(ROOT, '.deepseek-key');
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  return '';
}

export function hasDeepSeekKey() {
  return getDeepSeekKey().length > 0;
}

/**
 * 调用 DeepSeek Chat Completions，返回助手文本。
 * @param {Array<{role:string, content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number, timeoutMs?:number, json?:boolean}} opts
 */
export async function deepseekChat(messages, opts = {}) {
  const key = getDeepSeekKey();
  if (!key) throw new Error('缺少 DEEPSEEK_API_KEY（请设置环境变量，或写入项目根 .deepseek-key 文件）');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180000);
  try {
    const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 8000,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`);
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`DeepSeek 返回非 JSON：${text.slice(0, 200)}`); }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`DeepSeek 返回无内容：${text.slice(0, 200)}`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * 译名来源常量（每条材料的 source 字段必须指向其中之一）
 * ------------------------------------------------------------------------ */
const SRC = {
  sts2: '杀戮尖塔2 中文资料库 sts2.urarawin.com / Steam 官方中文',
  sts2Community: 'NGA 杀戮尖塔社区共识（官方中文未固定该译名）',
  ak: '明日方舟官网 ak.hypergryph.com / 国际服 arknights.yo-star.com',
  gi: '原神官网 ys.mihoyo.com（官方中文术语表）',
  bb: '绝命毒师官方中文（AMC 官方中文物料 / 索尼影视中文发行版）',
  bbCommunity: '绝命毒师中文社区通行译名（官方未统一该译名）',
  sh: '神探夏洛克官方中文（BBC 官方中文字幕 / 柯南·道尔原著中文译名）',
  cm: '经典电影官方中文片名（中国进口片发行译名 / 豆瓣电影条目）',
  bk: '篮球官方中文（NBA 中国官网 nba.com/china / 中国篮协 CBA 官网 cbaleague.com 术语）',
  bd: '羽毛球官方中文（中国羽毛球协会 / 世界羽联 BWF 中文赛事名称）',
};

/* 材料构造器：统一补齐 imageUrl / exampleSource 并保证字段顺序 */
function M(root, generalMeaning, domainMeaning, story, example, exampleZh, source, opts = {}) {
  return {
    root,
    generalMeaning,
    domainMeaning,
    story,
    example,
    exampleZh,
    exampleSource: opts.exampleSource || 'AI 生成',
    imageUrl: '',
    source,
    unverified: Boolean(opts.unverified),
  };
}

/* ==========================================================================
 * 第一批（游戏）
 * ======================================================================= */

/* --------------------------------------------------------------------------
 * 杀戮尖塔2 · Slay the Spire 2
 * 译名核验来源：Mega Crit 开发者访谈（游侠网 2025-12-05 转载）确认
 *   「亡灵契约师」（The Necrobinder）为官方中文名；
 *   中文资料库 sts2.urarawin.com 另给出「储君」（The Regent）、
 *   「奥斯提」（Osty）、「缚魂命匣」（初始遗物）等界面译名。
 *   Doom 的中文在社区有「厄运」「灾厄」两种写法，未固定 → unverified: true。
 * ----------------------------------------------------------------------- */
const SLAY_THE_SPIRE_2 = {
  domainId: 'slayTheSpire2',
  domainName: '杀戮尖塔2',
  domainIdInConfig: 'slay_the_spire2',
  gameNameEn: 'Slay the Spire 2',
  file: 'slayTheSpire2.json',
  materialsVersion: 1,
  batch: 1,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '译名以 Mega Crit 官方中文（Steam 简体中文 / 开发者访谈）为准，辅以中文资料库 sts2.urarawin.com 核验。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有游戏相关图片版权归 Mega Crit / Steam 及原作者所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    summon: M('核心词 · 来自拉丁语 summonere（私下提醒）',
      'v. 召唤，传唤；召集；鼓起（勇气）',
      '召唤。亡灵契约师（The Necrobinder）的核心机制：战斗中召唤她可靠的左手「奥斯提」（Osty）替她挡刀。',
      '奥斯提是一根有独立血条的骨手——敌人打他，就等于没打你。',
      'The Necrobinder can summon Osty, a giant skeletal hand, to fight at her side.',
      '亡灵契约师可以召唤奥斯提——一只巨大的骷髅手——并肩作战。',
      SRC.sts2),

    soul: M('核心词',
      'n. 灵魂，心灵；精神；精髓',
      '灵魂。亡灵契约师专属的资源卡：打出后进入手牌循环，为「灵魂」体系提供续航。',
      '一手都是灵魂牌并不亏——它们是下一回合的子弹。',
      'Souls keep flowing into the Necrobinder\'s hand, and every one of them fuels Osty.',
      '灵魂不断涌入亡灵契约师的手中，每一张都在为奥斯提供能。',
      SRC.sts2),

    doom: M('核心词 · 古英语 dom（判决）',
      'n. 毁灭，厄运；死亡；v. 注定，宣判',
      '厄运／灾厄。给敌人叠加的层数一旦超过其当前生命值，敌人直接死亡，属于「跳过血条」的即死机制。',
      '与其把首领磨到 0 血，不如把厄运叠到它头上。',
      'Stack enough Doom on a boss and the Necrobinder ends the fight without touching its health bar again.',
      '只要把厄运叠得够高，亡灵契约师无需再碰首领的血条就能结束战斗。',
      SRC.sts2Community,
      { unverified: true }),

    revenge: M('派生词 · 来自拉丁语 revindicare（重新主张）',
      'n. 复仇，报复',
      '复仇。亡灵契约师的背景动机——她是一位出生于尖塔、只为复仇而爬塔的巫妖。',
      '她不是为了心脏而爬塔，是为了某个人。',
      'The Necrobinder climbs the Spire for revenge rather than for relics or glory.',
      '亡灵契约师攀爬尖塔是为了复仇，而不是为了遗物或荣耀。',
      SRC.sts2),

    resurrect: M('派生词 · 来自拉丁语 resurgere（再升起）',
      'v. 使复活，使复苏；恢复（某种状态）',
      '复活。围绕骸骨与灵魂的重生体系——奥斯提倒下后仍能被重新召唤回场。',
      '骨手碎了不要紧，下一张牌就是它的第二次登场。',
      'Even when Osty is shattered, the Necrobinder can resurrect him later in the same fight.',
      '即便奥斯提被打碎，亡灵契约师也能在同一场战斗里让他复活。',
      SRC.sts2),

    corpse: M('核心词 · 来自拉丁语 corpus（身体）',
      'n. 尸体，残骸',
      '尸体／残骸。尖塔地牢里随处可见的遗骸，是死灵体系的燃料与场景符号。',
      '走廊尽头堆着的不是垃圾，是这座塔的历史。',
      'Corpses line the corridors of the Spire, and the Necrobinder treats each one as a resource.',
      '尖塔的走廊里堆满尸体，而亡灵契约师把每一具都当成资源。',
      SRC.sts2),

    sacrifice: M('核心词 · 来自拉丁语 sacer（神圣的）+ facere（做）',
      'n./v. 牺牲，献祭；舍弃（利益）',
      '献祭。以生命值或奥斯提的血量为代价换取高额收益的高风险打法。',
      '把骨手当一次性核弹扔出去，也是一种浪漫。',
      'Sacrifice Osty for a burst of damage, or keep him alive as your shield — the choice is yours.',
      '是把奥斯提献祭掉打一波爆发，还是留着他当护盾——由你决定。',
      SRC.sts2),

    companion: M('派生词 · 来自拉丁语 com（共同）+ panis（面包）',
      'n. 同伴，伙伴；陪伴',
      '同伴。奥斯提是亡灵契约师唯一固定的战斗同伴，共享一整场战斗的生死。',
      '她是巫妖，可她的左手比很多活人更讲义气。',
      'Osty is the Necrobinder\'s only companion, and he takes every hit aimed at her.',
      '奥斯提是亡灵契约师唯一的同伴，替她挡下每一次攻击。',
      SRC.sts2),

    vessel: M('核心词 · 来自拉丁语 vas（容器）',
      'n. 容器，器皿；（诗）船；血管',
      '容器。尖塔世界观里「器」的概念——承载力量或灵魂的躯壳。',
      '亡灵契约师把躯体当作容器，装得下多少灵魂，就敢挑战多深的尖塔。',
      'A body is only a vessel, and the Necrobinder knows exactly what she wants to pour into it.',
      '躯体不过是容器，而亡灵契约师很清楚自己要在里面装什么。',
      SRC.sts2),

    relic: M('核心词 · 来自拉丁语 relinquere（留下）',
      'n. 遗物，遗迹；（宗教）圣物',
      '遗物。爬塔流程中提供被动效果的收藏品，与前作一脉相承。',
      '遗物不会说话，但它们替你打过每一场架。',
      'Every relic the Necrobinder picks up on the way up the Spire changes how the run unfolds.',
      '亡灵契约师在爬塔途中捡到的每一件遗物，都在改变这一局的走向。',
      SRC.sts2),

    exhaust: M('核心词 · 来自拉丁语 exhaurire（抽干）',
      'v. 耗尽，使精疲力竭；n.（发动机）排气',
      '消耗。卡牌被打出后直接移出本场战斗，不再洗回抽牌堆的关键词。',
      '有些牌就是一次性的，用它的时候别心疼。',
      'The Necrobinder exhausts cheap cards all run long to keep her deck lean.',
      '亡灵契约师整局都在消耗廉价卡牌，好让卡组保持精干。',
      SRC.sts2),

    ethereal: M('派生词 · 来自希腊语 aither（高空清气）',
      'adj. 空灵的，缥缈的；非实体的',
      '虚无。关键词「虚无」的英文原文：回合结束时若仍在手中，该牌自动消耗。',
      '握不住的牌，留到回合结束就会自己消失。',
      'An ethereal card slips away at the end of the turn unless the Necrobinder plays it in time.',
      '虚无的牌如果没能及时打出，就会在回合结束时悄然消失。',
      SRC.sts2),

    ascend: M('核心词 · 来自拉丁语 ascendere（上升）',
      'v. 上升，登高；晋升',
      '进阶。通关后解锁的难度层级，层数越高，塔里的敌人越狠。',
      '进阶 10 之后，塔才真正开始说话。',
      'Ascending the Spire is easy; surviving the higher Ascension levels is not.',
      '爬上尖塔不难，难的是在更高的进阶等级里活下来。',
      SRC.sts2),

    descend: M('核心词 · 来自拉丁语 descendere（下降）',
      'v. 下降，下来；传下来（血统、财产）',
      '下坠。尖塔2 中贯穿上下层的地形叙事：越往下走，越接近不可名状的东西。',
      '别的挑战者拼命往上攀登，亡灵契约师却一路向下，因为尖塔越深，真相越沉。',
      'The deeper the Necrobinder descends, the more the Spire seems to breathe.',
      '亡灵契约师向下走得越深，尖塔就越像在呼吸。',
      SRC.sts2),

    intent: M('核心词 · 来自拉丁语 intendere（伸向）',
      'n. 意图，目的；专注；adj. 专注的',
      '意图。敌人头顶显示下一回合行动的图标，看错意图就等着挨打。',
      '先看意图，再出牌——这是尖塔里最便宜的一课。',
      'Reading the enemy\'s intent before playing a card keeps the Necrobinder alive.',
      '出牌前先读敌人的意图，是亡灵契约师活下来的关键。',
      SRC.sts2),

    vulnerable: M('派生词 · 来自拉丁语 vulnerare（使受伤）',
      'adj. 易受伤害的，脆弱的；有弱点的',
      '易伤。负面状态：受到攻击时额外承受 50% 伤害。',
      '给敌人挂上易伤，等于给每一张攻击牌加了 50%。',
      'A vulnerable enemy takes half again as much damage from every attack the Necrobinder lands.',
      '处于易伤状态的敌人，会多承受亡灵契约师一半的攻击伤害。',
      SRC.sts2),

    frail: M('核心词 · 来自古法语 fraile（脆弱）',
      'adj. 虚弱的，脆弱的；（身体）孱弱的',
      '虚弱无力。负面状态：获取的格挡值减少 25%，让你从「抗得住」变成「扛不住」。',
      '少的那 25% 格挡，往往就是生死之差。',
      'Frail cuts the Necrobinder\'s block by a quarter, and Osty pays the difference.',
      '虚弱无力削去亡灵契约师四分之一的格挡，而差额全由奥斯提来扛。',
      SRC.sts2),

    dexterity: M('派生词 · 来自拉丁语 dexter（右边的、灵巧的）',
      'n. 敏捷，灵巧；（手的）熟练',
      '敏捷。正面状态：每点敏捷让每张防御牌多提供 1 点格挡。',
      '敏捷堆起来以后，一张防御牌就能挡住半个回合。',
      'A few points of dexterity turn the Necrobinder\'s cheapest defense cards into walls.',
      '几点敏捷就能把亡灵契约师最便宜的防御牌变成一堵墙。',
      SRC.sts2),

    discard: M('核心词 · 来自 dis（分开）+ card（牌）',
      'v. 丢弃，抛弃；n. 废弃物',
      '弃牌。把不需要的牌丢进弃牌堆，抽牌堆洗空后回收再利用。',
      '丢掉的牌不是没了，是在排队等下一次抽到。',
      'Discarding a weak card early is often better than holding it all turn.',
      '把一张废牌早点丢弃，往往比整回合攥在手里更好。',
      SRC.sts2),

    retain: M('核心词 · 来自拉丁语 retinere（保持）',
      'v. 保留，保持；记住；聘请',
      '保留。关键词：带「保留」的牌在回合结束时不会被丢弃，可以留到关键回合再打。',
      '把好牌留到首领回合，是爬塔的基本教养。',
      'Cards with retain let the Necrobinder hold her answer until the moment Osty needs it.',
      '带保留的牌让亡灵契约师能把答案攥到奥斯提最需要的那一刻。',
      SRC.sts2),

    innate: M('派生词 · 来自拉丁语 innatus（天生的）',
      'adj. 天生的，固有的，先天的',
      '固有。关键词：带「固有」的牌一定会出现在每场战斗的起手手牌里。',
      '开局就在手上的牌，决定你这局的第一句话说什么。',
      'An innate card is guaranteed to be in the Necrobinder\'s opening hand every fight.',
      '带固有的牌一定会出现在亡灵契约师每场战斗的起手手牌中。',
      SRC.sts2),

    ritual: M('核心词 · 来自拉丁语 ritus（仪式）',
      'n. 仪式，典礼；例行公事；adj. 仪式的',
      '仪式。尖塔里的献祭、祈祷与强化流程，也是部分诅咒与增益的来源。',
      '在尖塔里，仪式从来不只是走过场。',
      'The Necrobinder performs an old ritual at every rest site, and the Spire listens.',
      '亡灵契约师在每个休息处都会举行一场古老的仪式，而尖塔在听。',
      SRC.sts2),

    oblivion: M('核心词 · 来自拉丁语 oblivisci（忘记）',
      'n. 遗忘，湮没；被遗忘的状态',
      '湮没。尖塔的终局母题：爬得越高，被记住的越少。',
      '爬到塔顶的人，名字常常留在半路上。',
      'The Necrobinder climbed for revenge, but the Spire offers only oblivion.',
      '亡灵契约师为复仇而攀爬，而尖塔只回赠湮没。',
      SRC.sts2),

    cooperative: M('派生词 · 来自拉丁语 cooperari（共同工作）',
      'adj. 合作的，协作的；n. 合作模式',
      '合作模式。杀戮尖塔2 新增的多人玩法：多名玩家在同一座塔里互相支援。',
      '一个人读意图，一个人算伤害——塔里终于有人帮你分担了。',
      'In the new cooperative mode, one player reads intents while another counts Osty\'s health.',
      '在新增的合作模式里，一名玩家读意图，另一名玩家数奥斯提的血量。',
      SRC.sts2),
  },
};

/* --------------------------------------------------------------------------
 * 明日方舟 · Arknights
 * 译名核验来源：官方站点（ak.hypergryph.com 简体中文 / arknights.yo-star.com
 *   国际服）逐条给出的中英对照：Originium=源石、Originium Arts=源石技艺、
 *   Infected=感染者、Reunion=整合运动、Rhodes Island=罗德岛、
 *   Nomadic City=移动城邦、Catastrophe=天灾、Operator=干员、Terra=泰拉、
 *   集成战略=Integrated Strategies、生息演算=Reclamation Algorithm。
 * ----------------------------------------------------------------------- */
const ARKNIGHTS = {
  domainId: 'arknights',
  domainName: '明日方舟',
  domainIdInConfig: 'arknights',
  gameNameEn: 'Arknights',
  file: 'arknights.json',
  materialsVersion: 1,
  batch: 1,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '译名以鹰角网络官方中文为准（官网 ak.hypergryph.com、游戏内中文界面），辅以游星国际服官网 arknights.yo-star.com 的中英对照核验。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有游戏相关图片版权归 Hypergryph（鹰角网络）/ Studio Montagne 及原作者所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    catastrophe: M('核心词 · 来自希腊语 katastrophe（倾覆）',
      'n. 大灾难，灾祸；（戏剧）结局',
      '天灾。泰拉世界周期性的自然灾害，会留下源石晶簇，是移动城邦存在的根本原因。',
      '天灾过后留下的不是废墟，是源石。',
      'Every Catastrophe leaves Originium behind, which is why the Nomadic Cities must keep moving.',
      '每一场天灾都会留下源石，这正是移动城邦必须不停迁徙的原因。',
      SRC.ak),

    infect: M('派生词 · 来自拉丁语 inficere（沾染）',
      'v. 感染，传染；影响（情绪）',
      '感染。被源石感染的人称为「感染者」（Infected），理论致死率 100%，且死后仍具传染性。',
      '在泰拉，被源石碰到的那一刻，人生就被改写。',
      'Once Originium infects a person, every nation on Terra treats them as a threat.',
      '一旦被源石感染，泰拉的每个国家都会把这个人当成威胁。',
      SRC.ak),

    contagion: M('派生词 · 来自拉丁语 contingere（接触）',
      'n. 传染，接触传染；蔓延（不良风气）',
      '传染。矿石病（Oripathy）在感染者死亡后仍会扩散，因此各国普遍采取驱逐与隔离措施。',
      '最可怕的不是病死，是死后还在传染。',
      'Because contagion continues after death, the Infected are expelled rather than treated.',
      '正因为死后仍会传染，感染者遭到的是驱逐而不是治疗。',
      SRC.ak),

    quarantine: M('核心词 · 来自意大利语 quaranta（四十天）',
      'n./v. 隔离（检疫），封锁',
      '隔离。各国对感染者的标准处置方式——把人挡在城墙外，而不是治好人。',
      '把你关在外面，是这座城市最熟练的动作。',
      'Rhodes Island argues that quarantine alone will never end Oripathy.',
      '罗德岛主张，仅靠隔离永远无法终结矿石病。',
      SRC.ak),

    epidemic: M('派生词 · 来自希腊语 epi（在……之上）+ demos（民众）',
      'n. 流行病，传染病；adj. 流行的',
      '流行病。矿石病在部分地区已经演变为流行病级别的事件，成为各国政治博弈的筹码。',
      '数字上升的时候，没人关心它叫什么名字。',
      'When Oripathy reaches epidemic scale, the Infected stop being patients and become statistics.',
      '当矿石病达到流行病规模，感染者就不再是病人，而是统计数字。',
      SRC.ak),

    refugee: M('派生词 · 来自拉丁语 refugium（避难所）',
      'n. 难民，避难者',
      '难民。失去国籍与居留权的感染者，构成了泰拉最庞大的流民群体。',
      '他们不是没有国家，是没有任何一个国家愿意要。',
      'Left stateless, the infected refugees have no clear path to life.',
      '失去国籍的感染者难民，没有一条清晰可走的生路。',
      SRC.ak),

    exile: M('核心词 · 来自拉丁语 exilium（放逐）',
      'v./n. 流放，放逐；长期离开（祖国）',
      '流放。多数国家选择把感染者驱逐出境，这是「感染者问题」最常见的官方答案。',
      '一张驱逐令，比一场手术便宜得多。',
      'Most countries chose to exile the Infected rather than pay for a cure.',
      '大多数国家选择把感染者流放，而不是花钱去治。',
      SRC.ak),

    nomadic: M('派生词 · 来自希腊语 nemein（放牧）',
      'adj. 游牧的，迁徙的；流浪的',
      '移动城邦（Nomadic City）。建在可移动结构上的巨型城市，靠不停迁徙躲避天灾。',
      '一座会走路的城市，才有资格谈论生存。',
      'Nomadic cities keep moving because the Catastrophes follow no schedule.',
      '移动城邦必须不停迁徙，因为天灾从不遵守任何时刻表。',
      SRC.ak),

    deploy: M('派生词 · 来自拉丁语 displicare（展开）',
      'v. 部署，调配；有效利用',
      '部署。塔防战斗里把干员放到地图格上的动作，也是整个战斗系统的核心动词。',
      '同一队干员，部署位置的先后顺序只差一步，整场作战的结局就会完全不同。',
      'Deploying the wrong Operator on the wrong tile costs you the whole operation.',
      '把干员部署在错误的位置，会让你输掉整场行动。',
      SRC.ak),

    operator: M('派生词 · 来自拉丁语 operari（工作）',
      'n. 操作员，经营者；运算符；干员',
      '干员。罗德岛的作战人员统称，玩家可招募、培养并编入队伍。',
      '罗德岛收人只看能力，不问你是不是感染者。',
      'Rhodes Island is known for hiring Operators who are Infected themselves.',
      '罗德岛以雇佣感染者干员而闻名。',
      SRC.ak),

    recruit: M('核心词 · 来自拉丁语 recrescere（重新生长）',
      'v. 招募，征募；n. 新兵，新成员',
      '招募。罗德岛公开招募人才的机制，无论出身与感染状态。',
      '履历上写着职业，体检单上写着感染状态。',
      'Rhodes Island widely recruits talented people regardless of their infection status.',
      '罗德岛广泛招募人才，不问其感染状态。',
      SRC.ak),

    reinforcement: M('派生词 · 来自拉丁语 re（再）+ fortis（强壮）',
      'n. 增援，强化；加固（物）',
      '增援。高危作战中后置登场的干员与支援力量，是拉平战力的关键手段。',
      '主防线快塌的时候，后手干员才是胜负手。',
      'Reinforcements dropped on the same tile often decide whether Rhodes Island holds the line.',
      '在同一格上投入的增援，往往决定罗德岛能否守住防线。',
      SRC.ak),

    tactic: M('核心词 · 来自希腊语 taktike（排列的艺术）',
      'n. 战术，策略；手法',
      '战术。明日方舟本质是战术推演玩法，干员部署顺序与站位构成了全部胜负空间。',
      '同样的干员，换个摆法就是两支队伍。',
      'Good tactics matter more than raw stats when the Operators are outnumbered.',
      '当干员人数处于劣势时，好的战术比数值更重要。',
      SRC.ak),

    formation: M('核心词 · 来自拉丁语 formare（塑造）',
      'n. 阵型，编队；形成，组成',
      '阵型。干员在地图上的站位组合，决定伤害覆盖、阻挡数与治疗线路。',
      '阵型不是摆好看，是把伤害和奶量对齐。',
      'A tight formation lets a single medic cover three Operators at once.',
      '紧凑的阵型能让一名医疗干员同时覆盖三名干员。',
      SRC.ak),

    morale: M('核心词 · 来自拉丁语 moralis（道德的）',
      'n. 士气，斗志；道德准则',
      '士气。行动失败或城市沦陷后，罗德岛与各国必须面对的人心问题。',
      '打完仗要重建的，从来不只是城墙。',
      'After Chernobog fell, rebuilding morale took longer than rebuilding the city.',
      '切尔诺伯格沦陷后，重建士气比重建城市花了更久。',
      SRC.ak),

    suppress: M('核心词 · 来自拉丁语 supprimere（压下去）',
      'v. 压制，镇压；抑制（情感、反应）',
      '压制。战斗中用高阻挡与高输出干员压住敌人推进节奏的标准打法。',
      '压住第一波，后面的输出才有时间。',
      'Suppressing the first wave gives your slower Operators time to deploy.',
      '压制住第一波，你更慢的干员才有时间部署。',
      SRC.ak),

    salvage: M('核心词 · 来自拉丁语 salvare（拯救）',
      'v./n. 打捞，抢救；废物利用',
      '营救／打捞。罗德岛的核心行动之一：进入高危区域抢救受天灾与源石影响的人。',
      '他们冲进灾区不是去抢资源，是去抢人。',
      'Rhodes Island goes deep into hazardous areas to salvage afflicted people, not Originium.',
      '罗德岛深入高危区域救的是受灾的人，不是源石。',
      SRC.ak),

    sanctuary: M('核心词 · 来自拉丁语 sanctus（神圣的）',
      'n. 避难所，庇护；圣所',
      '庇护所。罗德岛对感染者而言的实际定位——既是医疗机构，也是栖身之所。',
      '一艘能收人的船，就是一座会走的庇护所。',
      'For many Infected, Rhodes Island is the first sanctuary that ever opened its door.',
      '对许多感染者来说，罗德岛是第一个对他们开门的庇护所。',
      SRC.ak),

    pharmaceutical: M('派生词 · 来自希腊语 pharmakon（药物）',
      'adj. 制药的，药学的；n. 药品',
      '制药的。罗德岛对外注册身份是一家制药公司，研究面向感染者的医疗方案。',
      '一家制药公司，打着打着就成了军队。',
      'Rhodes Island Pharmaceutical Inc. researches medical solutions for the Infected.',
      '罗德岛制药公司研究的是面向感染者的医疗方案。',
      SRC.ak),

    immunity: M('派生词 · 来自拉丁语 immunis（免除义务的）',
      'n. 免疫力，免疫；豁免（权）',
      '免疫。矿石病理论上致死率 100%，截至目前尚无有效免疫手段。',
      '在泰拉，「免疫」还只是一个论文标题。',
      'No immunity to Oripathy has ever been confirmed, which is why the Infected are feared.',
      '至今没有任何针对矿石病的免疫手段得到证实，这正是感染者被恐惧的原因。',
      SRC.ak),

    chronic: M('核心词 · 来自希腊语 chronos（时间）',
      'adj. 慢性的，长期的；积习难改的',
      '慢性的。矿石病是典型的慢性病程，患者需要在漫长岁月里与症状共存。',
      '它不急着杀你，它先陪你很多年。',
      'Oripathy is a chronic condition that slowly turns the patient\'s own body into the next source of infection.',
      '矿石病是一种慢性病，它会慢慢把患者自己的身体变成下一个传染源。',
      SRC.ak),

    ore: M('核心词 · 古英语 ora（未锻造的金属）',
      'n. 矿石，矿砂',
      '源石。泰拉世界最常见的矿物：黑色、半透明晶体，蕴含庞大能量，也是天灾的直接成因。',
      '能点亮城市的石头，也能让整座城市消失。',
      'Originium ore powers the cities of Terra while simultaneously causing the Catastrophes.',
      '源石矿石为泰拉的城市供能，同时也制造着天灾。',
      SRC.ak),

    extinction: M('派生词 · 来自拉丁语 exstinguere（熄灭）',
      'n. 灭绝，消亡；熄灭',
      '灭绝。天灾与源石扩散若持续失控，泰拉文明面临的最终风险。',
      '没有人打算灭绝谁，只是谁都没停下来。',
      'If the Catastrophes keep spreading, extinction is a question of when, not if.',
      '如果天灾持续蔓延，灭绝只是时间问题，而不是会不会发生的问题。',
      SRC.ak),

    vigil: M('核心词 · 来自拉丁语 vigilare（保持清醒）',
      'n. 守夜，值夜；静默守望',
      '守夜。罗德岛长期面对源石与感染者议题的隐喻式表达：没有终点，只能持续守望。',
      '没有人赢下这场仗，所有人只是留下来值夜。',
      'Rhodes Island keeps its vigil over Terra, one operation at a time.',
      '罗德岛在一次又一次的行动中，为泰拉持续守夜。',
      SRC.ak),
  },
};

/* --------------------------------------------------------------------------
 * 原神 · Genshin Impact
 * 译名核验来源：米哈游官方中文（游戏内界面 / 官网 ys.mihoyo.com）：
 *   提瓦特 / 蒙德 / 璃月 / 稻妻 / 须弥 / 枫丹 / 神之眼 / 命之座 / 圣遗物 /
 *   原石 / 摩拉 / 冒险家协会 / 愚人众 / 深渊 / 深境螺旋 / 尘歌壶 / 七天神像 /
 *   传送锚点 / 秘境 / 元素反应 / 原粹树脂 / 纪行 / 祈愿。
 * ----------------------------------------------------------------------- */
const GENSHIN_IMPACT = {
  domainId: 'genshinImpact',
  domainName: '原神',
  domainIdInConfig: 'genshin_impact',
  gameNameEn: 'Genshin Impact',
  file: 'genshinImpact.json',
  materialsVersion: 1,
  batch: 1,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '译名以米哈游官方中文为准（游戏内中文界面、官网 ys.mihoyo.com），辅以官方社区与 Fandom Wiki 中文站核验。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有游戏相关图片版权归 miHoYo / HoYoverse 及原作者所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    artifact: M('核心词 · 来自拉丁语 arte（技艺）+ facere（制作）',
      'n. 人工制品，手工艺品；（考古）器物',
      '圣遗物。提供属性与套装效果的装备体系，是角色养成的主战场。',
      '一套圣遗物的副词条，能决定一个角色的上限。',
      'A single artifact with the wrong substat can ruin a week of farming in Teyvat.',
      '一件副词条不对的圣遗物，就能毁掉你在提瓦特一周的刷取。',
      SRC.gi),

    constellation: M('核心词 · 来自拉丁语 com（一起）+ stella（星星）',
      'n. 星座，星群；一群杰出人物',
      '命之座。角色的六层命座系统，抽到重复角色会转化为命座激活材料。',
      '命座点亮之后，同一个角色的两套打法就分家了。',
      'Activating a constellation changes how the whole team plays around that character.',
      '点亮命之座之后，整个队伍的配合方式都会随之改变。',
      SRC.gi),

    abyss: M('核心词 · 来自希腊语 abyssos（无底）',
      'n. 深渊，无底洞；adj. 深不可测的',
      '深渊。既是坎瑞亚覆灭后的异变力量，也是《原神》里最具压迫感的敌对阵营。',
      '深渊不与提瓦特为敌，它只是从来不属于提瓦特。',
      'The Abyss is not simply an enemy of Teyvat — it was never part of Teyvat at all.',
      '深渊并非单纯的提瓦特之敌——它从来就不属于提瓦特。',
      SRC.gi),

    guild: M('核心词 · 来自古北欧语 gildi（团体）',
      'n. 行会，协会；公会',
      '冒险家协会（Adventurers\' Guild）。发放委托、结算冒险等阶的官方组织，每个国家都有分支。',
      '在提瓦特，自称冒险家之前先去协会登记。',
      'Every region of Teyvat has its own branch of the Adventurers\' Guild.',
      '提瓦特的每个地区都设有冒险家协会的分支。',
      SRC.gi),

    expedition: M('派生词 · 来自拉丁语 expedire（解脱束缚）',
      'n. 远征，探险（队）；考察',
      '派遣探索。把角色派出去换原石与素材的日常玩法，也是世界观里最常见的行动形式。',
      '角色派出去八小时，你换来一场空——或者一块原石。',
      'Sending characters on an expedition costs nothing but time, and it pays in Primogems.',
      '派遣角色探索除了时间什么都不用花，回报却是原石。',
      SRC.gi),

    blessing: M('核心词 · 来自古英语 bledsian（祝圣）',
      'n. 祝福，赐福；幸事；（饭前）祷告',
      '祝福。游戏中常见的增益形式：料理、元素共鸣与神像赐福都属于此类。',
      '七天神像旁边站一会儿，血条和心情都会好起来。',
      'Praying at a Statue of The Seven gives the whole party a blessing before a long climb.',
      '长途攀爬之前，在七天神像前祈祷能为整个队伍带来祝福。',
      SRC.gi),

    resonance: M('核心词 · 来自拉丁语 resonare（回响）',
      'n. 共鸣，共振；反响',
      '元素共鸣。队伍中元素搭配产生的额外增益；同样也是「神之眼」与世界规则互动的核心概念。',
      '两个同元素角色站在一起，队伍就已经开始给加成了。',
      'Elemental resonance rewards a team built around two characters of the same element.',
      '元素共鸣会奖励那些围绕两名同元素角色组建的队伍。',
      SRC.gi),

    catalyst: M('核心词 · 来自希腊语 katalysis（分解）',
      'n. 催化剂；触发因素',
      '法器。一种武器类型：施法者持有的悬浮武器，靠元素力进行远程攻击。',
      '法器角色不打人，他们打的是元素。',
      'A catalyst user channels elemental energy through a floating weapon instead of a blade.',
      '使用法器的角色通过悬浮武器引导元素力，而不是靠刀剑。',
      SRC.gi),

    prototype: M('派生词 · 来自希腊语 protos（第一）+ typos（模型）',
      'n. 原型，样机；典型',
      '原型／试作。锻造武器体系里的前缀命名，代表可自行打造的基础型号。',
      '拿到图纸只是开始，真正花时间的是找材料。',
      'Crafting a prototype weapon is easy; finding the ore for it is the real task.',
      '锻造一把试作武器很容易，真正麻烦的是找齐矿石。',
      SRC.gi),

    domain: M('核心词 · 来自拉丁语 dominus（主人）',
      'n. 领域，范围；领地；（网络）域名',
      '秘境。以树脂为门票的副本，产出圣遗物、天赋书与武器突破材料。',
      '一天的体力，够刷几次秘境？答案永远是「不够」。',
      'Every domain in Teyvat costs Original Resin, and there is never enough of it.',
      '提瓦特的每一个秘境都要消耗原粹树脂，而它永远不够用。',
      SRC.gi),

    elemental: M('派生词 · 来自拉丁语 elementum（基本组成）',
      'adj. 基本的，元素的；自然力的',
      '元素的。七大元素构成战斗底层规则，也决定角色能不能吃满队伍加成。',
      '不懂元素反应，配队就只是把强的凑一起。',
      'Elemental reactions decide whether a team comp actually deals damage.',
      '元素反应决定了一套配队到底打不打得出伤害。',
      SRC.gi),

    ascend: M('核心词 · 来自拉丁语 ascendere（上升）',
      'v. 上升，登高；晋升',
      '突破。角色与武器的等级上限解锁流程，需要消耗对应的世界首领与秘境材料。',
      '突破材料刷够之前，等级就卡在那里不动。',
      'Ascending a character past level 80 requires materials from a world boss.',
      '把角色突破到 80 级以上，需要击败世界首领获取材料。',
      SRC.gi),

    refine: M('核心词 · 来自 re（再）+ 拉丁语 finis（精细）',
      'v. 提炼，精炼；使精细，改进',
      '精炼。武器精炼等级系统，需要重复抽取同一把武器来提升。',
      '一把五星武器抽满精炼，比抽角色还贵。',
      'Players refine a five-star weapon to its highest rank, often spending more than getting the character.',
      '把一把五星武器精炼到最高等级，花费常常超过抽到那个角色。',
      SRC.gi),

    stamina: M('核心词 · 来自拉丁语 stamina（经线、耐久）',
      'n. 持久力，耐力，体力',
      '体力。攀爬与冲刺消耗的耐力条，也是探索时最容易被忽视的限制。',
      '掉下悬崖的原因，十次有八次是体力条空了。',
      'Run out of stamina halfway up a cliff in Liyue and you will be climbing it twice.',
      '在璃月的悬崖爬到一半体力见底，你就得爬第二次。',
      SRC.gi),

    wanderer: M('核心词 · 来自古英语 wandrian（漫游）',
      'n. 漫游者，流浪者',
      '旅行者／漫游者。跨越世界寻找血亲的主角形象，也是全地图自由探索的叙事理由。',
      '在提瓦特，没有人问你从哪儿来，只问你接下来去哪儿。',
      'As a wanderer, the Traveler can walk into any nation of Teyvat and just start helping.',
      '身为漫游者，旅行者可以走进提瓦特的任何国度，然后直接开始帮忙。',
      SRC.gi),

    ruin: M('核心词 · 来自拉丁语 ruere（崩塌）',
      'n. 废墟，遗迹；毁灭；v. 毁坏',
      '遗迹。坎瑞亚覆灭后留下的机械造物与建筑残骸；遗迹守卫一类敌人由此得名。',
      '那些机械不想杀你，它们只是还在执行几百年前的命令。',
      'The Ruin Guards still patrol ancient ruins, obeying orders from a nation that no longer exists.',
      '遗迹守卫仍在那片古老废墟中巡逻，执行着一个早已不存在的国度的命令。',
      SRC.gi),

    teleport: M('派生词 · 来自希腊语 tele（远）+ 拉丁语 portare（携带）',
      'v. 传送，瞬间移动；n. 瞬移',
      '传送。通过传送锚点与七天神像实现的地图瞬移，是探索效率的基础设施。',
      '第一次解锁锚点的那一下，比抽到角色还有成就感。',
      'Unlocking a teleport waypoint turns an hour of walking into a single click.',
      '解锁一个传送锚点，能把一小时的步行缩短成一次点击。',
      SRC.gi),

    realm: M('核心词 · 来自拉丁语 regalis（王者的）',
      'n. 王国，领域；界，范围',
      '领域／界。游戏中常用来描述非现实空间，例如「尘歌壶」内开辟的一方天地。',
      '在尘歌壶里，你想建几层楼都没人管。',
      'Inside the Serenitea Pot, the Traveler rules over a small realm of their own.',
      '在尘歌壶里，旅行者统治着一方属于自己的小小领域。',
      SRC.gi),

    lore: M('核心词 · 来自古英语 lar（教导）',
      'n. 传说，口传知识；（某一领域的）全部知识',
      '传说／设定。散落在书籍、石碑与任务对白中的世界观文本，是原神叙事的主要载体。',
      '提瓦特的真相不在主线里，在那些没人读的书里。',
      'Most of Teyvat\'s lore is buried in books that no quest forces you to read.',
      '提瓦特的绝大部分设定，都埋在那几本没有任何任务逼你去读的书里。',
      SRC.gi),

    herald: M('核心词 · 来自古法语 heraut（传令官）',
      'n. 先驱，预兆；使者；v. 预示',
      '使者／征兆。常用于描述势力登场或重大变故的前兆性角色与事件。',
      '深境螺旋里的敌人，就是下一版本剧情的预告片。',
      'Every new herald in the Spiral Abyss quietly warns you what the next patch will bring.',
      '深渊螺旋里每出现一个新使者，都在悄悄预告下个版本会带来什么。',
      SRC.gi),

    tribute: M('核心词 · 来自拉丁语 tributum（纳贡）',
      'n. 贡品，贡赋；敬意，悼念',
      '供奉。向神像或祭坛献上的物品与敬意，是各国宗教与政治结构的缩影。',
      '璃月的香火，一半是敬神，一半是敬生意。',
      'Liyue\'s tribute to its Archon is paid in incense and in commerce alike.',
      '璃月向岩王帝君献上的供奉，一半是香火，一半是生意。',
      SRC.gi),

    pilgrimage: M('核心词 · 来自拉丁语 peregrinus（外乡人）',
      'n. 朝圣，朝觐；长途跋涉',
      '巡礼。围绕神像、圣所与七国展开的旅行叙事；也是诸多世界任务的母题。',
      '主线是任务，支线才是提瓦特真正的巡礼。',
      'The Traveler\'s journey across Teyvat is closer to a pilgrimage than to a conquest.',
      '旅行者跨越提瓦特的旅程，与其说是征服，不如说是一场巡礼。',
      SRC.gi),

    bestow: M('核心词 · 来自古英语 bestowen（安置）',
      'v. 授予，赠予；给予（荣誉、恩惠）',
      '赐予。神之眼与神明的恩赐，在设定中并非奖励，而是一种被选中的标记。',
      '神之眼由神明赐予，但对许多持有者来说，被神明看见的那一刻并不值得庆幸。',
      'A Vision is bestowed by the gods, but it is not always a gift the bearer wanted.',
      '神之眼由神明赐予，但它并不总是持有者想要的那件礼物。',
      SRC.gi),

    fortune: M('核心词 · 来自拉丁语 fortuna（命运、运气）',
      'n. 财富；运气，命运',
      '财富／命运。摩拉作为流通货币的双关：在提瓦特，钱与命常常由同一个词承担。',
      '摩拉不够的时候，你会开始相信运气。',
      'Mora measures a traveler\'s fortune in Teyvat, and it runs out faster than luck.',
      '在提瓦特，摩拉衡量着旅行者的财富，而它比运气花得更快。',
      SRC.gi),
  },
};

/* ==========================================================================
 * 第二批（影视）
 * ======================================================================= */

/* --------------------------------------------------------------------------
 * 绝命毒师 · Breaking Bad
 * 译名核验来源：AMC 官方中文物料与索尼影视中文发行版的通行译名：
 *   沃尔特·怀特(Walter White)、杰西·平克曼(Jesse Pinkman)、
 *   斯凯勒·怀特(Skyler White)、汉克·施拉德(Hank Schrader)、
 *   古斯塔沃·弗林(Gustavo Fring)、萨尔·古德曼(Saul Goodman)、
 *   迈克·厄门绍特(Mike Ehrmantraut)、海森堡(Heisenberg)、
 *   兄弟炸鸡店/炸鸡兄弟(Los Pollos Hermanos)、蓝天(Blue Sky)、
 *   缉毒局(DEA)、阿尔伯克基(Albuquerque)。
 * ----------------------------------------------------------------------- */
const BREAKING_BAD = {
  domainId: 'breakingBad',
  domainName: '绝命毒师',
  domainIdInConfig: 'breaking_bad',
  gameNameEn: 'Breaking Bad',
  file: 'breakingBad.json',
  materialsVersion: 1,
  batch: 2,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '译名以 AMC 官方中文物料与索尼影视中文发行版为准，人名一律采用「名·姓」官方译法。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有剧集相关图片版权归 AMC / Sony Pictures Television 及原作者所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    chemistry: M('核心词 · 来自希腊语 khemeia（炼金术）',
      'n. 化学；化学成分；（人际）化学反应',
      '化学。沃尔特·怀特（Walter White）的立身之本：他制出 99.1% 纯度的冰毒，靠的正是高中课堂上没人愿意听的那门学科。',
      '他教了一辈子化学，最后靠化学活成了另一个人。',
      'Walter White used his chemistry knowledge to cook meth of unmatched purity.',
      '沃尔特·怀特用他的化学知识制出了纯度无人能及的冰毒。',
      SRC.bb),

    purity: M('派生词 · 来自拉丁语 purus（纯净的）',
      'n. 纯度；纯净，纯洁',
      '纯度。蓝色冰毒「蓝天」（Blue Sky）的卖点就是它的纯度——纯度即价格，也即权力。',
      '在阿尔伯克基，纯度就是硬通货。',
      'Blue Sky was famous for its purity, which made Heisenberg impossible to replace.',
      '「蓝天」以纯度闻名，这让海森堡成了无法被替代的人。',
      SRC.bb),

    formula: M('核心词 · 来自拉丁语 formula（小形状、固定格式）',
      'n. 配方，公式；方案',
      '配方。怀特掌握的制毒配方是他全部谈判筹码的来源，也是他必须拼命守住的东西。',
      '一个配方，把化学老师变成了卖方市场。',
      'The formula was the only thing keeping Jesse Pinkman and Walter White alive.',
      '这个配方是唯一让杰西·平克曼和沃尔特·怀特活下去的东西。',
      SRC.bb),

    laboratory: M('派生词 · 来自拉丁语 laborare（劳作）',
      'n. 实验室，研究室',
      '实验室。古斯塔沃·弗林（Gustavo Fring）在兄弟炸鸡店（Los Pollos Hermanos）的炸鸡车间下面，藏着一间工业级制毒实验室。',
      '炸鸡的香味，盖得住地下实验室的味道。',
      'Under Los Pollos Hermanos, Gus Fring built a laboratory no health inspector would ever find.',
      '在兄弟炸鸡店底下，古斯塔沃·弗林建了一间卫生检查员永远找不到的实验室。',
      SRC.bb),

    diagnose: M('派生词 · 来自希腊语 dia（穿过）+ gignoskein（认识）',
      'v. 诊断（疾病）；判断（问题的性质）',
      '诊断。故事的第一推动力：怀特被诊断出肺癌晚期，才有了后面的一切。',
      '一份诊断书，是这部剧真正的第一集。',
      'The moment doctors diagnose Walter White with lung cancer, Breaking Bad truly begins.',
      '医生为沃尔特·怀特诊断出肺癌的那一刻，《绝命毒师》才真正开始。',
      SRC.bb),

    terminal: M('核心词 · 来自拉丁语 terminalis（边界的）',
      'adj. 晚期的，末期的；终端的 n. 终点站',
      '晚期的。怀特确诊的是 terminal cancer（晚期癌症），他做的一切都建立在「我快死了」这个前提上。',
      '他把死亡通知单，当成了开工许可证。',
      'Walter White believed he had terminal cancer, so he stopped being afraid of consequences.',
      '沃尔特·怀特以为自己得的是晚期癌症，于是他不再害怕后果。',
      SRC.bb),

    empire: M('核心词 · 来自拉丁语 imperium（统治权）',
      'n. 帝国；大企业集团',
      '帝国。怀特的自我叙事——他不再满足于制毒，他想建立属于自己的毒品帝国。',
      '他要的不是钱，是一个写着他的名字的帝国。',
      'Heisenberg did not want money; he wanted an empire that said his name.',
      '海森堡要的不是钱，而是一个说得出他名字的帝国。',
      SRC.bb),

    dealer: M('核心词 · 来自古英语 dælan（分配）',
      'n. 毒贩，经销商；发牌人',
      '毒贩。杰西·平克曼（Jesse Pinkman）原本就是街头小毒贩，也是怀特最初找上门的原因。',
      '他认识街上每一个买家，可惜不认识化学。',
      'Jesse Pinkman was a small-time dealer before Walter White made him a partner.',
      '在沃尔特·怀特让他成为合伙人之前，杰西·平克曼只是个小毒贩。',
      SRC.bb),

    alias: M('核心词 · 来自拉丁语 alius（别的）',
      'n. 化名，别名 v. 化名为',
      '化名。怀特的化名「海森堡」（Heisenberg）取自量子力学奠基人，是他另一个人格的通行证。',
      '戴上这个名字，他就不再是那个窝囊的老师。',
      'Under the alias Heisenberg, Walter White became someone his own family could not recognise.',
      '在「海森堡」这个化名之下，沃尔特·怀特变成了连家人都认不出的另一个人。',
      SRC.bb),

    fortune: M('核心词 · 来自拉丁语 fortuna（命运、运气）',
      'n. 财富；运气，命运',
      '财富。怀特最初的动机是给家人留下一笔钱——一笔足以改变命运的财富，最后却远超预期。',
      '他算过家里需要多少钱，没算过自己会变成谁。',
      'Walter White told himself he was building a fortune for Skyler and the children.',
      '沃尔特·怀特告诉自己，他是在为斯凯勒和孩子们挣一笔财富。',
      SRC.bb),

    profit: M('核心词 · 来自拉丁语 proficere（前进、获益）',
      'n. 利润，收益 v. 获利',
      '利润。怀特的商业天赋在制毒业同样奏效：他不断压缩成本、抬高单价，把利润做到了街头无法企及的高度。',
      '他把化学课上的成本核算，用在了最贵的地方。',
      'Heisenberg doubled the profit simply by never letting his product drop below a certain purity.',
      '海森堡只是坚持不让产品纯度下降，就把利润翻了一倍。',
      SRC.bb),

    launder: M('核心词 · 来自拉丁语 lavare（洗）',
      'v. 洗钱；洗涤（衣物）',
      '洗钱。怀特夫妇买下洗车店（A1A Car Wash），用现金流水把毒资洗成合法收入。',
      '一家洗车店，洗的从来不只是车。',
      'The car wash let Skyler launder drug money as if it were ordinary business income.',
      '那家洗车店让斯凯勒把毒资洗得和普通营业收入一模一样。',
      SRC.bb),

    disguise: M('派生词 · 来自古法语 desguiser（改变外表）',
      'n./v. 伪装，掩饰',
      '伪装。怀特戴着那顶标志性的黑色礼帽（Heisenberg hat）出现时，就是他卸下伪装的时刻。',
      '摘掉眼镜、戴上帽子，他换的不是衣服。',
      'That porkpie hat was not a disguise; it was the man Walter White refused to be.',
      '那顶礼帽不是伪装，而是沃尔特·怀特拒绝成为的那个人。',
      SRC.bb),

    betray: M('核心词 · 来自拉丁语 tradere（交出、出卖）',
      'v. 背叛，出卖；泄露',
      '背叛。剧集的核心主题之一——怀特一次次背叛杰西，又一次次以「我为你好」自我辩解。',
      '他背叛了所有人，还包括他自己。',
      'Heisenberg betrays Jesse again and again, always with the same excuse: I did it for us.',
      '海森堡一次又一次背叛杰西，借口永远是同一句：我是为了我们。',
      SRC.bb),

    conspire: M('派生词 · 来自拉丁语 conspirare（同呼吸）',
      'v. 密谋，共谋；（情况）凑合在一起',
      '密谋。怀特与古斯塔沃·弗林表面合作、暗中互相试探，是全剧最紧张的一段博弈。',
      '两个都想收网的人，先做了一段生意伙伴。',
      'Gus Fring and Heisenberg conspire to build a lab, each planning to survive the other.',
      '古斯塔沃·弗林和海森堡密谋共建实验室，却各自盘算着如何活过对方。',
      SRC.bb),

    hazard: M('核心词 · 来自古法语 hasard（掷骰子）',
      'n. 危险，危害；隐患',
      '危险。制毒现场处处是化学危害（hazard），氢氟酸、甲胺的每一次泄漏都可能致命。',
      '那些桶上每一个标签，都是别人用命换来的。',
      'In a meth laboratory, every unlabeled drum of chemicals is a serious hazard.',
      '在制毒实验室里，每一桶没有标签的化学品都是严重的危险。',
      SRC.bb),

    contaminate: M('派生词 · 来自拉丁语 contaminare（弄脏）',
      'v. 污染，弄脏；使受不良影响',
      '污染。制毒过程一旦被污染（contaminate），整批产品报废——这也是怀特对流程近乎偏执的原因。',
      '一点杂质，整批报废，他不能接受。',
      'One careless move can contaminate an entire batch, and Walter White tolerated no carelessness.',
      '一个疏忽就会污染整批产品，而沃尔特·怀特不容忍任何疏忽。',
      SRC.bb),

    substance: M('核心词 · 来自拉丁语 substantia（本质）',
      'n. 物质；实质，主旨',
      '物质。剧中的化学语境里，substance 既指实际物质，也指怀特灵魂里那点无法回避的东西。',
      '他不怕有毒的东西，怕的是没有分量的自己。',
      'To Heisenberg, a substance was never just a substance; it was proof of who he was.',
      '对海森堡而言，一种物质从来不只是物质，而是他身份的证明。',
      SRC.bb),

    experiment: M('派生词 · 来自拉丁语 experiri（尝试）',
      'n./v. 实验，试验；尝试',
      '实验。怀特在房车里第一次制毒，就是一场把整个人生押上去的实验。',
      '第一次点火那晚，他赌上了全部人生。',
      'The first cook in that RV was an experiment Walter White could never take back.',
      '房车里的第一次制毒，是沃尔特·怀特永远无法收回的一场实验。',
      SRC.bb),

    conceal: M('核心词 · 来自拉丁语 celare（隐藏）',
      'v. 隐藏，隐瞒',
      '隐瞒。怀特对斯凯勒撒了一整季的谎，把所有证据都藏在一句「我没事」后面。',
      '他藏得最好的东西，从来不是钱。',
      'For months Walter White concealed his double life behind excuses Skyler stopped believing.',
      '好几个月里，沃尔特·怀特用一个斯凯勒早已不信的借口，隐瞒着自己的双重人生。',
      SRC.bb),

    witness: M('核心词 · 来自古英语 witnes（知情者）',
      'n. 目击者，证人 v. 目击，见证',
      '证人。汉克·施拉德（Hank Schrader）是缉毒局探员，他离真相最近，却最晚承认自己看到的一切。',
      '他是最好的探员，也只是最后一个愿意相信的人。',
      'Hank Schrader was the DEA agent best placed to witness what Heisenberg really was.',
      '汉克·施拉德是最有条件亲眼见证海森堡真面目的缉毒局探员。',
      SRC.bb),

    interrogate: M('派生词 · 来自拉丁语 interrogare（发问）',
      'v. 审问，审讯；盘问',
      '审讯。汉克在审讯室里与嫌疑人对峙的段落，是全剧最纯粹的「智力较量」场面。',
      '审讯室里的胜负，从来不取决于谁声音大。',
      'Hank Schrader knew how to interrogate a suspect: let him talk first, then catch the lie.',
      '汉克·施拉德懂得如何审讯嫌疑人：先让他开口，再抓住其中的谎言。',
      SRC.bb),

    residue: M('核心词 · 来自拉丁语 residuum（剩余物）',
      'n. 残留物，残渣；剩余',
      '残留物。汉克正是在怀特家后院发现防毒面具与化学残留（residue），才拼出了「W.W.」这个名字。',
      '防毒面具上一片没擦干净的残留物，最终撬开了汉克面前那座庞大的谎言。',
      'A little residue on a gas mask is what finally pointed Hank Schrader at W.W.',
      '防毒面具上的一点残留物，最终把汉克·施拉德指向了「W.W.」。',
      SRC.bb),

    vengeance: M('核心词 · 来自拉丁语 vindicare（主张、报复）',
      'n. 复仇，报复',
      '复仇。剧集后半段的驱动力从「为家人赚钱」彻底滑向复仇与自我证明。',
      '最开始他说为了家，最后他承认是为了自己。',
      'What began as providing for his family became plain vengeance in Heisenberg\'s hands.',
      '一开始是为家人谋生，到海森堡手里就变成了纯粹的复仇。',
      SRC.bb),

    motive: M('核心词 · 来自拉丁语 movere（推动）',
      'n. 动机，目的',
      '动机。汉克办案最看重动机，而怀特最擅长的，就是让所有动机都指向别人。',
      '他给每个人准备了一个动机，除了他自己。',
      'Hank Schrader always asked for a motive, and Walter White always had one ready for someone else.',
      '汉克·施拉德总要问动机，而沃尔特·怀特永远能替别人准备好一个。',
      SRC.bb),

    volatile: M('派生词 · 来自拉丁语 volare（飞）',
      'adj. 易挥发的；不稳定的，易变的',
      '易挥发的。制毒所用溶剂多为挥发性化学品（volatile），操作不当就会爆炸或中毒。',
      '那些液体随时会挥发，也随时会翻脸。',
      'Volatile solvents made every cook a gamble, even for a chemist as careful as Walter White.',
      '易挥发的溶剂让每一次制毒都成了赌博，即便对沃尔特·怀特这样谨慎的化学家也一样。',
      SRC.bb),

    toxic: M('派生词 · 来自希腊语 toxikon（箭毒）',
      'adj. 有毒的；n. 有毒物质',
      '有毒的。怀特用蓖麻毒素（ricin）做过不止一次致命的安排，化学知识既是手艺也是凶器。',
      '他的化学，从来既能救人也能杀人。',
      'Walter White kept a vial of toxic ricin hidden in his own house for an entire season.',
      '沃尔特·怀特整整一季都把自己家里的一小瓶蓖麻毒素藏着。',
      SRC.bb),

    dissolve: M('核心词 · 来自拉丁语 dissolvere（分开、解开）',
      'v. 溶解；解散；（局面）瓦解',
      '溶解。用氢氟酸「处理」尸体是剧中最出名的一段——除了塑料桶，它几乎能溶解一切。',
      '杰西用氢氟酸溶解过尸体、也溶解过证据，却唯独没算到一只浴缸。',
      'Jesse Pinkman learned that hydrofluoric acid will dissolve almost anything except a bathtub.',
      '杰西·平克曼学到一件事：氢氟酸几乎能溶解一切，唯独溶解不了浴缸。',
      SRC.bb),

    inherit: M('派生词 · 来自拉丁语 heres（继承人）',
      'v. 继承；接替',
      '继承。杰西和怀特都试图让对方「继承」自己的位置，代价是谁也逃不掉。',
      '他一直想留下点什么，却只想留给家人。',
      'Jesse Pinkman never wanted to inherit the empire Heisenberg had built.',
      '杰西·平克曼从没想过要继承海森堡建立起来的那个帝国。',
      SRC.bb),

    purify: M('派生词 · 来自拉丁语 purificare（使纯净）',
      'v. 提纯，净化；使纯净',
      '提纯。怀特的看家手艺：一层层去掉杂质，直到纯度做到 99.1% 的「蓝天」（Blue Sky）。',
      '他做的不是毒品，是把杂质一步步赶出去。',
      'Walter White could purify a batch until only the purest crystal remained.',
      '沃尔特·怀特能把一批产品提纯到只剩下最纯净的晶体。',
      SRC.bb),

    compound: M('核心词 · 来自拉丁语 componere（放在一起）',
      'n. 化合物，复合物 v. 使加重 adj. 复合的',
      '化合物。怀特对每一种化合物（compound）的性质都了如指掌，这正是他比街头毒贩高一档的原因。',
      '沃尔特能背出桶里每一种化合物的脾气，这正是他总能领先缉毒局的原因。',
      'Knowing every compound in the drum is what kept Heisenberg ahead of the DEA.',
      '熟悉桶里每一种化合物，正是海森堡领先缉毒局的原因。',
      SRC.bb),

    lethal: M('派生词 · 来自拉丁语 letalis（致命的）',
      'adj. 致命的，致死的',
      '致命的。剧中反复出现致死剂量（lethal dose）的概念，怀特从不需要靠猜。',
      '他算得比谁都准，包括该用多少。',
      'Heisenberg knew exactly what a lethal dose looked like and never had to guess.',
      '海森堡清楚致死剂量到底是多大，从不需要猜。',
      SRC.bb),

    addict: M('核心词 · 来自拉丁语 addicere（判归、沉溺）',
      'n. 吸毒成瘾者，瘾君子 v. 使上瘾，使沉溺',
      '瘾君子。杰西·平克曼身边从未缺过 addict，他的挣扎是整部剧最有人味的部分。',
      '杰西·平克曼从小被瘾君子包围，认识他们比认识自己的亲戚还要多。',
      'Jesse Pinkman grew up surrounded by addicts he could never fully leave behind.',
      '杰西·平克曼从小被瘾君子包围，始终没能真正离开他们。',
      SRC.bb),

    smuggle: M('核心词 · 来自低地德语 smokkelen（偷运）',
      'v. 走私，偷运',
      '走私。原料要偷运进来、成品要偷运出去——整条链路都绕不开新墨西哥的边境。',
      '古斯·弗林把一桶桶化学品走私过境运进新墨西哥州，自己却始终干干净净。',
      'Gus Fring smuggled barrel after barrel of chemicals across the border into New Mexico.',
      '古斯塔沃·弗林把一桶又一桶化学品走私过境，运进新墨西哥州。',
      SRC.bb),

    corrupt: M('核心词 · 来自拉丁语 corrumpere（败坏）',
      'adj. 腐败的，贪污的 v. 使腐化；损坏',
      '腐败的。剧中的执法与商业体系同样 corrupt，真正干净的几乎只有汉克·施拉德一个人。',
      '在这座城里，干净反而显得可疑。',
      'Hank Schrader was the rare agent who refused to be corrupt, and it cost him dearly.',
      '汉克·施拉德是少有拒绝腐败的探员，而为此付出了沉重代价。',
      SRC.bb),
  },
};

/* --------------------------------------------------------------------------
 * 神探夏洛克 · Sherlock
 * 译名核验来源：BBC 官方中文字幕与原著通行中文译名：
 *   夏洛克·福尔摩斯(Sherlock Holmes)、约翰·华生(John Watson)、
 *   贝克街221B(221B Baker Street)、吉姆·莫里亚蒂(Jim Moriarty)、
 *   麦考夫·福尔摩斯(Mycroft Holmes)、哈德森太太(Mrs Hudson)、
 *   雷斯垂德(Lestrade)、咨询侦探(consulting detective)、
 *   思维宫殿/记忆宫殿(mind palace)、苏格兰场(Scotland Yard)。
 * ----------------------------------------------------------------------- */
const SHERLOCK = {
  domainId: 'sherlock',
  domainName: '神探夏洛克',
  domainIdInConfig: 'sherlock',
  gameNameEn: 'Sherlock',
  file: 'sherlock.json',
  materialsVersion: 1,
  batch: 2,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '译名以 BBC 官方中文字幕为准，人名与地名沿用原著（柯南·道尔《福尔摩斯探案集》）通行中文译名。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有剧集相关图片版权归 BBC / Hartswood Films 及原作者所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    deduce: M('派生词 · 来自拉丁语 deducere（引出）',
      'v. 演绎，推断；推论出',
      '演绎。夏洛克·福尔摩斯（Sherlock Holmes）的看家本领：从一只袖口、一块表带推断出对方的职业与经历。',
      '他看你一眼，就替你把前半生讲完了。',
      'Sherlock Holmes could deduce a stranger\'s entire profession from a single detail.',
      '夏洛克·福尔摩斯能凭一个细节推断出一个陌生人的整个职业。',
      SRC.sh),

    deduction: M('派生词 · 来自拉丁语 deducere（引出）',
      'n. 推论，演绎（法）；扣除',
      '演绎法。夏洛克反复强调自己用的不是「猜」，而是以事实为起点的演绎法。',
      '他说的每个字，都要能追溯到某个事实。',
      'John Watson learned to respect the deduction before he understood the reasoning.',
      '约翰·华生是先学会尊重这套演绎法，才慢慢听懂其中推理的。',
      SRC.sh),

    investigate: M('派生词 · 来自拉丁语 vestigare（追踪足迹）',
      'v. 调查，侦查；研究',
      '调查。苏格兰场（Scotland Yard）负责立案调查，而夏洛克负责在别人查不下去的地方接着查。',
      '苏格兰场结案的地方，他刚开始。',
      'Sherlock Holmes would investigate a case long after Scotland Yard had closed it.',
      '苏格兰场结案之后，夏洛克·福尔摩斯往往还会继续调查很久。',
      SRC.sh),

    evidence: M('核心词 · 来自拉丁语 evidens（明显的）',
      'n. 证据，证明；迹象',
      '证据。夏洛克的信条是「证据优先」——哪怕结论再合理，没有证据就一步都不往下走。',
      '没有证据的推理，在他看来只是故事。',
      'Sherlock Holmes refused to name a suspect without physical evidence from the crime scene.',
      '没有来自犯罪现场的实际证据，夏洛克·福尔摩斯拒绝指认任何嫌疑人。',
      SRC.sh),

    suspect: M('核心词 · 来自拉丁语 suspicere（从下往上看）',
      'n. 嫌疑人 adj. 可疑的 v. 怀疑',
      '嫌疑人。夏洛克常在见到嫌疑人之前就锁定目标，因为他把整个伦敦都当成潜在嫌疑人来观察。',
      '福尔摩斯从不先问谁有嫌疑，他先问的是：谁的嫌疑被所有人漏掉了。',
      'To Sherlock Holmes, the most interesting suspect is usually the one nobody else considered.',
      '对夏洛克·福尔摩斯而言，最有意思的嫌疑人，往往是别人根本没考虑过的那个人。',
      SRC.sh),

    witness: M('核心词 · 来自古英语 witnes（知情者）',
      'n. 目击者，证人 v. 目击',
      '证人。夏洛克对证人的证词天生不信任——他更相信自己从现场看到的。',
      '人在撒谎的时候，细节反而更少。',
      'Sherlock Holmes trusted his own eyes more than any witness statement.',
      '夏洛克·福尔摩斯更相信自己亲眼所见，而不是任何证人的证词。',
      SRC.sh),

    motive: M('核心词 · 来自拉丁语 movere（推动）',
      'n. 动机，目的',
      '动机。夏洛克的破案逻辑永远是三步：谁有能力、谁有条件、谁有动机——最后一项决定一切。',
      '案子破不了的时候，通常就卡在动机上。',
      'Once Sherlock Holmes had a motive, the rest of the case usually solved itself.',
      '一旦夏洛克·福尔摩斯找到了动机，剩下的部分通常就自己解开了。',
      SRC.sh),

    alibi: M('核心词 · 来自拉丁语 alibi（在别处）',
      'n. 不在场证明；辩解',
      '不在场证明。夏洛克对完美的不在场证明反而格外警惕，因为越完美的证明越可能是精心设计的。',
      '一个完美的不在场证明，本身就是一条线索。',
      'Sherlock Holmes was most suspicious of a suspect with a flawless alibi.',
      '夏洛克·福尔摩斯最怀疑的，正是那个拥有完美不在场证明的嫌疑人。',
      SRC.sh),

    forensic: M('派生词 · 来自拉丁语 forum（法庭）',
      'adj. 法医的，法证的；法庭的',
      '法医的。剧中大量的法证（forensic）细节来自停尸房，而莫莉·琥珀就工作在那里。',
      '他的很多线索，是从停尸房拿回来的。',
      'Molly Hooper gave Sherlock Holmes the forensic results everyone else had overlooked.',
      '莫莉·琥珀把别人都忽略掉的法庭检验结果交给了夏洛克·福尔摩斯。',
      SRC.sh),

    pathologist: M('派生词 · 来自希腊语 pathos（疾病）+ logos（学说）',
      'n. 病理学家',
      '病理学家。莫莉·琥珀（Molly Hooper）是圣巴塞洛缪医院的病理学家，也是夏洛克少数真正信任的人之一。',
      '她看着他的次数，比案子本身还多。',
      'Molly Hooper, the pathologist at St Bartholomew\'s, was one of the few people Sherlock trusted.',
      '圣巴塞洛缪医院的病理学家莫莉·琥珀，是夏洛克少数真正信任的人之一。',
      SRC.sh),

    corpse: M('核心词 · 来自拉丁语 corpus（身体）',
      'n. 尸体，死尸',
      '尸体。夏洛克在停尸房里对尸体的态度近乎冷静到冒犯——对他来说，那只是一份最诚实的证词。',
      '在福尔摩斯眼里，尸体从不说谎——他只对还活着的人保持客气。',
      'A corpse never lies, which is why Sherlock Holmes preferred the mortuary to the interview room.',
      '尸体从不说谎，所以夏洛克·福尔摩斯更愿意待在停尸房而不是审讯室。',
      SRC.sh),

    intellect: M('核心词 · 来自拉丁语 intellegere（理解）',
      'n. 智力，理解力；才智出众的人',
      '智力。夏洛克的哥哥麦考夫·福尔摩斯（Mycroft Holmes）智力甚至高于他，却选择把才智用在权力而非案件上。',
      '他哥不是赢不了他，是不想跟他玩。',
      'Mycroft Holmes had an intellect that matched his brother\'s, and none of his appetite for cases.',
      '麦考夫·福尔摩斯的智力不输弟弟，却完全没有弟弟那种对案子的胃口。',
      SRC.sh),

    genius: M('核心词 · 来自拉丁语 genius（守护神、天赋）',
      'n. 天才；天赋，才华',
      '天才。媒体把夏洛克称为天才，他自己却认为这只是一种「更勤奋的观察」。',
      '他不觉得自己聪明，只觉得别人看得太少。',
      'The papers called him a genius, but Sherlock Holmes simply thought other people looked too little.',
      '报纸称他为天才，但夏洛克·福尔摩斯只觉得别人看得太少。',
      SRC.sh),

    observation: M('派生词 · 来自拉丁语 observare（注视）',
      'n. 观察，观察力；言论',
      '观察。夏洛克与华生初次见面就断言他来自战场的军医，靠的是纯粹的观察力。',
      '他握手的那一秒，就已经在读完你。',
      'John Watson was stunned by an observation Sherlock Holmes made in the first second they met.',
      '约翰·华生被夏洛克·福尔摩斯在他们初见第一秒做出的观察惊住了。',
      SRC.sh),

    analysis: M('派生词 · 来自希腊语 analyein（拆解）',
      'n. 分析，解析；检验',
      '分析。夏洛克要求实验室 24 小时为他开放，因为他的推理必须建立在化验结果之上。',
      '在指认凶手之前，福尔摩斯坚持先拿到实验室的化验分析，而不是靠直觉。',
      'Sherlock Holmes needed the laboratory analysis before he would allow himself to name a killer.',
      '在允许自己指认凶手之前，夏洛克·福尔摩斯必须要拿到实验室的分析结果。',
      SRC.sh),

    surveillance: M('派生词 · 来自法语 surveiller（监视）',
      'n. 监视，监控',
      '监视。莫里亚蒂的犯罪网络遍布全城，夏洛克不得不同样布下监视（surveillance）才能反过来盯住对方。',
      '一旦确认莫里亚蒂在盯着自己，福尔摩斯立刻在贝克街周围布下了反向监视。',
      'Sherlock Holmes set up surveillance around Baker Street once he knew Moriarty was watching.',
      '一旦知道莫里亚蒂在盯着自己，夏洛克·福尔摩斯就在贝克街周围布下了监视。',
      SRC.sh),

    cipher: M('核心词 · 来自阿拉伯语 sifr（零）',
      'n. 密码，暗号；无足轻重的人',
      '密码。莫里亚蒂把线索藏在一串只对夏洛克有意义的密码（cipher）里，把破案变成了一场私人游戏。',
      '整座伦敦，都是他给夏洛克留的题面。',
      'Moriarty left a cipher only Sherlock Holmes would bother to break.',
      '莫里亚蒂留下的密码，只有夏洛克·福尔摩斯才会费心去破。',
      SRC.sh),

    encryption: M('派生词 · 来自希腊语 kryptos（隐藏的）',
      'n. 加密，加密术',
      '加密。剧中多起案件的突破点在于破解加密（encryption）文件，这也是现代侦探与原著最大的区别之一。',
      '十九世纪的侦探，也得学二十一世纪的锁。',
      'Cracking the encryption on a stolen laptop put Sherlock Holmes one step ahead of Moriarty.',
      '破解那台被盗笔记本的加密，让夏洛克·福尔摩斯比莫里亚蒂先走了一步。',
      SRC.sh),

    hypothesis: M('核心词 · 来自希腊语 hypothesis（前提）',
      'n. 假设，假说',
      '假设。夏洛克办案的方式是先提出假设（hypothesis），再用现场细节去否定或证实它。',
      '福尔摩斯把每一个假设都当作待推翻的对象，而不是急着去证明它成立。',
      'Sherlock Holmes treated every hypothesis as something to be destroyed, not defended.',
      '夏洛克·福尔摩斯把每一个假设都当作该被推翻、而不是该被捍卫的东西。',
      SRC.sh),

    clue: M('核心词 · 来自古英语 cliwen（线团）',
      'n. 线索，提示',
      '线索。夏洛克声称最难的不是找到线索（clue），而是判断哪一条值得追。',
      '线索满地都是，值钱的是排除法。',
      'The clue was always in plain sight; Sherlock Holmes just refused to look past it.',
      '线索一直就摆在明处，只是夏洛克·福尔摩斯拒绝视而不见。',
      SRC.sh),

    vanish: M('派生词 · 来自拉丁语 vanus（空的）',
      'v. 消失，突然不见；不复存在',
      '消失。第二季结尾夏洛克当着华生的面坠楼后「消失」了两年，是全剧最大的转折。',
      '他让全世界都以为他死了，除了他自己。',
      'Sherlock Holmes had to vanish completely before he could come back and save John Watson.',
      '夏洛克·福尔摩斯必须先彻底消失，才能回来救约翰·华生。',
      SRC.sh),

    notorious: M('派生词 · 来自拉丁语 notus（已知的）',
      'adj. 臭名昭著的，声名狼藉的',
      '臭名昭著的。吉姆·莫里亚蒂（Jim Moriarty）自称「咨询罪犯」，是伦敦最臭名昭著也最难抓住的人。',
      '他不需要藏，他只需要没人敢动他。',
      'Moriarty was the most notorious criminal in London, and he made sure Sherlock Holmes knew it.',
      '莫里亚蒂是伦敦最臭名昭著的罪犯，而他要确保夏洛克·福尔摩斯知道这一点。',
      SRC.sh),

    adversary: M('核心词 · 来自拉丁语 adversarius（对手）',
      'n. 对手，敌手',
      '对手。莫里亚蒂是夏洛克唯一承认与自己同级别的对手（adversary）。',
      '在福尔摩斯口中，别人都只是一桩桩案子，只有莫里亚蒂被他称为对手。',
      'Moriarty was the only adversary Sherlock Holmes ever called his equal.',
      '莫里亚蒂是夏洛克·福尔摩斯唯一称之为与自己势均力敌的对手。',
      SRC.sh),

    accomplice: M('派生词 · 来自拉丁语 complicare（折叠在一起）',
      'n. 共犯，帮凶',
      '共犯。夏洛克破案时常要先揪出那个被忽视的共犯（accomplice），因为主谋很少亲自到场。',
      '主谋从不出现，出现的是替他动手的人。',
      'Behind every Moriarty scheme was an accomplice too ordinary to be noticed.',
      '莫里亚蒂每一个计划背后，都有一个普通到没人注意的共犯。',
      SRC.sh),

    anonymous: M('派生词 · 来自希腊语 anonymos（无名的）',
      'adj. 匿名的，无名的',
      '匿名的。剧中的威胁常常以匿名的短信、匿名的电话出现——越是匿名，越让人不敢忽视。',
      '一条没有署名的匿名短信，就足以把福尔摩斯半夜从贝克街拽出去。',
      'An anonymous text message was enough to pull Sherlock Holmes out of Baker Street at midnight.',
      '一条匿名的短信，就足以把夏洛克·福尔摩斯半夜从贝克街拉出去。',
      SRC.sh),

    arrogance: M('派生词 · 来自拉丁语 arrogare（要求、僭取）',
      'n. 傲慢，自大',
      '傲慢。夏洛克的傲慢（arrogance）是他最大的武器，也是他最致命的破绽。',
      '他的聪明从不伤人，他的态度会。',
      'Sherlock Holmes admitted that his arrogance had cost John Watson more than once.',
      '夏洛克·福尔摩斯承认，他的傲慢不止一次让约翰·华生付出了代价。',
      SRC.sh),

    infer: M('派生词 · 来自拉丁语 inferre（带入）',
      'v. 推断，推论；暗示',
      '推断。夏洛克要求自己只从事实出发 infer，绝不让先入之见污染结论。',
      '福尔摩斯从不靠猜，他能从一个男人鞋面的光泽推断出对方全部的作息。',
      'Sherlock Holmes could infer a man\'s whole routine from the shine on his shoes.',
      '夏洛克·福尔摩斯能从一个男人鞋面的光泽推断出他全部的作息。',
      SRC.sh),

    testimony: M('核心词 · 来自拉丁语 testis（证人）',
      'n. 证词，证言；证据',
      '证词。夏洛克对证词的信任度极低——记忆会被情绪改写，而现场不会。',
      '他宁可去停尸房，也不愿听人讲。',
      'Sherlock Holmes treated every testimony as one version of events, never as the truth.',
      '夏洛克·福尔摩斯把每一份证词都当成一种版本，而不是真相。',
      SRC.sh),

    forgery: M('派生词 · 来自拉丁语 fabricare（制作）',
      'n. 伪造，伪造物；赝品',
      '伪造。剧中多起案件的关键都指向一份看似天衣无缝的伪造文件（forgery）。',
      '那份伪造的文件太完美了，连苏格兰场都把它当成真迹收进了档案。',
      'The forgery was so perfect that even Scotland Yard accepted the signature as real.',
      '那份伪造太完美了，连苏格兰场都承认这个签名是真的。',
      SRC.sh),

    credible: M('派生词 · 来自拉丁语 credere（相信）',
      'adj. 可信的，可靠的',
      '可信的。夏洛克的第一条准则：故事越顺理成章，越要多问一句。',
      '福尔摩斯发现，最不可信的那个故事，往往才是唯一真实的版本。',
      'Sherlock Holmes found the least credible story was usually the true one.',
      '夏洛克·福尔摩斯发现，最不可信的那个故事，往往才是真的。',
      SRC.sh),

    irrational: M('派生词 · 来自拉丁语 irrationalis（无理性的）',
      'adj. 不合逻辑的，非理性的',
      '非理性的。夏洛克发现，人一旦 irrational，行为轨迹反而更容易被预测。',
      '莫里亚蒂最危险的地方，在于他以一种完全可预测的方式保持着非理性。',
      'Moriarty was dangerous because he was irrational in a completely predictable way.',
      '莫里亚蒂之所以危险，正因为他以一种完全可预测的方式非理性。',
      SRC.sh),

    chase: M('核心词 · 来自古法语 chacier（追逐）',
      'n./v. 追逐，追赶；追求',
      '追逐。伦敦街头的追逐戏最能体现夏洛克「思维与身体同时高速运转」的风格。',
      '他跑起来的样子，和推理时一样急。',
      'Sherlock Holmes never began a chase without first knowing where it had to end.',
      '夏洛克·福尔摩斯从不会在不知道终点在哪之前就开始追逐。',
      SRC.sh),
  },
};

/* --------------------------------------------------------------------------
 * 经典电影 · Classic Movies
 * 片名核验来源：中国进口片发行译名 / 豆瓣电影条目
 *   《肖申克的救赎》The Shawshank Redemption、《教父》The Godfather、
 *   《盗梦空间》Inception、《泰坦尼克号》Titanic、《阿甘正传》Forrest Gump、
 *   《黑客帝国》The Matrix、《星际穿越》Interstellar。
 * ----------------------------------------------------------------------- */
const CLASSIC_MOVIES = {
  domainId: 'classicMovies',
  domainName: '经典电影',
  domainIdInConfig: 'classic_movies',
  gameNameEn: 'Classic Movies',
  file: 'classicMovies.json',
  materialsVersion: 1,
  batch: 2,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '片名以中国大陆公映发行译名为准（豆瓣电影条目核对）；角色名沿用官方中文字幕通行译法。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有影片相关图片版权归各自发行方及原作者所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    redemption: M('核心词 · 来自拉丁语 redimere（赎回）',
      'n. 救赎，赎罪；赎回',
      '救赎。《肖申克的救赎》（The Shawshank Redemption）的核心：安迪·杜佛兰（Andy Dufresne）用十九年挖出的那条隧道。',
      '他用一把小锤子，换回了整个人生。',
      'Andy Dufresne found redemption not in the courtroom, but through the tunnel he dug himself.',
      '安迪·杜佛兰的救赎不在法庭上，而在他亲手挖出的那条隧道里。',
      SRC.cm),

    institution: M('派生词 · 来自拉丁语 instituere（建立）',
      'n. 制度，机构；（监狱等）收容机构',
      '体制化。肖申克监狱的老囚布鲁克斯出狱后无法适应外面，瑞德（Red）把这种状态称为「体制化」。',
      '高墙先让你恨它，再让你离不开它。',
      'Red warned that Shawshank was an institution you would first hate and then depend on.',
      '瑞德警告说，肖申克是一座你先是恨、后来却离不开的体制。',
      SRC.cm),

    architect: M('核心词 · 来自希腊语 arkhitekton（总工匠）',
      'n. 建筑师；缔造者，设计者',
      '造梦师。《盗梦空间》（Inception）中负责搭建梦境的「造梦师」（Architect），能在梦里折叠整座巴黎。',
      '她不是在画图，她是在造一座会折叠的城。',
      'The Architect in Inception does not design buildings; she designs the laws of a dream.',
      '《盗梦空间》里的造梦师不是在设计建筑，而是在设计梦境的法则。',
      SRC.cm),

    subconscious: M('派生词 · 来自拉丁语 sub（在下）+ conscius（知晓）',
      'n./adj. 潜意识（的），下意识（的）',
      '潜意识。《盗梦空间》中柯布（Cobb）团队潜入的正是目标的潜意识（subconscious），最深处的想法才会在那里生根。',
      '最难进的不是保险箱，是人心底下的那层。',
      'In Inception, an idea must be planted deep in the subconscious before it can survive.',
      '在《盗梦空间》里，一个念头必须先被种进潜意识深处，才能存活下来。',
      SRC.cm),

    gravity: M('核心词 · 来自拉丁语 gravitas（重量）',
      'n. 重力，引力；严重性',
      '引力。《星际穿越》（Interstellar）的物理核心：时间在强引力（gravity）场中会变慢，星球上一小时等于地球七年。',
      '在那颗星球上，一小时能换掉地球上七年。',
      'Near a black hole in Interstellar, gravity stretches one hour into seven years on Earth.',
      '在《星际穿越》的黑洞附近，引力把一小时拉成了地球上的七年。',
      SRC.cm),

    dimension: M('核心词 · 来自拉丁语 dimetiri（测量）',
      'n. 维度，尺寸；方面',
      '维度。《星际穿越》中人类要解决的，是如何穿过高维（dimension）空间把关键数据传回地球。',
      '他伸手够到的，是另一个维度的书架。',
      'Cooper reaches across dimensions to touch the bookshelf in his daughter\'s room.',
      '库珀穿过维度，去触碰到他女儿房间里的书架。',
      SRC.cm),

    wormhole: M('复合词 · 由 worm（虫）+ hole（洞）构成',
      'n. 虫洞（理论物理中的时空通道）',
      '虫洞。《星际穿越》里通向遥远星系的近路，是人类最后的希望所在。',
      '土星旁边那个球，是人类唯一的近路。',
      'The wormhole near Saturn gave Interstellar\'s crew a shortcut no human had ever used.',
      '土星附近的那个虫洞，给了《星际穿越》的船员们一条从未有人走过的近路。',
      SRC.cm),

    relativity: M('派生词 · 来自拉丁语 referre（带回、关联）',
      'n. 相对性；相对论',
      '相对论。《星际穿越》全片的情绪支点：因为相对论（relativity）效应，库珀错过了女儿的大半生。',
      '他回来的时候，女儿已经比他还老。',
      'Relativity in Interstellar means Cooper loses his daughter\'s whole childhood in a few hours.',
      '《星际穿越》中的相对论意味着，库珀在几个小时里失去了女儿的整个童年。',
      SRC.cm),

    voyage: M('核心词 · 来自拉丁语 viaticum（旅途所需）',
      'n. 航行，远航；旅程',
      '航行。《泰坦尼克号》（Titanic）的悲剧前提：这艘「永不沉没」的巨轮，在处女航（maiden voyage）中撞上冰山。',
      '它的第一次航行，也是最后一次。',
      'Titanic sank on its maiden voyage, before the ship ever completed a single crossing.',
      '泰坦尼克号在处女航中沉没，这艘船从未完成过任何一次完整横渡。',
      SRC.cm),

    iceberg: M('复合词 · 由 ice（冰）+ berg（山）构成',
      'n. 冰山；冰山一角（隐藏的巨大问题）',
      '冰山。泰坦尼克号沉没的直接原因。剧作上也常用 iceberg 比喻「看不见的部分更大」。',
      '撞上的不是整座冰，只是一小角。',
      'The iceberg that sank Titanic was mostly hidden beneath the surface.',
      '击沉泰坦尼克号的那座冰山，绝大部分都隐藏在水面之下。',
      SRC.cm),

    survival: M('派生词 · 来自拉丁语 supervivere（活得更久）',
      'n. 幸存，生存',
      '生存。泰坦尼克号上「妇孺优先」的救生艇规则，最终酿成了一场关于阶级与生存的悲剧。',
      '救生艇够不够坐，从来不是数学题。',
      'In Titanic, survival depended less on swimming than on which deck your ticket placed you on.',
      '在《泰坦尼克号》里，能否生存更多取决于你的船票把你放在了哪一层甲板。',
      SRC.cm),

    destiny: M('核心词 · 来自拉丁语 destinare（确定、注定）',
      'n. 命运，天命',
      '命运。《阿甘正传》（Forrest Gump）里阿甘反复说的一句话是：妈妈说，命运（destiny）要自己去实现。',
      '他跑了一辈子，也没问过为什么要跑。',
      'Forrest Gump believed destiny was not something you wait for but something you run toward.',
      '阿甘相信，命运不是等来的，而是跑向的。',
      SRC.cm),

    coincidence: M('派生词 · 来自拉丁语 coincidere（同时落下）',
      'n. 巧合，巧事',
      '巧合。阿甘一生混入美国几乎所有大事件，看似巧合（coincidence），其实是剧本刻意安排的荒诞感。',
      '他的人生没有偶然，只有还没播到的那一集。',
      'Forrest Gump\'s life looks like pure coincidence until you notice how carefully it was written.',
      '阿甘的一生看起来全是巧合，直到你发现它被写得多么刻意。',
      SRC.cm),

    illusion: M('派生词 · 来自拉丁语 illudere（嘲弄）',
      'n. 幻觉，错觉；假象',
      '幻象。《黑客帝国》（The Matrix）里尼奥（Neo）面对的第一个选择题：眼前的现实，是否只是一种幻象（illusion）。',
      '尼奥面对的不是真相与谎言，而是一颗药丸的距离：舒适的幻象，还是痛苦的现实。',
      'The Matrix offers Neo a simple choice between comfortable illusion and painful reality.',
      '《黑客帝国》给了尼奥一个简单的选择：舒适的幻象，还是痛苦的现实。',
      SRC.cm),

    simulation: M('派生词 · 来自拉丁语 simulare（模仿）',
      'n. 模拟，仿真',
      '模拟。《黑客帝国》里的整个世界就是一套为人类意识准备的模拟（simulation）系统。',
      '在《黑客帝国》里，整座城市连同吹过脸颊的风，都是被机器算出来的。',
      'In The Matrix, the simulation is so perfect that nobody inside it ever suspects the truth.',
      '在《黑客帝国》里，这套模拟太完美了，以至于里面没有一个人怀疑过真相。',
      SRC.cm),

    reality: M('核心词 · 来自拉丁语 res（事物）',
      'n. 现实，真实；实际存在',
      '现实。《黑客帝国》中「现实」成了一种需要被选择、更需要被忍受的东西。',
      '他要的不是自由，是能自己确认的世界。',
      'Neo chose reality even though everyone told him he would prefer the illusion.',
      '尽管所有人都告诉他他会更喜欢幻象，尼奥还是选择了现实。',
      SRC.cm),

    liberation: M('派生词 · 来自拉丁语 liberare（释放）',
      'n. 解放，释放',
      '解放。《肖申克的救赎》结尾，安迪·杜佛兰从下水道爬出、在雨中张开双臂，是影史上最著名的「解放」画面。',
      '五百码的污水，换来了一个人的自由。',
      'Andy Dufresne crawled through half a mile of sewage to reach his own liberation.',
      '安迪·杜佛兰爬过近一公里的污水，才抵达了自己的解放。',
      SRC.cm),

    sacrifice: M('核心词 · 来自拉丁语 sacer（神圣的）+ facere（做）',
      'n./v. 牺牲，献出',
      '牺牲。《泰坦尼克号》中杰克（Jack）把漂浮的门板让给露丝（Rose），是这场灾难里最被记住的一次牺牲。',
      '他把自己留在水里，让另一个人上岸。',
      'Jack\'s sacrifice in Titanic gave Rose a whole life she would never have had otherwise.',
      '杰克在《泰坦尼克号》里的牺牲，给了露丝一段她本不可能拥有的人生。',
      SRC.cm),

    perseverance: M('派生词 · 来自拉丁语 perseverare（坚持）',
      'n. 毅力，坚持不懈',
      '毅力。安迪用一把小锤子挖了十九年，靠的不是聪明，而是毅力（perseverance）。',
      '安迪·杜佛兰用十九年、每天挖一点，把一堵石墙挖成了通往自由的隧道。',
      'It was not genius but perseverance that let Andy Dufresne escape Shawshank.',
      '让安迪·杜佛兰逃出肖申克的不是天才，而是毅力。',
      SRC.cm),

    legacy: M('核心词 · 来自拉丁语 legare（遗赠）',
      'n. 遗产；遗留物，传承',
      '遗产。《教父》（The Godfather）真正的主题不是黑帮，而是维托·柯里昂（Vito Corleone）留给迈克尔（Michael）的那份遗产有多沉重。',
      '他留给儿子的不是家业，是一副甩不掉的担子。',
      'What Vito Corleone left Michael was not a business but a legacy of debt and blood.',
      '维托·柯里昂留给迈克尔的不是一门生意，而是一份由债务与鲜血组成的遗产。',
      SRC.cm),

    vendetta: M('核心词 · 来自意大利语 vendetta（复仇）',
      'n. 家族间的血仇，长期复仇',
      '血仇。《教父》里柯里昂家族的纷争常以血仇（vendetta）形式延续，一旦开始就没有真正的结束。',
      '五大黑手党家族从不用「战争」这个词，他们管那场血腥的仇杀叫「家事」。',
      'A vendetta between the Five Families turned into the bloodiest chapter of The Godfather.',
      '五大黑手党家族之间的血仇，成了《教父》里最血腥的一章。',
      SRC.cm),

    loyalty: M('核心词 · 来自拉丁语 legalis（合法的、守法的）',
      'n. 忠诚，忠心',
      '忠诚。《教父》里「忠诚」是唯一的硬通货：维托·柯里昂拒绝了毒品生意，正因为他不愿用忠诚换短期的钱。',
      '他不要生意，他要的是所有人都欠他一次。',
      'In The Godfather, loyalty is worth more than any single deal, and Vito Corleone knew it.',
      '在《教父》里，忠诚比任何单笔生意都值钱，维托·柯里昂深知这一点。',
      SRC.cm),

    ambition: M('核心词 · 来自拉丁语 ambitio（奔走求官）',
      'n. 野心，雄心，抱负',
      '野心。《教父》中迈克尔从「不想插手家族事务」到彻底接过权杖，正是野心（ambition）与责任互相吞噬的过程。',
      '他说过不想进这个圈子，然后成了它的中心。',
      'Michael Corleone\'s ambition grew exactly as fast as his innocence disappeared.',
      '迈克尔·柯里昂的野心增长得多快，他的纯真就消失得多快。',
      SRC.cm),

    deceive: M('核心词 · 来自拉丁语 decipere（捕捉、欺骗）',
      'v. 欺骗，蒙骗；误导',
      '欺骗。《盗梦空间》的核心技法是让目标自己欺骗（deceive）自己——最牢固的谎言，是被植入者亲手写下的那一句。',
      '最深的谎言，是他自己相信的那句。',
      'The team in Inception must deceive their target without ever lying to him directly.',
      '《盗梦空间》的团队必须在从不直接撒谎的前提下，欺骗他们的目标。',
      SRC.cm),

    revelation: M('派生词 · 来自拉丁语 revelare（揭开）',
      'n. 揭示，揭露；被揭露的真相',
      '揭示。《星际穿越》最后，库珀在五维空间里传回数据的那一刻，是全片所有伏笔的揭示（revelation）。',
      '他隔着书架，把答案交给了女儿。',
      'The revelation in Interstellar arrives through a bookshelf, not a laboratory.',
      '《星际穿越》里的真相揭示，是通过一个书架而不是实验室到来的。',
      SRC.cm),

    courage: M('核心词 · 来自拉丁语 cor（心）',
      'n. 勇气，胆量',
      '勇气。《肖申克的救赎》里瑞德（Red）说，希望是最危险的东西；安迪·杜佛兰把这句话活成了十九年。',
      '真正的勇气，是还愿意相信明天。',
      'Andy Dufresne showed more courage in Shawshank than any man with a hammer should need.',
      '安迪·杜佛兰在肖申克展现的勇气，比任何拿着锤子的人该有的都多。',
      SRC.cm),

    epic: M('核心词 · 来自希腊语 epos（话语、史诗）',
      'n. 史诗，史诗电影 adj. 史诗般的，宏大的',
      '史诗。《指环王》（The Lord of the Rings）是影史上被反复引用的史诗范本，规模与情感同时铺开。',
      '《指环王》用四个小时讲完一整个世界，此后每部奇幻三部曲都被拿来与它比较。',
      'The Lord of the Rings remains the epic that every fantasy trilogy is measured against.',
      '《指环王》至今仍是衡量所有奇幻三部曲的那部史诗。',
      SRC.cm),

    innocence: M('派生词 · 来自拉丁语 innocens（无害的）',
      'n. 无辜，清白；天真',
      '清白。《肖申克的救赎》的核心不公：安迪的清白（innocence）恰恰是法庭最不关心的东西。',
      '安迪·杜佛兰花了十九年证明自己的清白，而法庭从未真正在意过这件事。',
      'Andy Dufresne spent nineteen years proving an innocence the court never cared about.',
      '安迪·杜佛兰花了十九年，去证明一份法庭从不在乎的清白。',
      SRC.cm),

    farewell: M('核心词 · 来自古英语 faran（远行）+ wel（好）',
      'n. 告别，辞行',
      '告别。《阿甘正传》（Forrest Gump）里的告别从不煽情，却总发生在最普通的一天。',
      '阿甘说再见的方式和他做任何事一样简单：说一句「我得走了」，然后转身就走。',
      'Forrest Gump said farewell the way he did everything: simply, and without regret.',
      '阿甘说再见的方式，和他做任何事一样：简单，且不后悔。',
      SRC.cm),

    triumph: M('核心词 · 来自拉丁语 triumphus（凯旋）',
      'n. 胜利，成就 v. 战胜，获胜',
      '胜利。《阿甘正传》最动人的地方在于，阿甘的每一次胜利都不是他刻意追求的。',
      '阿甘最伟大的胜利，从来不是他事先规划好的目标，而只是他没有停下来。',
      'Forrest Gump\'s greatest triumph was never something he had set out to achieve.',
      '阿甘最伟大的胜利，从来不是他刻意去争取的。',
      SRC.cm),

    despair: M('派生词 · 来自拉丁语 desperare（失去希望）',
      'n./v. 绝望',
      '绝望。《肖申克的救赎》里，绝望就是那堵墙——它不杀人，只让人慢慢不想出去。',
      '肖申克里最可怕的从来不是那堵墙，而是绝望——它不杀人，只让人不想出去。',
      'Red called Shawshank a place where despair was the only thing that kept a schedule.',
      '瑞德说，肖申克是一个只有绝望按时上下班的地方。',
      SRC.cm),

    justice: M('核心词 · 来自拉丁语 iustitia（公正）',
      'n. 正义，公正；司法',
      '正义。《教父》（The Godfather）与《肖申克的救赎》都在追问：当制度失效时，正义还能从哪里来。',
      '法律给不了的，有人用别的方式给。',
      'The Godfather suggests that justice outside the law is only another word for power.',
      '《教父》暗示，法律之外的正义，不过是权力的另一个名字。',
      SRC.cm),

    eternal: M('派生词 · 来自拉丁语 aeternus（永恒的）',
      'adj. 永恒的，不朽的；没完没了的',
      '永恒。《泰坦尼克号》（Titanic）把三天的爱情讲成了永恒的东西，靠的是结尾那句「我永不放手」。',
      '杰克沉进冰海里，露丝却用剩下的一辈子，把这三天的爱情过成了永恒。',
      'Titanic turns a three-day romance into something the audience reads as eternal.',
      '《泰坦尼克号》把一段三天的爱情，讲成了观众心中的永恒。',
      SRC.cm),
  },
};

/* ==========================================================================
 * 第三批（体育）
 * ======================================================================= */

/* --------------------------------------------------------------------------
 * 篮球 · Basketball（NBA / CBA）
 * 译名核验来源：NBA 中国官网 nba.com/china 与 CBA 官网 cbaleague.com
 *   —— 联赛名、球队名、赛制名均采用上述渠道通行中文写法。
 *   球队英文多以「城市 + 队名」形式出现，key 用全小写连写（如 losAngelesLakers）。
 * ----------------------------------------------------------------------- */
const BASKETBALL = {
  domainId: 'basketball',
  domainName: '篮球',
  domainIdInConfig: 'basketball',
  gameNameEn: 'Basketball (NBA / CBA)',
  file: 'basketball.json',
  materialsVersion: 1,
  batch: 3,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '联赛与球队译名以 NBA 中国官网（nba.com/china）与 CBA 官网（cbaleague.com）通行中文为准。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有赛事相关图片版权归各自版权方所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    athlete: M('核心词',
      'n. 运动员，体育健儿',
      '运动员。NBA 与 CBA 的职业球员都要经过系统的体能与技术打磨，athlete 泛指以竞技为业的人。',
      '他不是天才，只是一年三百天泡在球馆里的人。',
      'Every NBA athlete trains far more hours than the fans on the couch ever imagine.',
      '每一名 NBA 运动员的训练时长，都远超瘫在沙发上看球的球迷的想象。',
      SRC.bk),

    coach: M('核心词',
      'n. 教练；长途汽车；v. 训练，指导',
      '主教练。NBA 与 CBA 各队设主教练（head coach）与助理教练，负责战术布置与临场调整。',
      '暂停哨响，主教练把战术板往膝盖上一拍，全队立刻安静。',
      'The CBA head coach drew a last-second play on the board during the timeout.',
      'CBA 主教练在暂停时，把最后一攻画在了战术板上。',
      SRC.bk),

    arena: M('核心词',
      'n. 竞技场，活动场所',
      '球馆。NBA 各队主场动辄容纳近两万人，场馆氛围本身就是比赛的一部分。',
      '两万人的嘘声，比任何战术都更能打乱对手的罚球。',
      'The arena in Los Angeles roared as the Lakers began their comeback.',
      '湖人开始反扑时，洛杉矶的球馆沸腾了。',
      SRC.bk),

    assist: M('派生自 assistance（n. 帮助）；-ist 人（名词后缀）',
      'v. 帮助，协助；n. 助攻',
      '助攻。篮球统计中的 assist，指一次传球直接导致队友得分。',
      '数据表上，他的助攻数比赛季场均得分还高。',
      'A point guard can change an NBA game without scoring, simply by piling up assists.',
      '一名控卫不必得分，光靠堆积助攻就能改变一场 NBA 比赛。',
      SRC.bk),

    dribble: M('核心词',
      'v. 滴下，运球；n. 运球',
      '运球。篮球比赛中持球者必须持续运球才能移动，否则判违例。',
      '他压低重心，用不到一秒完成三次运球变向。',
      'The CBA guard dribbled past two defenders before pulling up for a jump shot.',
      '那名 CBA 后卫运球晃过两名防守者，急停跳投。',
      SRC.bk),

    foul: M('核心词',
      'adj. 污浊的，恶劣的；n. 犯规；v. 犯规',
      '犯规。篮球中个人累计犯规达到限定次数将被罚出场。',
      '终场前六犯离场，他把毛巾盖在头上，一句话没说。',
      'In the NBA, a player is ejected after committing six fouls in a single game.',
      '在 NBA，一名球员单场六次犯规后会被罚出场。',
      SRC.bk),

    penalty: M('派生自 penalize；派生词（由核心词根扩展而来）',
      'n. 处罚，罚款；罚球',
      '判罚与罚球。篮球中被犯规后获得的罚球机会，以及联盟开出的罚款，都可用 penalty 表达。',
      '两次罚球，落后两分，全场屏住呼吸。',
      'The CBA officials reviewed the tape before confirming the penalty.',
      'CBA 的裁判回看录像后，才确认了这一判罚。',
      SRC.bk),

    referee: M('核心词',
      'n. 裁判员；v. 裁判',
      '裁判。NBA 与 CBA 都设有职业裁判团队，并用录像回放中心辅助判罚。',
      '三名裁判围着回放屏，看了整整两分钟。',
      'The referees sent the call to the replay centre, a rule the NBA introduced years ago.',
      '裁判们把这次判罚送去了回放中心，这是 NBA 多年前引入的规则。',
      SRC.bk),

    substitute: M('派生自 substitution；sub- 在下，次',
      'n. 替代品，替补；v. 代替',
      '替补。篮球每场换人次数不受限制，替补（substitute）球员往往决定第二阵容的强度。',
      '替补席上那个沉默的年轻人，第四节拿了十八分。',
      'The CBA rookie came off the bench as a substitute and scored 18 points.',
      '那名 CBA 新秀作为替补登场，砍下 18 分。',
      SRC.bk),

    squad: M('核心词',
      'n. 小队，班；球队阵容',
      '阵容。NBA 每队注册名单通常在十五人左右，位置竞争极为激烈。',
      '名单只有十五个名额，每个位置都有三个人在抢。',
      'Only fifteen players fit into an NBA squad, so every training session is a fight.',
      '一支 NBA 球队的阵容只有十五个名额，所以每次训练都是一场争夺。',
      SRC.bk),

    tactic: M('派生自 tactical；派生词（由核心词根扩展而来）',
      'n. 策略，战术',
      '战术。篮球的挡拆、夹击、联防等都属于球队战术（tactic）。',
      '一整套战术，只为了给底角的射手创造半秒空档。',
      'The favourite tactic in the CBA finals was a high pick-and-roll.',
      '那届 CBA 总决赛里最常用的战术，是高位挡拆。',
      SRC.bk),

    formation: M('派生自 form；-ation 动作/状态（名词后缀）',
      'n. 形成，编队，阵型',
      '阵型与站位。篮球虽无足球那样的固定阵型，但联防站位同样讲求 formation。',
      '落位慢半拍，整条防线就被撕开了。',
      'The CBA team switched to a 2-3 zone formation to protect its tired big men.',
      '那支 CBA 球队改用 2-3 联防阵型，以保护体力透支的内线。',
      SRC.bk),

    defense: M('核心词',
      'n. 防御，辩护；防守（美式拼写）',
      '防守。篮球的防守体系包括人盯人与区域联防，是夺冠的地基。',
      '进攻能帮你赢下常规赛，但真正把冠军奖杯带回家的，永远是防守。',
      'Their defense held the NBA champions under 90 points for the first time.',
      '他们的防守首次把 NBA 卫冕冠军压到 90 分以下。',
      SRC.bk),

    offense: M('核心词',
      'n. 冒犯，犯罪；进攻（美式拼写）',
      '进攻。篮球的进攻回合讲究空间、节奏与出手选择。',
      '球在五个人手里转了三圈，最后由底角出手。',
      'A modern NBA offense depends on spacing and three-point shooting.',
      '现代 NBA 进攻依赖空间与三分投射。',
      SRC.bk),

    opponent: M('派生自 oppose（v. 反对）；派生词（由核心词根扩展而来）',
      'n. 对手，反对者',
      '对手。赛前研究对手录像，是 NBA 与 CBA 球队的日常功课。',
      '球探报告写满三页，只讲一个人。',
      'Before the tip-off, the CBA club studies each opponent in detail.',
      '开场之前，那支 CBA 球队会仔细研究每一个对手。',
      SRC.bk),

    rival: M('派生自 rivalry；派生词（由核心词根扩展而来）',
      'n. 对手，劲敌；v. 与…匹敌',
      '宿敌。NBA 的湖人与凯尔特人、CBA 的辽宁与广东，都是经典宿敌关系。',
      '同一座城市，两种颜色，二十年恩怨。',
      'Lakers versus Celtics remains the most storied rivalry in the NBA.',
      '湖人对凯尔特人，仍是 NBA 最富传奇色彩的宿敌对决。',
      SRC.bk),

    eliminate: M('派生自 elimination（n. 消除）；-ate 使…（动词后缀）',
      'v. 消除，淘汰',
      '淘汰。季后赛中，先赢下系列赛的一方把对手淘汰出局。',
      '四场结束，卫冕冠军被横扫出局。',
      'The CBA regular-season leaders were eliminated in the very first playoff round.',
      'CBA 常规赛领头羊在季后赛首轮就被淘汰了。',
      SRC.bk),

    qualify: M('派生自 quality；-ify 使…（动词后缀）',
      'v. 使合格，取得资格，晋级',
      '晋级。球队要在常规赛排名靠前，才能取得季后赛资格（qualify）。',
      '最后一场赢下三分，才勉强挤进季后赛。',
      'Eight teams qualify for the CBA playoffs each season, four from each group.',
      '每个赛季有八支球队获得 CBA 季后赛资格，两个小组各四支。',
      SRC.bk),

    finalist: M('派生自 final（adj. 最后的）；-ist 人（名词后缀）',
      'n. 决赛选手，决赛参赛者',
      '总决赛球队。NBA 与 CBA 每个赛季只有两支球队能成为 finalist。',
      '踩过三轮系列赛，才站到那个球场中央。',
      'Every NBA finalist has survived roughly eighty regular-season games first.',
      '每支打进 NBA 总决赛的球队，都要先熬过大约八十场常规赛。',
      SRC.bk),

    decisive: M('派生自 decide；-ive 有…性质的（形容词后缀）',
      'adj. 决定性的，果断的',
      '决定性的。比赛最后两分钟的关键球，往往具有决定性意义。',
      '那记三分落网的一瞬间，整座球馆都知道结果了。',
      'His decisive three-pointer in the CBA final will be replayed for years.',
      '他在 CBA 总决赛的那记决定性三分，会被回放很多年。',
      SRC.bk),

    momentum: M('核心词',
      'n. 动量，势头',
      '势头。一方连续得分会形成 momentum，教练常叫暂停打断它。',
      '连得十分之后，对面不得不叫暂停。',
      'One NBA timeout can kill the momentum the opponent just built.',
      '一次 NBA 暂停，就能掐灭对手刚刚打出的势头。',
      SRC.bk),

    morale: M('核心词',
      'n. 士气，斗志',
      '士气。连败会打击球队士气（morale），连胜则相反。',
      '更衣室里没人说话，士气低到冰点。',
      'A five-game losing streak can wreck the morale of any CBA squad.',
      '一波五连败足以击垮任何一支 CBA 球队的士气。',
      SRC.bk),

    endurance: M('派生自 endure（v. 忍受）；-ance 性质/状态（名词后缀）',
      'n. 忍耐力，持久力，耐力',
      '耐力。整季八十二场 NBA 常规赛，考验的是球员的耐力与恢复能力。',
      '第八十二场，腿像灌了铅，还是得跑。',
      'An 82-game NBA season tests endurance as much as skill.',
      '一个 82 场的 NBA 赛季，考验的不只是技术，更是耐力。',
      SRC.bk),

    fatigue: M('核心词',
      'n. 疲劳；v. 使疲劳',
      '疲劳。密集赛程带来的 fatigue 是伤病的主要诱因。',
      '背靠背的第二场，连呼吸都比平时重。',
      'Back-to-back games in the CBA schedule leave players with deep fatigue.',
      'CBA 赛程里的背靠背比赛，让球员积下深深的疲劳。',
      SRC.bk),

    injury: M('核心词',
      'n. 伤害，损伤，伤病',
      '伤病。NBA 与 CBA 都设有伤病名单（injury list）制度。',
      '一次落地不稳，整个赛季就结束了。',
      'One bad landing put the NBA All-Star on the injury list for six weeks.',
      '一次落地失稳，就让那位 NBA 全明星进了伤病名单，休战六周。',
      SRC.bk),

    recover: M('派生自 recovery；派生词（由核心词根扩展而来）',
      'v. 恢复，痊愈',
      '康复。球员从伤病中恢复（recover）后，往往还要经过负荷管理才能回到比赛。',
      '他把康复训练的每一天都记在本子上。',
      'It took the CBA centre a full season to recover from a torn ligament.',
      '那位 CBA 中锋花了一整个赛季，才从韧带撕裂中康复。',
      SRC.bk),

    agility: M('派生自 agile；-ity 性质（名词后缀）',
      'n. 敏捷，灵活',
      '敏捷。后卫的变向与横移速度，靠的正是敏捷性（agility）。',
      '他的第一步快得让防守者只看见背影。',
      'The NBA scout praised the young guard for his agility above everything else.',
      '那位 NBA 球探最称赞这名年轻后卫的，是他的敏捷。',
      SRC.bk),

    muscle: M('派生自 muscular；派生词（由核心词根扩展而来）',
      'n. 肌肉，力量',
      '肌肉与对抗。内线球员的对抗能力，与肌肉量直接相关。',
      '一个夏天增重十公斤，全加在肩膀和腿上。',
      'The CBA forward added five kilograms of muscle over one off-season.',
      '那位 CBA 前锋在一个休赛期里增加了五公斤肌肉。',
      SRC.bk),

    slam: M('核心词',
      'v. 猛击，砰地关上；n. 猛击',
      '暴扣。slam dunk 是篮球最具观赏性的得分方式。',
      '球从篮筐上方砸下去的那一刻，全场起立。',
      'His slam dunk over two NBA defenders became the play of the night.',
      '他隔着两名 NBA 防守者的暴扣，成了当晚最佳进球。',
      SRC.bk),

    spectator: M('派生自 spectacle（n. 景象）；派生词（由核心词根扩展而来）',
      'n. 观众，旁观者',
      '观众。NBA 与 CBA 的上座率与转播收入，都建立在 spectator 之上。',
      '两万人一起安静下来，只为等一次罚球。',
      'Twenty thousand spectators watched the CBA final from the stands.',
      '两万名观众在看台上观看了这场 CBA 总决赛。',
      SRC.bk),
  },
};

/* --------------------------------------------------------------------------
 * 羽毛球 · Badminton（汤姆斯杯 / 尤伯杯）
 * 译名核验来源：中国羽毛球协会与世界羽联（BWF）中文赛事名称
 *   —— 汤姆斯杯（Thomas Cup）、尤伯杯（Uber Cup）、苏迪曼杯（Sudirman Cup）、
 *      全英羽毛球公开赛（All England Open）均为官方通行中文名。
 * ----------------------------------------------------------------------- */
const BADMINTON = {
  domainId: 'badminton',
  domainName: '羽毛球',
  domainIdInConfig: 'badminton',
  gameNameEn: 'Badminton (Thomas Cup / Uber Cup)',
  file: 'badminton.json',
  materialsVersion: 1,
  batch: 3,
  _comment: [
    '预生成记忆材料（静态数据，运行时零网络请求、不调用任何 AI API）。',
    '赛事译名以中国羽毛球协会与世界羽联（BWF）中文赛事名称为准；球员名采用官方中文写法。',
    '无法确认官方译名的条目 unverified=true，卡片会标注【译名待确认】。',
    '泛化原则：以后新增任何兴趣领域，预生成材料都必须来自该领域的权威专业来源，禁止自行翻译。',
    '图片来源说明：所有赛事相关图片版权归各自版权方所有，本项目仅作个人学习用途，不用于任何商业场景。',
    'imageUrl 留空表示暂未确认可用的官方图片链接，禁止编造无效链接。',
    '例句出处：每条材料带 exampleSource 字段。',
  ],
  materials: {
    badminton: M('核心词',
      'n. 羽毛球（运动）',
      '羽毛球。男子团体最高荣誉为汤姆斯杯（Thomas Cup），女子团体为尤伯杯（Uber Cup）。',
      '一块拍子一只球，能在场上跑满两个小时。',
      'Badminton looks gentle, but a Thomas Cup final can last over five hours.',
      '羽毛球看着温和，但一场汤姆斯杯决赛能打五个多小时。',
      SRC.bd),

    smash: M('核心词',
      'v. 打碎，粉碎；n. 粉碎；扣杀',
      '扣杀。羽毛球速度最快的击球方式，顶级选手的扣杀球速可超过 400 公里/小时。',
      '球从头顶劈下，对手连拍都没抬起来。',
      'The smash Lin Dan hit at the Thomas Cup was almost impossible to return.',
      '林丹在汤姆斯杯上打出的那记扣杀，几乎无法回击。',
      SRC.bd),

    rally: M('核心词',
      'n. 集会；v. 集合，重整；多拍相持',
      '多拍相持。羽毛球中一次 rally 指从发球到球落地之间的连续对打。',
      '一个回合打了四十二拍，两个人都扶着膝盖喘。',
      'One rally in the Uber Cup final lasted forty-two shots.',
      '尤伯杯决赛中的一个回合，打了四十二拍。',
      SRC.bd),

    grip: M('核心词',
      'v./n. 紧握，控制；握法',
      '握拍。羽毛球有正手握拍与反手握拍，握拍方式直接决定击球方向。',
      '握拍时手指只是微微一转，出球的线路和落点就已经完全不同了。',
      'A loose grip is the fastest way to lose control in badminton.',
      '握拍一松，就是羽毛球里失去控制最快的方式。',
      SRC.bd),

    lunge: M('核心词',
      'v./n. 猛冲，扑；弓步上网',
      '弓步上网。羽毛球接网前小球时的标准步法，需要极强的大腿力量。',
      '他一步跨出去，几乎贴到地板才把球挑起来。',
      'Every lunge to the net in a Thomas Cup match costs a player real energy.',
      '汤姆斯杯比赛里每一次上网弓步，都要消耗球员真实的体力。',
      SRC.bd),

    stroke: M('核心词',
      'n. 中风，笔画；v. 抚摸；击球方式',
      '击球方式。羽毛球有高远球、吊球、平抽、挑球等多种击球技术。',
      '同样的准备动作，能打出三种完全不同的球。',
      'The coach drilled one stroke for two hours before the Uber Cup tie.',
      '尤伯杯比赛前，教练让队员把一种击球练了两个小时。',
      SRC.bd),

    swing: M('核心词',
      'v. 摇摆，挥舞；n. 秋千',
      '挥拍。羽毛球要求用前臂与手腕发力，而不是整条手臂乱挥。',
      '动作越小，球速越快，这是教练唯一强调的事。',
      'A short swing beats a wild one in badminton every single time.',
      '在羽毛球里，短促的挥拍永远胜过大幅乱挥。',
      SRC.bd),

    dexterity: M('核心词',
      'n. 灵巧，敏捷（尤指手指）',
      '手上功夫。网前搓球、勾对角，靠的就是手指的灵巧（dexterity）。',
      '球贴着网落下，对手只能望球兴叹。',
      'Net play in badminton demands dexterity far more than raw power.',
      '羽毛球网前球比拼的是灵巧，而非蛮力。',
      SRC.bd),

    swift: M('派生自 swiftly；派生词（由核心词根扩展而来）',
      'adj. 迅速的，敏捷的',
      '迅捷的。双打比赛中，前场的封网反应必须极快。',
      '网前那一拍，快得连慢镜头都要放两遍。',
      'A swift change of pace decided the Uber Cup doubles rubber.',
      '一次迅捷的节奏变化，决定了尤伯杯那场双打。',
      SRC.bd),

    pace: M('核心词',
      'n. 步伐，速度；v. 踱步',
      '节奏与球速。控制 pace 是羽毛球单打的核心战术。',
      '他先放慢，再突然加速，对手的重心就散了。',
      'Whoever controls the pace of a Thomas Cup singles match usually wins it.',
      '汤姆斯杯的单打比赛里，能控制节奏的一方通常能拿下这一分。',
      SRC.bd),

    rhythm: M('核心词',
      'n. 节奏，韵律',
      '节奏。羽毛球选手的状态，常被形容为「找到节奏」（find the rhythm）。',
      '连续三个回合压同一落点，他终于跟上了节奏。',
      'Once she found her rhythm, the Uber Cup semi-final turned around.',
      '她一旦找到节奏，尤伯杯半决赛的局势就逆转了。',
      SRC.bd),

    kinetic: M('核心词',
      'adj. 运动的，动力的',
      '运动的。羽毛球的每一次击球，都是动能（kinetic energy）的传递。',
      '从脚跟到指尖，力量像一条鞭子甩出去。',
      'A badminton smash is pure kinetic energy channelled through the wrist.',
      '羽毛球的扣杀，就是通过手腕释放的纯粹动能。',
      SRC.bd),

    accuracy: M('派生自 accurate（adj. 准确的）；派生词（由核心词根扩展而来）',
      'n. 准确性，精确度',
      '精准度。顶级选手能把球反复打到边线内十厘米的位置。',
      '边线、网带、底线，他的球总擦着边过。',
      'The Thomas Cup winner was decided by accuracy, not by power.',
      '那届汤姆斯杯的胜负，是由精准度而非力量决定的。',
      SRC.bd),

    accurate: M('核心词',
      'adj. 准确的，精确的',
      '精准的。落点控制的准确度，是拉开水平差距的关键。',
      '他连续五次把球吊在同一个落点上，精准得让对手连半步都没敢动。',
      'An accurate drop shot in badminton can be harder to reach than a smash.',
      '在羽毛球里，一记精准的吊球有时比扣杀更难救。',
      SRC.bd),

    consistent: M('核心词',
      'adj. 一致的，始终如一的；稳定的',
      '稳定的。连续多拍不失误，被称为发挥稳定（consistent）。',
      '两个小时的比赛里，他几乎没送出一分失误。',
      'The most consistent player at the Uber Cup usually lifts the trophy.',
      '尤伯杯上发挥最稳定的选手，通常最后能捧起奖杯。',
      SRC.bd),

    consistency: M('派生自 consistent（adj. 一致的）；con- 共同，加强；-ency 性质/状态（名词后缀）',
      'n. 一致性，连贯性；稳定性',
      '稳定性。多拍相持中，先失稳的一方往往先失分。',
      '第四十分钟，两人都在比谁先失误。',
      'Consistency, not one spectacular shot, wins a Thomas Cup tie.',
      '赢下汤姆斯杯一场比赛的，是稳定性，而不是某一记惊艳的球。',
      SRC.bd),

    posture: M('核心词',
      'n. 姿势，态度',
      '姿势。准备接球的站姿（posture）决定启动速度。',
      '膝盖微屈，重心压低，球拍举在胸前。',
      'A low posture at the net is what separates good badminton players from great ones.',
      '网前压低重心，是优秀羽毛球选手与顶尖选手之间的分水岭。',
      SRC.bd),

    balance: M('核心词',
      'n. 平衡；余额；v. 使平衡',
      '平衡。大幅跨步救球之后，能否迅速找回重心，决定下一拍的成败。',
      '他几乎摔倒，却还是把身体拉了回来。',
      'Losing balance after a lunge costs points at every level of badminton.',
      '在羽毛球里，无论哪个级别，弓步后失去平衡都要丢分。',
      SRC.bd),

    stretch: M('核心词',
      'v. 伸展，延伸；n. 一段',
      '拉伸。羽毛球选手赛前的动态拉伸，是防止拉伤的必要环节。',
      '开赛前四十分钟，他一直在场边做拉伸。',
      'Players stretch for half an hour before a Thomas Cup tie begins.',
      '汤姆斯杯比赛开始前，球员们要拉伸半个小时。',
      SRC.bd),

    strain: M('核心词',
      'n. 压力，拉伤；v. 拉紧',
      '拉伤与负担。急停急起对踝关节与跟腱的负担极大。',
      '一次跨步救球，跟腱传来一声轻响。',
      'The Uber Cup favourite withdrew after a muscle strain in training.',
      '尤伯杯的夺冠热门因训练中肌肉拉伤退赛。',
      SRC.bd),

    entrant: M('核心词',
      'n. 参赛者，新成员',
      '参赛队伍。汤姆斯杯与尤伯杯由各会员协会派队参加，每支参赛队都是一个 entrant。',
      '名单上的名字，都是各个协会最强的五个人。',
      'Thirty-one entrants entered the Thomas Cup qualification stage last cycle.',
      '上一个周期，有三十一支队伍进入了汤姆斯杯资格赛。',
      SRC.bd),

    elimination: M('派生自 eliminate（v. 消除）；-ation 动作/状态（名词后缀）',
      'n. 消除，淘汰',
      '淘汰。汤尤杯小组赛之后进入淘汰赛阶段（elimination stage）。',
      '一场小组赛的失误，让整支队伍提前回家。',
      'One loss in the group stage can mean elimination from the Uber Cup.',
      '在小组赛输掉一场，就可能意味着从尤伯杯出局。',
      SRC.bd),

    competitor: M('派生自 compete（v. 竞争）；com- 共同，一起',
      'n. 竞争者，对手',
      '竞争对手。世界排名决定抽签位次，每个 competitor 都想避开强敌。',
      '抽签结果出来，他先看了一眼半区有谁。',
      'Every competitor at the Thomas Cup knows the draw can decide everything.',
      '汤姆斯杯的每个参赛者都清楚，抽签有时能决定一切。',
      SRC.bd),

    contest: M('核心词',
      'n. 竞赛；v. 争夺',
      '竞赛与争夺。汤尤杯的每一场团体赛都由数盘比赛组成，先赢下多数盘者胜。',
      '打到第五盘，全场站着看完了最后两分。',
      'The Uber Cup contest went to the deciding fifth match.',
      '那场尤伯杯的争夺，一直打到决定性的第五盘。',
      SRC.bd),

    hurdle: M('核心词',
      'n. 障碍，跨栏；难关',
      '难关。小组出线，是通往汤姆斯杯四强的第一道障碍。',
      '想闯进四强，他们必须先跨过那道最难逾越的关卡——卫冕冠军。',
      'Beating the defending champions was the biggest hurdle of the Thomas Cup run.',
      '击败卫冕冠军，是那届汤姆斯杯征程上最大的一道难关。',
      SRC.bd),

    triumph: M('派生自 triumphant；tri- 三',
      'n. 胜利；v. 获胜',
      '夺冠时刻。汤姆斯杯与尤伯杯的夺冠，常被媒体称为 triumph。',
      '颁奖台上，他们把奖杯举得很高。',
      'China claimed the Uber Cup title with a straight-games triumph.',
      '中国队以一局未失的战绩，赢得了尤伯杯冠军。',
      SRC.bd),

    exhaustion: M('派生自 exhaust（v. 耗尽）；-tion 动作/状态（名词后缀）',
      'n. 精疲力竭，耗尽',
      '力竭。三局大战之后，双方都接近力竭。',
      '第三局最后一球落地，他直接坐在了地板上。',
      'After three games at the Thomas Cup, exhaustion showed on both faces.',
      '汤姆斯杯三局大战过后，两人脸上都写满了力竭。',
      SRC.bd),

    intense: M('派生自 intensity（n. 强度）；派生词（由核心词根扩展而来）',
      'adj. 强烈的，紧张的，激烈的',
      '激烈的。羽毛球团体赛的对抗强度极高，一场比赛常常超过一小时。',
      '一个小时后双方还在满场飞，观众已经喊哑了。',
      'An intense Uber Cup doubles rubber can leave four players soaked in sweat.',
      '一场激烈的尤伯杯双打，能让四名球员浑身湿透。',
      SRC.bd),

    intensity: M('核心词',
      'n. 强度，烈度',
      '强度。多拍相持的对抗强度，是羽毛球体能的分水岭。',
      '每一个回合都在试探，谁的体力先见底。',
      'The intensity of a Thomas Cup tie rises with every rally.',
      '汤姆斯杯一场比赛的强度，会随着每一个多拍回合不断攀升。',
      SRC.bd),

    pursuit: M('核心词',
      'n. 追求，追赶',
      '追赶。面对落点刁钻的吊球，全力追赶（pursuit）也未必救得到。',
      '他拼尽全力扑过去，球还是落了地。',
      'In badminton, the pursuit of a drop shot often ends in a stumble.',
      '在羽毛球里，拼命追赶一记吊球，结局往往是踉跄。',
      SRC.bd),
  },
};

/* ==========================================================================
 * 领域注册表（分批追加）
 * ======================================================================= */
const DOMAINS = {
  slay_the_spire2: SLAY_THE_SPIRE_2,
  arknights: ARKNIGHTS,
  genshin_impact: GENSHIN_IMPACT,
  breaking_bad: BREAKING_BAD,
  sherlock: SHERLOCK,
  classic_movies: CLASSIC_MOVIES,
  basketball: BASKETBALL,
  badminton: BADMINTON,
};

/* ==========================================================================
 * 校验 + 写盘
 * ======================================================================= */
const WORD_RE = /[^a-zA-Z]/g;

/* --------------------------------------------------------------------------
 * 硬性质量红线（任一领域、任一词条不达标 → 整体拒绝写盘，exit(1)）
 * ----------------------------------------------------------------------- */
const STORY_MIN = 15;   // story 最少字数（按字符计，标点也算）
const STORY_MAX = 60;   // story 最多字数

/* 空泛模板话术黑名单：这些词本身不承载任何领域信息，出现即判定为灌水 */
const VAGUE_PHRASES = [
  '较为常见', '较常见', '很常见', '十分常见', '非常常见', '常见',
  '可用以', '可以用来', '可用于', '可以用作',
  '可以建立', '可建立', '建立联想', '可联想', '可以联想', '可以联系', '可联系',
  '可与游戏场景建立联想', '可结合场景', '结合场景', '可与场景', '场景建立联想',
  '与之相关', '相关词汇', '值得一提', '众所周知', '一般来说',
  '可以理解为', '简单来说',
];

function storyLength(s) {
  return String(s || '').replace(/\s+/g, '').length;
}

function validate(key, dom) {
  const problems = [];
  const words = Object.keys(dom.materials);
  if (words.length < 20) problems.push(`${key}: 词条数 ${words.length} < 20`);
  for (const [w, m] of Object.entries(dom.materials)) {
    problems.push(...checkMaterial(key, w, m));
  }
  return problems;
}

/**
 * 单条材料的红线检查（生成器与修复工具共用的唯一事实来源）。
 * @param {string} key 领域 key（仅用于错误信息）
 * @param {string} w 单词（小写）
 * @param {object} m 材料对象
 * @returns {string[]} 问题列表（空数组 = 合格）
 */
export function checkMaterial(key, w, m) {
  const problems = [];
  if (w !== w.toLowerCase()) problems.push(`${key}/${w}: 键必须小写`);
  if (/[^a-z]/.test(w)) problems.push(`${key}/${w}: 键含非字母字符`);
  for (const f of ['root', 'generalMeaning', 'domainMeaning', 'story', 'example', 'exampleZh', 'source', 'exampleSource']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) problems.push(`${key}/${w}.${f} 为空`);
  }
  if (m.imageUrl !== '') problems.push(`${key}/${w}.imageUrl 必须为空串`);
  if (typeof m.unverified !== 'boolean') problems.push(`${key}/${w}.unverified 必须是 boolean`);

  /* —— 规则 1：story 字数必须在 [15, 60] —— */
  const len = storyLength(m.story);
  if (len < STORY_MIN) problems.push(`${key}/${w}.story 仅 ${len} 字（要求 ≥ ${STORY_MIN} 字）→ ${m.story || '（空）'}`);
  if (len > STORY_MAX) problems.push(`${key}/${w}.story ${len} 字（要求 ≤ ${STORY_MAX} 字）`);

  /* —— 规则 2：story 禁用空泛模板话术 —— */
  const hit = VAGUE_PHRASES.find((v) => String(m.story).includes(v));
  if (hit) problems.push(`${key}/${w}.story 含空泛话术「${hit}」→ ${m.story}`);

  /* —— 规则 3：example 非空且必须含该单词本身（不区分大小写，容忍常规词形变化）—— */
  if (!exampleHasWord(w, m.example)) problems.push(`${key}/${w}: 例句不含该单词 → ${m.example || '（空）'}`);
  /* —— 规则 4：example 必须是**纯英文**，严禁夹杂中文 ——
   *    AI 有把领域中文术语（如「洛谷」「贪心」「密码机」）直接塞进英文句子的毛病。 */
  if (/[\u4e00-\u9fff]/.test(String(m.example || ''))) {
    problems.push(`${key}/${w}: 例句含中文 → ${m.example}`);
  }
  return problems;
}

/**
 * 例句是否包含该单词（不区分大小写；容忍 -ing/-ed/-es 等常规词形变化）。
 */
export function exampleHasWord(word, example) {
  const bare = String(word).replace(WORD_RE, '').toLowerCase();
  const exBare = String(example || '').toLowerCase().replace(WORD_RE, '');
  const stem = bare.replace(/e$/, '');
  return exBare.includes(bare) || (stem.length >= 5 && exBare.includes(stem));
}

function buildFile(dom) {
  return {
    domainId: dom.domainId,
    domainName: dom.domainName,
    domainIdInConfig: dom.domainIdInConfig,
    gameNameEn: dom.gameNameEn,
    materialsVersion: dom.materialsVersion,
    _comment: dom._comment,
    materials: dom.materials,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const all = argv.includes('--all');
  const reset = argv.includes('--reset');
  const domainArg = (argv.find((a) => a.startsWith('--domain=')) || '').split('=')[1];
  const batchArg = (argv.find((a) => a.startsWith('--batch=')) || '').split('=')[1];

  let keys;
  if (domainArg) keys = [domainArg];
  else if (batchArg) keys = Object.keys(DOMAINS).filter((k) => String(DOMAINS[k].batch) === String(batchArg));
  else if (all) keys = Object.keys(DOMAINS);
  else {
    console.log('用法：--domain=<key> | --batch=<n> | --all  [--dry] [--reset]');
    console.log('可选领域：', Object.keys(DOMAINS).join(', '));
    console.log('');
    console.log('--dry    只校验不写盘');
    console.log('--reset  忽略磁盘上已有 JSON 的额外条目（默认会合并保留，避免 AI 补充的材料被覆盖）');
    process.exit(1);
  }

  const unknown = keys.filter((k) => !DOMAINS[k]);
  if (unknown.length) {
    console.error(`未知领域：${unknown.join(', ')}`);
    process.exit(1);
  }
  if (!keys.length) {
    console.error('没有匹配到任何领域（检查 --batch 取值）');
    process.exit(1);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  /* —— 合并保留：磁盘上已有、但生成器源码里没有的条目（多为 AI 批量补充）——
   * 生成器源码中的定义优先级更高；--reset 可关闭该行为（用于彻底重建）。 */
  const merged = {};
  for (const key of keys) {
    const dom = DOMAINS[key];
    const target = path.join(OUT_DIR, dom.file || `${key}.json`);
    let extra = {};
    if (!reset && existsSync(target)) {
      try {
        const prev = JSON.parse(readFileSync(target, 'utf8'));
        const prevMats = prev.materials || {};
        for (const [w, m] of Object.entries(prevMats)) {
          if (!dom.materials[w]) extra[w] = m;
        }
      } catch (e) {
        console.error(`⚠️ 读取已有 ${path.basename(target)} 失败，本次不做合并：${e.message}`);
      }
    }
    const extraCount = Object.keys(extra).length;
    if (extraCount) console.log(`ℹ️ ${dom.domainName}：合并保留磁盘上已有的 ${extraCount} 条额外材料`);
    merged[key] = { ...dom, materials: { ...extra, ...dom.materials } };
  }

  /* —— 第一段：全量校验。任一领域不合格 → 直接 exit(1)，一个字都不写 —— */
  const report = keys.map((key) => ({ key, dom: merged[key], problems: validate(key, merged[key]) }));
  const failed = report.filter((r) => r.problems.length);
  if (failed.length) {
    let total = 0;
    for (const r of failed) {
      total += r.problems.length;
      console.error(`✘ ${r.dom.domainName}（${r.key}）校验失败 ${r.problems.length} 项：`);
      r.problems.slice(0, 10).forEach((p) => console.error('   - ' + p));
      if (r.problems.length > 10) console.error(`   … 另有 ${r.problems.length - 10} 项`);
    }
    console.error(`\n共 ${failed.length} 个领域 / ${total} 项不合格 → 拒绝写盘（未修改任何 JSON 文件）。`);
    process.exit(1);
  }

  /* —— 第二段：全部通过后才写盘 —— */
  for (const { key, dom } of report) {
    const count = Object.keys(dom.materials).length;
    const unverified = Object.values(dom.materials).filter((m) => m.unverified).length;
    const target = path.join(OUT_DIR, dom.file || `${key}.json`);
    if (dry) {
      console.log(`✔ ${dom.domainName}（${key}）— ${count} 条，待确认 ${unverified} 条 [dry-run，未写盘]`);
      continue;
    }
    writeFileSync(target, JSON.stringify(buildFile(dom), null, 2) + '\n', 'utf8');
    console.log(`✔ ${dom.domainName}（${key}）→ ${path.relative(ROOT, target)} — ${count} 条，unverified ${unverified} 条`);
  }
}

/* 允许被测试脚本 import（静态校验用），直接执行时才跑 main */
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

export { STORY_MIN, STORY_MAX, VAGUE_PHRASES, storyLength, validate, DOMAINS };
