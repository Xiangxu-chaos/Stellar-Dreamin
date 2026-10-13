/**
 * aiService.js
 * ============================================================================
 * AI 调用服务层（模块二：AI 调用走后端中转的预留点）
 *
 * 当前实现：前端直连 OpenAI 兼容接口（默认 DeepSeek），API Key 由用户在设置页
 *           自行填写并保存在本地。
 *
 * 最终版演进路径（只改本文件）：
 *   把 chatCompletion() 的内部实现从「直连 provider」改为「请求自己的后端」：
 *     POST /api/ai/chat  { messages, model }
 *   API Key 转移至服务端环境变量，前端不再持有任何密钥。
 *   所有上层的 prompt 组装、结果解析、缓存逻辑都不需要改动。
 *
 * 对外接口：
 *   - isConfigured()
 *   - generateMaterial(wordInfo, domainId)   生成五段式记忆材料
 *   - rankBySemanticRelevance(words, domainId) AI 语义关联度排序（第二层筛选）
 *   - chatCompletion(messages, opts)         通用底层调用
 *   - testConnection()                       设置页「测试连接」
 * ============================================================================
 */

import dataService from './dataService.js';
import { INTEREST_DOMAINS } from '../config/interestsConfig.js';

/* ---------------------------------------------------------------------------
 * 底层：OpenAI 兼容 chat/completions
 * 最终版：改为 fetch('/api/ai/chat', ...)，其余不变。
 * ------------------------------------------------------------------------ */
export async function chatCompletion(messages, options = {}) {
  const settings = await dataService.getSettings();
  const { apiKey, baseUrl, model, temperature } = settings;

  if (!apiKey) {
    throw new Error('尚未配置 API Key，请前往「设置」页填写。');
  }

  const endpoint = `${String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model: options.model || model || 'deepseek-chat',
    messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : (temperature ?? 0.7),
    stream: false,
  };
  if (options.responseFormat) body.response_format = options.responseFormat;
  if (options.maxTokens) body.max_tokens = options.maxTokens;

  // ---- 最终版替换点 ----------------------------------------------------
  // return request('/api/ai/chat', { method: 'POST', body: JSON.stringify(body) });
  // ---------------------------------------------------------------------
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch (e) {
      detail = await res.text().catch(() => '');
    }
    if (res.status === 401) throw new Error('API Key 无效或已过期（401）。请检查设置页。');
    if (res.status === 402) throw new Error('账户余额不足（402）。请前往服务商充值。');
    if (res.status === 429) throw new Error('请求过于频繁（429），请稍后重试。');
    throw new Error(`AI 请求失败（${res.status}）：${detail || '未知错误'}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回内容为空。');
  return { content, usage: json.usage, raw: json };
}

/* ---------------------------------------------------------------------------
 * 配置状态
 * ------------------------------------------------------------------------ */
export async function isConfigured() {
  const s = await dataService.getSettings();
  return Boolean(s.apiKey && s.baseUrl && s.model);
}

export async function testConnection() {
  const { content } = await chatCompletion(
    [{ role: 'user', content: '回复两个字：可用' }],
    { temperature: 0, maxTokens: 16 },
  );
  return content.trim();
}

