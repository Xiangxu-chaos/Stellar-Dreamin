/**
 * quizService.js
 * ============================================================================
 * 做题模式服务层（模块五：选择题）
 *
 * 职责：
 *   1. 根据「题目来源」抽取题目池
 *   2. 生成选择题（英译中 / 中译英），含 1 正确 + 3 干扰项
 *   3. 干扰项优先选「同一词根」或「相近含义」的词，提高难度
 *   4. 判分并落库（答题历史 + 做题统计）
 *
 * 全部可配置（见 DEFAULT_QUIZ_OPTIONS），页面只传覆盖项。
 *
 * 架构约束：本文件不碰 localStorage、不碰词库 JSON，
 *   所有数据都经 wordBankService / domainMaterialService / dataService。
 * ============================================================================
 */

import wordBankService from './wordBankService.js';
import domainMaterialService from './domainMaterialService.js';
import dataService from './dataService.js';
import * as authService from '../core/authService.js';

/* ---------------------------------------------------------------------------
 * 可配置项
 * ------------------------------------------------------------------------ */
export const QUIZ_SOURCES = {
  ALL: 'all',           // 全部卡片（当前领域全部相关词）
  FAVORITES: 'favorites', // 收藏夹
  DOMAIN: 'domain',     // 当前领域（传入 words 时取该列表，否则退回专有术语级）
};

export const QUIZ_TYPES = {
  EN_TO_ZH: 'en2zh',    // 英译中：显示英文单词，4 个中文选项
  ZH_TO_EN: 'zh2en',    // 中译英：显示中文释义，4 个英文选项
  MIXED: 'mixed',       // 混合出题
};

export const DEFAULT_QUIZ_OPTIONS = {
  source: QUIZ_SOURCES.DOMAIN,
  type: QUIZ_TYPES.MIXED,
  count: 10,            // 每次题量
  optionCount: 4,       // 选项数量（1 正确 + N-1 干扰）
  preferSimilar: true,  // 干扰项优先同词根 / 近义
  shuffleOptions: true, // 打乱选项顺序
};

/* ---------------------------------------------------------------------------
 * 工具
 * ------------------------------------------------------------------------ */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

/* ---------------------------------------------------------------------------
 * 题目池
 * ------------------------------------------------------------------------ */

/**
 * 获取题目来源对应的词条池（均已附带 material 与 domains）
 * @param {string} source  QUIZ_SOURCES.*
 * @param {{domainId?: string, words?: Array}} ctx
 */
export async function getQuestionPool(source, ctx = {}) {
  const { domainId, words } = ctx;

  // 功能三：做题时排除「已掌握（熟词库）」单词。
  //   同一个词一旦标记熟词就不再进入题目池（含领域测验 / 收藏夹复习 / 错题复习 /
  //   分组复习——它们最终都走本函数），避免反复考已经会的词。
  const masteredKeys = new Set(await dataService.getMasteredKeys());
  const isMasteredWord = (w) => {
    const d = w.domainId || domainId || '';
    const word = w.word || '';
    if (!d || !word) return false;
    return masteredKeys.has(`${d}::${String(word).toLowerCase()}`);
  };

  if (source === QUIZ_SOURCES.FAVORITES) {
    // 收藏夹：跨领域聚合（需求：复习模式只从收藏夹取词）
    const favs = await dataService.getFavorites();
    const out = [];
    for (const f of favs) {
      const hit = await wordBankService.getWordById(`cet6:${String(f.word).toLowerCase()}`);
      // 不在词库里的收藏词同样保留，否则「收藏了却出不了题」
      const withDomain = hit
        ? { ...hit, domainId: f.domainId, favoritedAt: f.favoritedAt }
        : { id: `${f.domainId}:${String(f.word).toLowerCase()}`, word: f.word, phonetic: '', translation: '', root: '核心词', type: 'core', bank: 'cet6', domainId: f.domainId, favoritedAt: f.favoritedAt, __missingInBank: true };
      withDomain.domains = wordBankService.getDomainTags(withDomain.word);
      await domainMaterialService.attachMaterials(f.domainId, [withDomain]);
      out.push(withDomain);
    }
    await wordBankService.attachTiers(out);   // 揭晓卡片的档位标签
    return out.filter((w) => !isMasteredWord(w));
  }

  if (source === QUIZ_SOURCES.ALL) {
    const list = (words || []).map((w) => ({ ...w }));
    await domainMaterialService.attachMaterials(domainId, list);
    const tagged = wordBankService.attachDomainTags(list);
    await wordBankService.attachTiers(tagged);
    return tagged.filter((w) => !isMasteredWord(w));
  }

  // 当前领域题池。
  //   • 调用方传入了 `words`（卡片库「做题」按钮传的是**当前档位筛选后的列表**）
  //     → 就以它为准，实现「选哪档就只做哪档的词」；
  //   • 未传入时退回「专有术语级」旧行为（保留给无筛选上下文的调用方 / 测试）。
  const provided = (words || []).map((w) => ({ ...w }));
  const base = provided.length ? provided : wordBankService.getDomainExactWords(domainId);
  await domainMaterialService.attachMaterials(domainId, base);
  const domTagged = wordBankService.attachDomainTags(base);
  await wordBankService.attachTiers(domTagged);
  return domTagged.filter((w) => !isMasteredWord(w));
}

