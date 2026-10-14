/**
 * main.js —— 应用入口 + 路由守卫（登录 / 主界面）
 * ============================================================================
 * 职责：
 *   1. 初始化主题（先用默认主题渲染，避免首屏闪烁）
 *   2. **路由守卫**：读本地会话（localStorage 里的 userId）
 *        · 有 userId → 直接渲染主界面 pages/homePage.js
 *        · 无 userId → 渲染登录页 views/loginView.js
 *   3. 全局错误兜底 + 快捷键
 *
 * 路由表：
 *   session 存在 → createHomePage({ userId, username, onSignOut })
 *   session 缺失 → createLoginView({ onSuccess })   ← 成功后在主界面与登录页之间切换
 *
 * 后端：自建 Cloudflare Worker + D1（见 core/authService.js）。
 *   · 登录 / 注册 / 上报全部在 authService 内完成（唯一出现 fetch 的模块）。
 *   · homePage 只通过 props 拿 userId，**不 import authService 之外的任何网络模块**；
 *     行为上报（收藏 / 答错 / 熟词）由 homePage / quizService 调 authService.reportRecord，
 *     属于「旁路统计」——失败不影响任何本地功能。
 *
 * 本阶段**不做数据隔离**：收藏 / 错题 / 熟词仍全部走本地 localStorage，
 * 登录只是闭环（userId 落库 + 行为上报），不参与数据读写分支。
 * ============================================================================
 */

import { h, svgIcon } from './core/dom.js';
import { iconPath } from './core/icons.js';
import * as themeManager from './core/themeManager.js';
import { createHomePage } from './pages/homePage.js';
import { createLoginView } from './views/loginView.js';
import { confirmDialog } from './components/modal.js';
import { showToast } from './components/toast.js';
import dataService from './services/dataService.js';
import * as authService from './core/authService.js';

let mount = null;
let currentView = null;   // 'app' | 'login' | null
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

  // 3. 路由守卫：本地有 userId 就直接进主界面，否则去登录页
  const session = authService.loadSession();
  if (session) {
    console.info('[app] 检测到本地登录态，直接进入主界面', session.userId);
    await showApp(session);
  } else {
    showLogin();
  }

  removeSplash();
  booted = true;
}

/* ---------------------------------------------------------------------------
 * 视图
 * ------------------------------------------------------------------------ */

function removeSplash() {
  document.getElementById('boot-splash')?.remove();
  document.body.classList.add('is-ready');
}

/** 渲染登录页 */
function showLogin() {
  currentView = 'login';
  const view = createLoginView({
    onSuccess: (session) => {
      showToast(`欢迎，${session.username || session.userId}`, { type: 'ok', duration: 1800 });
      showApp(session);
    },
  });
  if (currentView !== 'login') return;
  mount.replaceChildren(view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 渲染主界面（登录成功 / 已有会话 / 退出后重新登录都走这里） */
async function showApp(session) {
  const { userId = '', username = '' } = session || {};
  currentView = 'app';
  try {
    const page = await createHomePage({
      userId,
      username,
      onSignOut: handleSignOut,
    });
    if (currentView !== 'app') return;   // 挂载期间状态被改（例如已退出）→ 放弃这次结果
    mount.replaceChildren(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    currentView = null;
    renderFatal('加载主界面失败', String(e?.message || e));
  }
}

/** 退出登录：确认 → 清本地会话 → 回登录页 */
async function handleSignOut() {
  const okToLeave = await confirmDialog({
    title: '退出登录',
    message: '退出后需要重新登录才能进入。你的收藏、错题与熟词仍保存在本机，不会被删除。',
    confirmText: '退出登录',
    danger: true,
  });
  if (!okToLeave) return;

  authService.logout();
  showLogin();
  showToast('已退出登录', { type: 'ok', duration: 1600 });
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
