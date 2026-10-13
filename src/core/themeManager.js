/**
 * themeManager.js
 * ============================================================================
 * 视觉主题管理器（模块三：视觉主题可配置）
 *
 * 职责：把 interestsConfig 里某个领域的 theme token 写进 :root 的 CSS 变量。
 * 页面样式只消费 CSS 变量，因此「换领域 = 换一套变量」，
 * 新增领域无需改动任何 CSS 或组件代码。
 *
 * 最终版扩展点：
 *   - 用户自定义主题：applyTheme(customThemeObject) 支持传入任意 token 集合。
 *   - 主题强度/亮暗切换：通过 setIntensity() 调整变量透明度。
 *   - 全局亮色模式：新增一套 light token 即可，不需要动样式结构。
 * ============================================================================
 */

import { DEFAULT_THEME } from '../config/interestsConfig.js';

/** token 名 → CSS 变量名 的映射（含默认值，防止某个领域漏配导致样式塌陷） */
const TOKEN_MAP = {
  bg: '--c-bg',
  bgGradient: '--c-bg-gradient',
  surface: '--c-surface',
  surfaceStrong: '--c-surface-strong',
  border: '--c-border',
  borderStrong: '--c-border-strong',
  text: '--c-text',
  textSoft: '--c-text-soft',
  textFaint: '--c-text-faint',
  primary: '--c-primary',
  primarySoft: '--c-primary-soft',
  accent: '--c-accent',
  accentSoft: '--c-accent-soft',
  cardGradient: '--c-card-gradient',
  cardGlow: '--c-card-glow',
  cardSheen: '--c-card-sheen',
  success: '--c-success',
  danger: '--c-danger',
  fontDisplay: '--font-display',
  fontBody: '--font-body',
  radius: '--radius',
};

/** 由 primary 派生的 RGB 分量，供需要 rgba() 的场景使用 */
const RGB_TOKENS = {
  primary: '--c-primary-rgb',
  accent: '--c-accent-rgb',
  cardGlow: '--c-card-glow-rgb',
  success: '--c-success-rgb',
  danger: '--c-danger-rgb',
};

let currentThemeId = null;

/** hex → "r, g, b" */
function hexToRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) {
    return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)).join(', ');
  }
  if (h.length === 6) {
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  }
  // rgba(...) 形式：直接提取数字
  const m = String(hex).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`;
  return '128, 128, 128';
}

function resolveTokenValue(theme, key) {
  const v = theme?.[key];
  if (v === undefined || v === null || v === '') return DEFAULT_THEME[key] ?? '';
  return v;
}

/**
 * 应用主题
 * @param {object|null} theme interestsConfig 中的一个 theme 对象；传 null 恢复默认
 * @param {{animate?: boolean}} [options]
 */
export function applyTheme(theme, options = {}) {
  const t = theme || DEFAULT_THEME;
  const root = document.documentElement;
  const target = document.body;

  if (options.animate !== false && currentThemeId && currentThemeId !== t.id) {
    target?.classList.add('theme-transitioning');
    window.setTimeout(() => target?.classList.remove('theme-transitioning'), 520);
  }

  for (const [tokenKey, cssVar] of Object.entries(TOKEN_MAP)) {
    root.style.setProperty(cssVar, resolveTokenValue(t, tokenKey));
  }

  for (const [tokenKey, cssVar] of Object.entries(RGB_TOKENS)) {
    const raw = resolveTokenValue(t, tokenKey);
    root.style.setProperty(cssVar, hexToRgb(raw.startsWith('rgba') || raw.startsWith('#') ? raw : raw));
  }

  // 供 CSS 做领域特有细节（如卡牌边框纹理）的钩子
  root.setAttribute('data-theme', t.id || 'default');
  root.setAttribute('data-theme-label', t.label || '');
  currentThemeId = t.id || 'default';
  return currentThemeId;
}

export function getCurrentThemeId() {
  return currentThemeId;
}

/**
 * 全局强度调节（0.6 - 1.4）
 * 最终版供用户做「主题浓度」滑杆使用：只影响装饰层的透明度。
 */
export function setIntensity(value) {
  const v = Math.min(1.4, Math.max(0.6, Number(value) || 1));
  document.documentElement.style.setProperty('--theme-intensity', String(v));
  return v;
}

/**
 * 亮色模式（最终版预留）
 * 目前默认深色；此处保留接口，接入时提供一套 light token 即可。
 */
export function setColorScheme(scheme) {
  document.documentElement.setAttribute('data-scheme', scheme === 'light' ? 'light' : 'dark');
}

export default { applyTheme, getCurrentThemeId, setIntensity, setColorScheme, DEFAULT_THEME };