/**
 * 干扰项候选池。
 *
 * 需求：干扰项从收藏夹或其他词库中随机抽取。
 * 收藏夹通常只有几十张卡，若只从收藏夹取，容易凑不出 3 个有区分度的干扰项。
 * 因此这里做「主池 + 后备池」策略：
 *   主池 = 收藏夹（保证干扰项与考题来自同一语境，难度更高）
 *   后备池 = 全量词库（收藏夹不足时补齐，避免出不了题）
 */
async function getDistractorPool(source, ctx = {}, primaryPool = []) {
  if (source !== QUIZ_SOURCES.FAVORITES) return primaryPool;

  const need = (ctx.optionCount || 4) + 2;
  if (primaryPool.length >= need) return primaryPool;

  // 收藏夹太少 → 用全量词库补齐（只作干扰项来源，不会成为考题）
  const all = await wordBankService.getAllWords({ limit: 1500 });
  const masteredKeys = new Set(await dataService.getMasteredKeys());
  const extra = all.filter((w) => {
    if (primaryPool.some((p) => p.word.toLowerCase() === w.word.toLowerCase())) return false;
    // 同样排除熟词：熟词库单词连干扰项里也不出现
    const d = w.domainId || ctx.domainId || '';
    if (d && masteredKeys.has(`${d}::${String(w.word).toLowerCase()}`)) return false;
    return true;
  });
  const merged = [...primaryPool, ...wordBankService.attachDomainTags(extra)];
  return merged;
}

/* ---------------------------------------------------------------------------
 * 干扰项挑选
 * ------------------------------------------------------------------------ */

/**
 * 为正确词挑干扰项。
 * 优先级：
 *   1) 同词根（root 字段相同，且 root 不是「核心词」这类通用值）
 *   2) 释义相近（中文释义有共同 2 字以上片段 / 字母前缀相同）
 *   3) 同领域随机
 *   4) 全库随机兜底
 */
export function pickDistractors(correct, pool, optionCount = 4, preferSimilar = true) {
  const need = Math.max(1, optionCount - 1);
  const correctText = correct.word.toLowerCase();

  const candidates = pool.filter((w) => w.word.toLowerCase() !== correctText);
  if (!candidates.length) return [];

  if (!preferSimilar) return sample(candidates, need);

  const sameRoot = [];
  const similarGloss = [];
  const rest = [];

  const correctRoot = String(correct.root || '').trim();
  const correctGloss = String(correct.translation || '').replace(/^[a-z]+\.\s*/i, '');

  for (const w of candidates) {
    const root = String(w.root || '').trim();
    const gloss = String(w.translation || '').replace(/^[a-z]+\.\s*/i, '');

    if (correctRoot && correctRoot !== '核心词' && root === correctRoot) {
      sameRoot.push(w);
      continue;
    }
    // 中文释义有共同连续 2 字片段 → 视为近义
    if (correctGloss && gloss && hasCommonGlossFragment(correctGloss, gloss)) {
      similarGloss.push(w);
      continue;
    }
    // 英文拼写前缀接近（同前缀 4 字母）
    if (w.word.length > 4 && correct.word.length > 4
      && w.word.toLowerCase().slice(0, 4) === correct.word.toLowerCase().slice(0, 4)) {
      similarGloss.push(w);
      continue;
    }
    rest.push(w);
  }

  const picked = [];
  const takeFrom = (arr) => {
    for (const w of shuffle(arr)) {
      if (picked.length >= need) return;
      if (picked.some((p) => p.word === w.word)) continue;
      if (sameZhAs(correct, w, picked)) continue;
      picked.push(w);
    }
  };

  takeFrom(sameRoot);
  takeFrom(similarGloss);
  takeFrom(rest);

  return picked.slice(0, need);
}

/** 中文释义是否有 2 字以上的公共连续片段 */
function hasCommonGlossFragment(a, b) {
  const s1 = String(a).replace(/\s/g, '');
  const s2 = String(b).replace(/\s/g, '');
  if (s1.length < 2 || s2.length < 2) return false;
  for (let i = 0; i < s1.length - 1; i += 1) {
    const frag = s1.slice(i, i + 2);
    if (s2.includes(frag)) return true;
  }
  return false;
}

