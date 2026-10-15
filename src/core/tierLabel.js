/**
 * tierLabel.js —— 档位（核心 / 相关 / 泛化）的统一判定与文案
 * ============================================================================
 * 档位由 wordBankService 按**召回分数排名**动态计算（前 20% / 20–50% / 50–100%），
 * 挂在词条对象的 `tier` 字段上。本模块只负责「怎么显示」，是唯一的判定入口：
 *   - tierOf(word)  ：取词条档位，缺失 / 非法一律兜底为「相关」
 *   - tierLabel(t)  ：中文名（核心 / 相关 / 泛化）
 *   - tierClass(t)  ：卡片标签的 CSS 类名
 *
 * ⚠️ 不要在组件里硬编码 '核心' / 'core' 之类的字面量 —— 统一走这里，
 *    否则以后调档位比例或改文案会漏改（同 domainLabel.js 的处理方式）。
 * ============================================================================
 */

/** 合法档位 */
export const TIERS = ['core', 'related', 'extended'];
/** 缺省档位（词条没有 tier 字段时的兜底） */
export const DEFAULT_TIER = 'related';

const LABELS = { core: '核心', related: '相关', extended: '泛化' };

/** 取词条档位（非法 / 缺失 → 'related'） */
export function tierOf(word) {
  const t = word && typeof word === 'object' ? word.tier : word;
  return TIERS.includes(t) ? t : DEFAULT_TIER;
}

/** 档位中文名 */
export function tierLabel(tier) {
  return LABELS[tierOf(tier)] || LABELS[DEFAULT_TIER];
}

/** 卡片标签的 CSS 类名 */
export function tierClass(tier) {
  return `chip--tier-${tierOf(tier)}`;
}

export default { TIERS, DEFAULT_TIER, tierOf, tierLabel, tierClass };
