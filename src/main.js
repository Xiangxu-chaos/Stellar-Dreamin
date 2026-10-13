/**
 * main.js —— 应用入口
 * ============================================================================
 * 只做三件事：
 *   1. 初始化主题（先用默认主题渲染，避免首屏闪烁）
 *   2. 挂载页面
 *   3. 全局错误兜底 + 快捷键
 *
 * 不含任何业务逻辑；业务全部在 services/ 与 pages/。
 * ============================================================================
 */

import { h, svgIcon } from './core/dom.js';
import { iconPath } from './core/icons.js';
import * as themeManager from './core/themeManager.js';
import { createHomePage } from './pages/homePage.js';
import dataService from './services/dataService.js';

async function bootstrap() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('缺少 #app 挂载点');

  // 1. 先用默认主题铺底（此时还没读回用户的 ui 偏好）
  themeManager.applyTheme(null, { animate: false });
  themeManager.setColorScheme('dark');

  // 2. 尽早应用主题强度偏好，减少观感跳变
  try {
    const ui = await dataService.getUI();
    if (typeof ui.themeIntensity === 'number') themeManager.setIntensity(ui.themeIntensity);
  } catch (e) { /* 首次运行无数据，忽略 */ }

  // 3. 挂载页面
  const page = await createHomePage();
  mount.replaceChildren(page);

  // 4. 移除首屏遮罩
  document.getElementById('boot-splash')?.remove();
  document.body.classList.add('is-ready');
}

/** 全局错误兜底：把未捕获异常可视化，避免白屏无提示 */
function renderFatal(title, detail) {
  const mount = document.getElementById('app');
  if (!mount) return;
  mount.replaceChildren(
    h('div.empty', {}, [
      h('div.empty__icon', {}, [svgIcon(iconPath('alert'), { size: 28 })]),
      h('div.empty__title', { text: title }),
      h('div.empty__desc', { text: detail }),
      h('button.btn.btn--primary', {
        type: 'button',
        onClick: () => window.location.reload(),
      }, '重新载入'),
    ]),
  );
}

function installErrorBoundary() {
  window.addEventListener('error', (e) => {
    console.error('[app] error', e.error || e.message);
    renderFatal('应用出现异常', String(e.error?.message || e.message || '未知错误'));
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[app] unhandled rejection', e.reason);
    renderFatal('操作未完成', String(e.reason?.message || e.reason || '未知错误'));
  });
}

/** 全局快捷键：/ 聚焦搜索框 */
function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
    if (e.key === '/' && !typing) {
      const input = document.querySelector('.field--grow input');
      if (input) { e.preventDefault(); input.focus(); }
    }
  });
}

installErrorBoundary();
installShortcuts();

bootstrap().catch((e) => {
  console.error('[app] bootstrap 失败', e);
  document.getElementById('boot-splash')?.remove();
  renderFatal('启动失败', String(e?.message || e));
});