/* ---------------------------------------------------------------------------
 * JSON 解析容错：模型有时会包 markdown 代码块或加前后缀说明
 * ------------------------------------------------------------------------ */
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 去掉 ```json ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // 常见问题：尾随逗号、单引号
    try {
      const fixed = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/'/g, '"');
      return JSON.parse(fixed);
    } catch (e2) {
      return null;
    }
  }
}

/* ---------------------------------------------------------------------------
 * 记忆材料生成
 *
 * 五段式结构与官方译名要求由 interestsConfig 中的 generationPrompt 定义，
 * 各领域可独立配置（可被用户在设置页全局覆盖）。
 * ------------------------------------------------------------------------ */
export async function generateMaterial(wordInfo, domainId, options = {}) {
  const domain = INTEREST_DOMAINS[domainId];
  if (!domain) throw new Error(`未找到兴趣领域配置：${domainId}`);

  const settings = await dataService.getSettings();
  const systemPrompt = settings.customPromptOverride?.trim()
    ? settings.customPromptOverride.trim()
    : domain.generationPrompt;

  const userPrompt = [
    `单词：${wordInfo.word}`,
    wordInfo.phonetic ? `音标：${wordInfo.phonetic}` : '',
    wordInfo.translation ? `通用释义参考：${wordInfo.translation}` : '',
    wordInfo.root ? `词根标注参考：${wordInfo.root}` : '',
    `兴趣领域：${domain.name}（${domain.subtitle}）`,
    '',
    '请严格按照 system 中约定的 JSON 格式输出，只输出 JSON。',
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const { content, usage } = await chatCompletion(messages, {
    temperature: options.temperature ?? 0.75,
    maxTokens: options.maxTokens ?? 900,
  });

  const parsed = extractJson(content);
  const norm = normalizeMaterial(parsed, content, wordInfo, domain);

  // 写回缓存（页面不直接碰 dataService，由 service 层负责）
  await dataService.saveCard(domainId, wordInfo.word, norm);
  return { material: norm, usage };
}

/** 把模型输出规范化为固定结构，缺字段时降级而非崩溃 */
function normalizeMaterial(parsed, rawText, wordInfo, domain) {
  const fallback = {
    rootNote: wordInfo.root || '核心词',
    generalMeaning: wordInfo.translation || '（未获取到释义）',
    domainMeaning: '无直接对应',
    story: '',
    example: '',
    exampleZh: '',
    isDomainTerm: false,
    domainTermZh: '',
  };
  if (!parsed) {
    return {
      ...fallback,
      generalMeaning: fallback.generalMeaning,
      story: '（AI 返回格式异常，已保留原始文本）',
      rawText,
      __parseFailed: true,
    };
  }
  return {
    rootNote: parsed.rootNote || fallback.rootNote,
    generalMeaning: parsed.generalMeaning || fallback.generalMeaning,
    domainMeaning: parsed.domainMeaning || fallback.domainMeaning,
    story: parsed.story || '',
    example: parsed.example || '',
    exampleZh: parsed.exampleZh || '',
    isDomainTerm: Boolean(parsed.isDomainTerm),
    domainTermZh: parsed.domainTermZh || '',
    __parseFailed: false,
  };
}

/** 批量生成（串行 + 节流，避免触发限流）。页面通过它做「一键生成」。 */
export async function generateMaterialBatch(words, domainId, options = {}) {
  const results = [];
  const onProgress = options.onProgress || (() => {});
  const delayMs = options.delayMs ?? 350;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    try {
      const { material } = await generateMaterial(w, domainId, options);
      results.push({ word: w.word, ok: true, material });
    } catch (e) {
      results.push({ word: w.word, ok: false, error: e.message });
      // 认证类错误直接中断，避免无意义的重试
      if (/API Key|余额|401|402/.test(e.message)) {
        onProgress({ index: i + 1, total: words.length, word: w.word, error: e.message });
        break;
      }
    }
    onProgress({ index: i + 1, total: words.length, word: w.word });
    if (i < words.length - 1 && delayMs) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

/* ---------------------------------------------------------------------------
 * 第二层筛选：AI 语义关联度判断与排序
 *
 * 输入为本地关键词筛选出的候选词，输出带 0-100 关联强度的排序结果。
 * 最终版可换成后端 embedding 相似度计算。
 * ------------------------------------------------------------------------ */
export async function rankBySemanticRelevance(words, domainId, options = {}) {
  const domain = INTEREST_DOMAINS[domainId];
  if (!domain) throw new Error(`未找到兴趣领域配置：${domainId}`);
  const list = (words || []).slice(0, options.maxWords ?? 60);
  if (!list.length) return [];

  const wordLines = list.map((w, i) => `${i + 1}. ${w.word} — ${w.translation || ''}`).join('\n');

  const systemPrompt = [
    `你是《${domain.name}》的资深玩家兼英语词汇专家。`,
    '你的任务是判断每个英语单词与该游戏的关联强度，用于筛选「用游戏语境记忆单词」的学习素材。',
    '',
    '判定标准：',
    '- 90-100：该单词在游戏中是明确的专有术语或核心机制名（如格挡、遗物、骨钉）。',
    '- 70-89：该单词高度贴合游戏的核心玩法/氛围，能自然造句（如攻击、防御、诅咒、氛围类形容词）。',
    '- 40-69：与游戏有可建立的联想，但不是核心词汇。',
    '- 1-39：关联很弱，勉强可用。',
    '- 0：完全无关，不要返回。',
    '',
    '严禁为了凑数把普通词拔高为游戏术语。',
    '',
    '只输出 JSON，格式：',
    '{"results":[{"word":"单词","score":85,"reason":"不超过20字的理由","isTerm":false}]}',
  ].join('\n');

  const userPrompt = `兴趣领域：《${domain.name}》（${domain.subtitle}）\n\n候选单词：\n${wordLines}\n\n请为每个单词给出关联强度评分，按分数从高到低返回。`;

  const { content } = await chatCompletion(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    { temperature: 0.2, maxTokens: 2000 },
  );

  const parsed = extractJson(content);
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const scoreMap = new Map();
  for (const r of results) {
    if (!r || !r.word) continue;
    scoreMap.set(String(r.word).toLowerCase(), {
      score: Math.max(0, Math.min(100, Number(r.score) || 0)),
      reason: r.reason || '',
      isTerm: Boolean(r.isTerm),
    });
  }

  return list
    .map((w) => {
      const hit = scoreMap.get(w.word.toLowerCase());
      return {
        ...w,
        semantic: hit || { score: 0, reason: 'AI 未返回该项', isTerm: false },
        relevance: {
          ...(w.relevance || {}),
          // 融合本地分与 AI 分：AI 分权重更高，但保留本地命中作为兜底
          score: hit ? Math.round(hit.score * 0.75 + (w.relevance?.score || 0) * 0.25) : (w.relevance?.score || 0),
          aiScore: hit?.score ?? null,
          aiReason: hit?.reason || '',
        },
      };
    })
    .filter((w) => w.semantic.score > 0)
    .sort((a, b) => b.relevance.score - a.relevance.score);
}

/* ---------------------------------------------------------------------------
 * 复习模式：判断用户输入的中文意思是否与词条匹配
 * 采用「本地模糊匹配 + 可选 AI 兜底」两级策略：
 *   本地命中 → 立即判定，零延迟零成本
 *   本地未命中但用户开启了 AI 判分 → 交给模型判断同义/近义表述
 * ------------------------------------------------------------------------ */
export async function judgeAnswer(wordInfo, userInput, options = {}) {
  const input = String(userInput || '').trim();
  if (!input) return { correct: false, method: 'empty', note: '未作答' };

  const expected = String(wordInfo.translation || '');
  if (localMatch(expected, input)) {
    return { correct: true, method: 'local', note: '命中释义关键词' };
  }

  if (options.useAI === false) {
    return { correct: false, method: 'local', note: '未命中释义关键词' };
  }

  try {
    const { content } = await chatCompletion([
      {
        role: 'system',
        content: [
          '你是英语老师，负责判断学生给出的中文释义是否正确。',
          '只要意思相近或抓住了主要义项就算正确，措辞不同也判正确；',
          '如果学生答的意思与标准释义明显无关，判错误。',
          '只输出 JSON：{"correct":true或false,"note":"不超过15字的简短点评"}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `单词：${wordInfo.word}\n标准释义：${expected}\n学生答案：${input}`,
      },
    ], { temperature: 0, maxTokens: 120 });
    const parsed = extractJson(content);
    if (parsed && typeof parsed.correct === 'boolean') {
      return { correct: parsed.correct, method: 'ai', note: parsed.note || '' };
    }
  } catch (e) {
    // AI 不可用时不阻塞答题流程
    return { correct: false, method: 'local', note: 'AI 判分不可用，已按关键词比对' };
  }
  return { correct: false, method: 'local', note: '未命中释义关键词' };
}

/* ---------------------------------------------------------------------------
 * 本地释义模糊匹配
 * 规则：切分中文释义为若干义项，只要用户输入包含任一义项的核心词组即算正确。
 * ------------------------------------------------------------------------ */
function localMatch(expected, input) {
  const norm = (s) => String(s || '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[a-zA-Z.．、,，;；:：/\\|"'“”‘’\s\-—–]/g, '')
    .trim();

  const exp = norm(expected);
  const inp = norm(input);
  if (!exp || !inp) return false;

  // 完整包含
  if (exp.includes(inp) || inp.includes(exp)) return true;

  // 义项切分后逐项比对
  const parts = String(expected)
    .split(/[；;，,、/]/)
    .map(norm)
    .filter((p) => p.length >= 2);

  for (const p of parts) {
    if (inp.includes(p) || p.includes(inp)) return true;
    // 长词组的子串匹配（如「抛弃」对「抛弃，放弃」）
    if (p.length >= 2 && inp.length >= 2) {
      for (let len = Math.min(p.length, inp.length); len >= 2; len -= 1) {
        for (let i = 0; i + len <= p.length; i += 1) {
          const seg = p.slice(i, i + len);
          if (seg.length >= 2 && inp.includes(seg)) return true;
        }
      }
    }
  }
  return false;
}

export default {
  chatCompletion,
  isConfigured,
  testConnection,
  generateMaterial,
  generateMaterialBatch,
  rankBySemanticRelevance,
  judgeAnswer,
};
