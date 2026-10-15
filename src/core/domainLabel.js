/**
 * domainLabel.js —— 领域名称的书名号规则（单一事实来源）
 * ============================================================================
 * 背景：
 *   领域名称在多个位置需要以「标题」形式出现（卡片提示语、详情弹窗、
 *   顶部标题、进入提示、AI prompt……）。此前各处直接硬编码
 *   `《${domain.name}》`，导致体育项目也被套上了书名号。
 *
 * 中文排版规范：
 *   - 「作品」类（游戏 / 影视）用书名号：  原神 → 《原神》
 *   - 非作品类（体育项目、学科、活动）不加书名号： 篮球 → 篮球、羽毛球 → 羽毛球
 *
 * 判定优先级：
 *   1. domain.titleQuoted 显式声明（boolean）；
 *   2. domain.category === '体育' → 不加；
 *   3. 只有 id 的「裁剪版」领域对象 → 按 id 回查 interestsConfig 的 category；
 *   4. 兜底：按作品处理（加书名号）。
 *
 * 因此新增领域时**无需**在多个渲染点各改一遍，只要在 interestsConfig.js
 * 里声明 titleQuoted（或保证 category 正确）即可。
 * ============================================================================
 */

import { INTEREST_DOMAINS } from '../config/interestsConfig.js';

/** 体育板块的 category 名（与 interestsConfig.DOMAIN_CATEGORY.SPORTS 保持一致） */
const NON_TITLE_CATEGORY = '体育';

/**
 * 判断该领域名称是否应当使用书名号。
 * @param {object} domain 领域配置对象（可以是完整配置，也可以只有 { id, name } 的裁剪版）
 * @returns {boolean}
 */
export function isTitleQuoted(domain) {
  if (!domain) return false;
  if (typeof domain.titleQuoted === 'boolean') return domain.titleQuoted;
  const category = domain.category || INTEREST_DOMAINS[domain.id]?.category;
  return category !== NON_TITLE_CATEGORY;
}

/**
 * 把领域名称格式化为可直接嵌入文案的展示文本。
 *   domainLabel({ name: '原神' })                        → '《原神》'
 *   domainLabel({ name: '篮球', titleQuoted: false })     → '篮球'
 *   domainLabel({ id: 'badminton', name: '羽毛球' })      → '羽毛球'（按 id 回查板块）
 * @param {object} domain
 * @returns {string}
 */
export function domainLabel(domain) {
  const name = String(domain?.name || '').trim();
  if (!name) return '';
  return isTitleQuoted(domain) ? `《${name}》` : name;
}

export default domainLabel;
