/**
 * main.js —— 应用入口 + 自动登录
 * ============================================================================
 * 职责：
 *   1. 初始化主题（先用默认主题渲染，避免首屏闪烁）
 *   2. **匿名自动登录**：调用 CloudBase 的 signInAnonymously()，成功后直接渲染主界面
 *   3. 全局错误兜底 + 快捷键
 *
 * 路由表（已无登录页）：
 *   always → createHomePage（pages/homePage.js）
 *   匿名登录是一次性的前置动作，不参与路由分支。
 *
 * 为什么要「匿名登录失败也照常进主界面」：
 *   当前所有学习数据仍完全走本地（词库 JSON + localStorage），
 *   云同步是**下一步**才做的事。若因为认证服务不可达就把整个应用挡在门外，
 *   等于用「还没接入的功能」换掉了「已经能用的功能」。
 *   所以这里选择**降级而非阻断**：照常渲染主界面，同时在顶栏显示「离线」状态
 *   + 弹一次提示 + 控制台打印完整错误，保证故障是**可见**而不是静默的。
 *
 * 认证逻辑全部在 core/cloudbaseClient.js（唯一接触 CloudBase 的地方）；
 * homePage 只通过 props 接收用户信息，保持与 Node 测试环境解耦。
 * ============================================================================
 */

import { h, svgIcon } from './core/dom.js';
import { iconPath } from './core/icons.js';
import * as themeManager from './core/themeManager.js';
import { createHomePage } from './pages/homePage.js';
import { showToast } from './components/toast.js';
import dataService from './services/dataService.js';
import { ensureSignedIn, translateAuthError } from './core/cloudbaseClient.js';

let mount = null;
let currentView = null;   // 'app' | null
let booted = false;

async function bootstrap() {
  mount = document.getElementById('app');
  if (!mount) throw new Error('缺少 #app 挂载点');

  // 1. 先用默认主题铺底（此时还没读回用户的 ui 偏好）
  themeManager.applyTheme(null, { animate: false });
  themeManager.setColorScheme('dark');

  // 2. 尽早应用主题强度偏好，减少观感跳变
  try {
    const ui = await dataService.getUI();
    if (typeof ui.themeIntensity === 'number') themeManager.setIntensity(ui.themeIntensity);
  } catch (e) { /* 首次运行无数据，忽略 */ }

  // 3. 匿名自动登录（失败不阻断，见文件头说明）
  const { user, authError } = await signInAnonymously();

  // 4. 渲染主界面
  await showApp({ user, authError });

  if (authError) {
    showToast('云服务未连接，已进入离线模式', {
      desc: authError,
      type: 'err',
      duration: 7000,
    });
  }

  removeSplash();
  booted = true;
}

/* ---------------------------------------------------------------------------
 * 认证
 * ------------------------------------------------------------------------ */

/**
 * 执行匿名登录，永不抛错。
 * @returns {Promise<{user: object|null, authError: string}>} authError 为空串表示成功
 */
async function signInAnonymously() {
  try {
    const { user, isNew } = await ensureSignedIn();
    console.info(`[app] ${isNew ? '已创建匿名用户' : '复用已有登录态'}`, user?.uid || '');
    return { user: user || null, authError: '' };
  } catch (e) {
    const authError = translateAuthError(e);
    console.error('[app] 匿名登录失败：', authError, e);
    return { user: null, authError };
  }
}

/* ---------------------------------------------------------------------------
 * 视图
 * ------------------------------------------------------------------------ */

function removeSplash() {
  document.getElementById('boot-splash')?.remove();
  document.body.classList.add('is-ready');
}

async function showApp({ user = null, authError = '' } = {}) {
  currentView = 'app';
  try {
    const page = await createHomePage({ user, authError });
    if (currentView !== 'app') return;   // 挂载期间状态被改（例如重试）→ 放弃这次结果
    mount.replaceChildren(page);
  } catch (e) {
    currentView = null;
    renderFatal('加载主界面失败', String(e?.message || e));
  }
}

/* ---------------------------------------------------------------------------
 * 全局兜底
 * ------------------------------------------------------------------------ */

/** 全局错误兜底：把未捕获异常可视化，避免白屏无提示 */
function renderFatal(title, detail) {
  const el = mount || document.getElementById('app');
  if (!el) return;
  el.replaceChildren(
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
    // 首屏启动阶段失败才接管整个页面；运行中出错只记录，不把界面清掉
    if (!booted) renderFatal('应用出现异常', String(e.error?.message || e.message || '未知错误'));
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[app] unhandled rejection', e.reason);
    if (!booted) renderFatal('操作未完成', String(e.reason?.message || e.reason || '未知错误'));
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
