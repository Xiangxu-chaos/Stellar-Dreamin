#!/usr/bin/env node
/**
 * genScenarioVocabulary.mjs —— 生成「场景泛化词层」配置文件
 * ============================================================================
 * 背景：
 *   此前每个领域的召回集合 = 该领域 domainTerms + domainVocabulary 能命中的
 *   六级词。这导致「专有术语少」的领域召回上限很低（如日漫只有 60 个词）。
 *
 * 本脚本做的事：
 *   把一份**跨领域通用**的「场景泛化词」清单（情感 / 行为 / 评价 / 叙事概念 /
 *   冲突与合作 / 时空数量）过滤出**确实存在于 cet6Core.json 的词**，
 *   生成 src/config/scenarioVocabulary.js。
 *   该层由 interestsConfig.buildDomainIndex() 合并进**每一个**领域，
 *   于是 buildRelatedWords() 不再只依赖专有术语，召回上限被整体抬高。
 *
 * 用法：node tools/genScenarioVocabulary.mjs
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 候选池：与任何「叙事型领域」都能成立具体场景的通用概念词 */
const CANDIDATES = `joy sorrow grief anger rage fury fear dread panic terror anxiety tension relief comfort pleasure delight bliss despair melancholy nostalgia longing yearning craving desire passion affection hatred disgust contempt scorn jealousy envy gratitude sympathy empathy compassion mercy pity guilt shame remorse regret pride arrogance humility dignity courage bravery cowardice confidence doubt suspicion trust loyalty betrayal honesty deceit hypocrisy sincerity generosity greed selfishness vanity patience tolerance forgiveness resentment hostility aggression
struggle strive pursue chase escape flee hide lurk ambush attack defend retreat advance charge strike clash collide resist surrender endure persist persevere overcome prevail triumph conquer defeat sacrifice dedicate devote commit deceive manipulate conspire scheme negotiate bargain compromise reconcile mediate cooperate collaborate compete challenge confront provoke threaten intimidate persuade convince inspire motivate encourage discourage comfort reassure
destiny fate fortune misfortune coincidence miracle disaster catastrophe crisis dilemma paradox irony mystery secret revelation discovery truth illusion delusion reality fantasy imagination memory tradition heritage innovation revolution evolution transformation journey quest adventure expedition ordeal trial milestone achievement accomplishment glory fame reputation legacy downfall decline collapse ruin revival rebirth redemption salvation
crucial vital essential trivial magnificent splendid exquisite elegant graceful sublime gloomy bleak vivid subtle profound superficial absurd bizarre grotesque sinister ominous hostile amiable generous loyal treacherous
interval duration temporary permanent eternal instant gradual abrupt frequent rare abundant scarce sufficient excessive moderate immense vast enormous
ambition aspiration inspiration influence genius wisdom talent skill craft mastery expertise experience knowledge curiosity creativity passion devotion dedication discipline focus concentration persist resilience optimism pessimism frustration disappointment humiliation prestige tribute
conflict harmony balance chaos order unity discord turmoil stability turbulence serenity calm prospect horizon threshold boundary frontier barrier obstacle hurdle breakthrough
sacrifice redemption courage hope despair faith doubt belief destiny mystery suspense climax revelation tragedy comedy romance satire irony symbolism metaphor narrative legend myth folklore heritage
witness evidence proof clue suspect motive alibi investigation inquiry verdict testimony confession accusation defence prosecution justice injustice punishment sentence penalty guilt innocence liberty captivity prison exile refuge sanctuary
leader captain mentor disciple rival ally opponent comrade companion fellowship alliance coalition rivalry feud truce treaty pact agreement
victory defeat triumph loss glory shame honour reputation prestige acclaim applause ovation celebration ceremony festival carnival tribute homage
strength weakness power influence authority dominance submission resistance rebellion obedience loyalty defiance courage cowardice
wisdom ignorance knowledge error mistake lesson insight foresight hindsight perspective vision
wealth poverty fortune prosperity hardship adversity comfort luxury modesty
health illness injury recovery cure remedy therapy exhaustion fatigue vigour vitality energy
whisper shout murmur silence echo glimpse stare gaze observe watch monitor detect discover explore search investigate examine analyse interpret conclude infer deduce reason logic intuition insight
gather scatter assemble disperse merge divide separate connect link bind unite sever
ascend descend rise fall climb plunge soar drift glide wander roam migrate settle dwell inhabit abandon depart arrive
create destroy build construct demolish form shape mould design invent devise innovate improvise
protect guard shield defend rescue save shelter conceal reveal expose uncover disguise camouflage
compete contend duel wrestle grapple spar exercise train practise rehearse perform execute accomplish achieve exceed surpass outdo
praise criticise blame accuse defend justify explain persuade argue debate dispute quarrel reconcile forgive apologise thank congratulate celebrate mourn grieve lament
risk gamble wager stake venture dare threaten tempt lure seduce trap ambush deceive betray
calm anxious eager reluctant willing hesitant determined stubborn persistent patient impulsive reckless cautious deliberate
liberty freedom slavery oppression tyranny justice mercy revenge vengeance honour duty virtue vice sin grace blessing curse
melody rhythm harmony chorus verse lyric poetry prose fiction drama comedy tragedy epic saga chronicle memoir biography
master apprentice novice veteran expert amateur professional specialist generalist craftsman artisan`;

const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cet6Core.json'), 'utf8'));
const WORDS = Array.isArray(BANK) ? BANK : BANK.words;
const MAP = new Map(WORDS.map((w) => [String(w.word).toLowerCase(), String(w.translation || '').trim()]));

const candidates = [...new Set(CANDIDATES.split(/\s+/).filter(Boolean))];
const picked = [];
for (const w of candidates) {
  const k = w.toLowerCase();
  if (!MAP.has(k)) continue;
  /* 中文释义取「第一个义项」，压缩到 18 字以内，避免配置臃肿 */
  const zh = MAP.get(k).replace(/\n/g, ' ').split(/[；;]/)[0].slice(0, 18);
  picked.push([k, zh || '场景关联词']);
}
picked.sort((a, b) => a[0].localeCompare(b[0]));

const lines = picked.map(([k, zh]) => `  ${JSON.stringify(k)}: ${JSON.stringify(zh)},`).join('\n');
const out = `/**
 * scenarioVocabulary.js —— 场景泛化词层（自动生成，请勿手改）
 * ============================================================================
 * 由 tools/genScenarioVocabulary.mjs 生成。
 * 作用：这些是「跨领域通用」的场景词（情感 / 行为 / 评价 / 叙事概念 / 冲突合作 /
 *       时空数量）。interestsConfig.buildDomainIndex() 会把它们并入**每一个**
 *       领域，使 buildRelatedWords() 不再只依赖专有术语，从而整体抬高召回上限。
 * 注意：
 *   1. 只收录**确实存在于 cet6Core.json** 的词（否则永远不会被召回）；
 *   2. 它们是「领域语感词」而非专有名词 → 只进 vocab，不进 exact，
 *      因此卡片不会误标「官方认证」；权重也低于领域自有词汇（排序靠后）。
 * 重新生成：node tools/genScenarioVocabulary.mjs
 * ============================================================================
 */

export const SCENARIO_VOCABULARY = {
${lines}
};

export default SCENARIO_VOCABULARY;
`;
fs.writeFileSync(path.join(ROOT, 'src/config/scenarioVocabulary.js'), out, 'utf8');
console.log(`✔ 已生成 src/config/scenarioVocabulary.js —— ${picked.length} 个词（候选 ${candidates.length}）`);