/** 避免干扰项的正确释义与已有选项重复（否则出现两个正确答案） */
function sameZhAs(correct, candidate, picked) {
  const norm = (s) => String(s || '').replace(/^[a-z]+\.\s*/i, '').trim();
  const c = norm(correct.translation);
  const cand = norm(candidate.translation);
  if (c && c === cand) return true;
  return picked.some((p) => norm(p.translation) === cand);
}

/* ---------------------------------------------------------------------------
 * 出题
 * ------------------------------------------------------------------------ */

/**
 * 构建一份试卷
 * @param {object} options  { source, type, count, optionCount, preferSimilar, shuffleOptions }
 * @param {object} ctx      { domainId, words }
 * @returns {Promise<Array<QuizQuestion>>}
 *
 * QuizQuestion = {
 *   id, type: 'en2zh'|'zh2en',
 *   word, phonetic, translation,
 *   prompt,                 // 题干文字
 *   promptHint,             // 题干辅助说明
 *   options: [{ text, correct, word }],
 *   material, domains, domainId, relevance
 * }
 */
export async function buildQuiz(options = {}, ctx = {}) {
  const opt = { ...DEFAULT_QUIZ_OPTIONS, ...options };
  const pool = await getQuestionPool(opt.source, ctx);

  // 去重（同词只出一题）
  const seen = new Set();
  const unique = pool.filter((w) => {
    const k = w.word.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length < 2) return [];

  const picked = sample(unique, Math.min(opt.count, unique.length));

  // 干扰项池：收藏夹模式下不足会用全量词库补齐
  let distractorPool = await getDistractorPool(
    opt.source,
    { ...ctx, optionCount: opt.optionCount },
    unique,
  );
  if (distractorPool.length < opt.optionCount + 2 && ctx.domainId) {
    // 兜底：用当前领域全部相关词补充
    const wider = wordBankService.filterByDomainSync(ctx.domainId);
    if (wider.length > distractorPool.length) distractorPool = wider;
  }

  const questions = [];
  for (const w of picked) {
    const type = opt.type === QUIZ_TYPES.MIXED
      ? (Math.random() < 0.5 ? QUIZ_TYPES.EN_TO_ZH : QUIZ_TYPES.ZH_TO_EN)
      : opt.type;

    // 中译英需要中文释义，缺失则跳过（不出无解题）
    if (type === QUIZ_TYPES.ZH_TO_EN && !String(w.translation || '').trim()) continue;

    const distractors = pickDistractors(w, distractorPool, opt.optionCount, opt.preferSimilar);
    if (distractors.length < opt.optionCount - 1) continue;   // 凑不齐选项则跳过

    const correctText = type === QUIZ_TYPES.EN_TO_ZH
      ? buildZhOptionText(w)
      : w.word;

    const options = [
      { text: correctText, correct: true, word: w.word },
      ...distractors.map((d) => ({
        text: type === QUIZ_TYPES.EN_TO_ZH ? buildZhOptionText(d) : d.word,
        correct: false,
        word: d.word,
      })),
    ];

    const finalOptions = opt.shuffleOptions ? shuffle(options) : options;

    questions.push({
      id: `${w.word.toLowerCase()}::${type}::${Math.random().toString(36).slice(2, 7)}`,
      type,
      word: w.word,
      phonetic: w.phonetic || '',
      translation: w.translation || '',
      prompt: type === QUIZ_TYPES.EN_TO_ZH ? w.word : buildZhOptionText(w),
      promptHint: type === QUIZ_TYPES.EN_TO_ZH ? '选出正确的中文释义' : '选出正确的英文单词',
      options: finalOptions,
      material: w.material || null,
      domains: w.domains || [],
      domainId: w.domainId || ctx.domainId || '',
      relevance: w.relevance || null,
      wordInfo: w,
    });
  }

  return questions;
}

/** 中文选项文本：截取释义前 3 个义项，控制选项长度一致 */
function buildZhOptionText(w) {
  const t = String(w.translation || '').trim();
  if (!t) return '—';
  // 保留词性前缀，但最多取 3 个义项
  const m = t.match(/^([a-z]+\.)\s*(.*)$/i);
  if (!m) {
    const parts = t.split(/[；;]/).slice(0, 3);
    return parts.join('；');
  }
  const parts = m[2].split(/[；;，,]/).slice(0, 3).map((s) => s.trim()).filter(Boolean);
  return `${m[1]} ${parts.join('，')}`;
}

/* ---------------------------------------------------------------------------
 * 判分与落库
 * ------------------------------------------------------------------------ */

/**
 * 提交一道题的答案
 * @param {object} question
 * @param {string} optionText 用户点选的选项文本
 * @returns {Promise<{correct:boolean, expected:string}>}
 */
export async function submitQuizAnswer(question, optionText) {
  const correctOption = question.options.find((o) => o.correct);
  const correct = Boolean(correctOption && correctOption.text === optionText);
  const domainId = question.domainId || 'unknown';

  // 明细历史（复用复习模式的 history 结构，便于统一统计）
  await dataService.appendHistory(domainId, {
    word: question.word,
    answer: optionText,
    expected: correctOption?.text || '',
    correct,
    method: 'choice',
    note: question.type === QUIZ_TYPES.EN_TO_ZH ? '英译中' : '中译英',
  });

  // 聚合统计
  await dataService.recordQuizResult(domainId, question.word, correct);

  // 功能四：错题本与错误统计 —— 每次作答（对/错）都记录，
  // 答错自动进入错题本，连续答对 3 次自动移出。
  await dataService.recordAnswer(domainId, question.word, correct);

  /* 行为上报（旁路统计）：答错一次上报一次。
   * 放在这里是因为**所有**做题入口（收藏夹复习 / 错题复习 / 分组复习 / 领域测验）
   * 都会经过 submitQuizAnswer —— 单点触发可以保证「一次作答只上报一次」，
   * 也不会因为将来新增入口而漏报。
   * fire-and-forget：reportRecord 永不抛错，后端不可用时不影响答题。 */
  if (!correct) {
    authService.reportRecord({
      type: authService.RECORD_TYPES.WRONG,
      word: question.word,
      domainId,
    });
  }

  return { correct, expected: correctOption?.text || '' };
}

/**
 * 汇总一次试卷的作答结果
 */
export function summarizeQuiz(answers) {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  return {
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? correct / total : 0,
  };
}

/* ---------------------------------------------------------------------------
 * 答题记录查询（需求：收藏夹里可以查看每个词的答题记录）
 * ------------------------------------------------------------------------ */

/**
 * 取某个词的答题记录（跨领域聚合，或指定领域）
 * @param {string} word
 * @param {{domainId?: string, limit?: number}} [opts]
 * @returns {Promise<{total:number, correct:number, wrong:number, accuracy:number,
 *                    lastAt:number, records:Array<{correct:boolean, at:number, method:string, note:string, answer:string}>}>}
 */
export async function getWordHistory(word, opts = {}) {
  const target = String(word || '').toLowerCase();
  const out = { total: 0, correct: 0, wrong: 0, accuracy: 0, lastAt: 0, records: [] };
  if (!target) return out;

  const domains = opts.domainId
    ? [opts.domainId]
    : wordBankService.getDomains().map((d) => d.id);

  for (const dId of domains) {
    const list = await dataService.getHistory(dId);
    for (const r of list) {
      if (String(r.word || '').toLowerCase() !== target) continue;
      out.total += 1;
      if (r.correct) out.correct += 1;
      out.lastAt = Math.max(out.lastAt, r.at || 0);
      out.records.push({
        correct: Boolean(r.correct),
        at: r.at || 0,
        method: r.method || 'input',
        note: r.note || '',
        answer: r.answer || '',
        expected: r.expected || '',
        domainId: dId,
      });
    }
  }

  out.wrong = out.total - out.correct;
  out.accuracy = out.total ? out.correct / out.total : 0;
  out.records.sort((a, b) => b.at - a.at);
  if (opts.limit) out.records = out.records.slice(0, opts.limit);
  return out;
}

/**
 * 批量取答题记录摘要（收藏夹列表用，避免逐个查询）
 * @param {Array<{word:string, domainId:string}>} items
 * @returns {Promise<Map<string, {total:number, correct:number, accuracy:number, lastAt:number}>>}
 *          key = `${domainId}::${word.toLowerCase()}`
 */
export async function getHistorySummaryMap(items) {
  const map = new Map();
  if (!items || !items.length) return map;

  // 按领域分组，每个领域只读一次 history
  const byDomain = new Map();
  for (const it of items) {
    const d = it.domainId || '';
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(String(it.word || '').toLowerCase());
  }

  for (const [dId, words] of byDomain) {
    if (!dId) continue;
    const want = new Set(words);
    const list = await dataService.getHistory(dId);
    for (const r of list) {
      const k = String(r.word || '').toLowerCase();
      if (!want.has(k)) continue;
      const key = `${dId}::${k}`;
      const cur = map.get(key) || { total: 0, correct: 0, accuracy: 0, lastAt: 0 };
      cur.total += 1;
      if (r.correct) cur.correct += 1;
      cur.lastAt = Math.max(cur.lastAt, r.at || 0);
      cur.accuracy = cur.total ? cur.correct / cur.total : 0;
      map.set(key, cur);
    }
  }
  return map;
}

export default {
  QUIZ_SOURCES,
  QUIZ_TYPES,
  DEFAULT_QUIZ_OPTIONS,
  getQuestionPool,
  pickDistractors,
  buildQuiz,
  submitQuizAnswer,
  summarizeQuiz,
  getWordHistory,
  getHistorySummaryMap,
};
