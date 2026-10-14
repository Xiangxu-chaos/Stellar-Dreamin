/**
 * main.js —— 应用入口 + 路由守卫（登录 / 主界面）
 * ============================================================================
 * 职责：
 *   1. 初始化主题（先用默认主题渲染，避免首屏闪烁）
 *   2. **非阻塞启动**：页面一加载就保留「启动骨架屏」，随后在后台并行执行
 *        · 会话校验（读 localStorage 里的 userId，必要时向后端验证）
 *        · 词库加载（wordBankService.ensureLoaded）
 *      两者各带 3 秒硬超时。超时绝不空等 —— 会话超时按「未登录」处理并提示重试，
 *      词库超时给出可重试的错误提示。**任何情况下都不允许一直卡在 Loading 界面。**
 *   3. **路由守卫**：
 *        · 有 userId → 渲染主界面 pages/homePage.js
 *        · 无 userId → 渲染登录页 views/loginView.js
 *   4. 全局错误兜底 + 快捷键
 *
 * 路由表：
 *   session 存在 → createHomePage({ userId, username, onSignOut })
 *   session 缺失 → createLoginView({ onSuccess })   ← 成功后在主界面与登录页之间切换
 *
 * ---------------------------------------------------------------------------
 * 性能约定（本轮增量）
 *   · BOOT_TIMEOUT = 3000 —— 登录验证 / 词库加载的硬超时（毫秒）
 *   · 骨架屏由 index.html 内联渲染（0 依赖、0 网络），本文件负责在视图就绪后移除
 *   · 词库加载与路由决策**并行**，互不阻塞；词库慢不会挡住登录页/主界面的出现
 * ---------------------------------------------------------------------------
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
import wordBankService from './services/wordBankService.js';
import * as authService from './core/authService.js';

/** 启动硬超时（毫秒）：登录验证与词库加载都不允许超过这个时间 */
export const BOOT_TIMEOUT = 3000;

let mount = null;
let currentView = null;   // 'app' | 'login' | null
let booted = false;
/** 启动阶段的提示（例如「登录验证超时，请重试」），在渲染登录页后弹出一次 */
let bootNotice = '';

/* ---------------------------------------------------------------------------
 * 限时工具
 * ---------------------------------------------------------------------------
 * 把任意 Promise 包成「限时」形式：超时不 reject、不抛错，而是返回一个
 * 结构化结果 { timedOut, ok, value, error }。
 * 这样调用方永远能在 BOOT_TIMEOUT 内拿到结果并继续走流程 —— 这是
 * 「绝不卡在 Loading」的机械保证。
 * ------------------------------------------------------------------------ */
function withTimeout(promise, ms, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true, ok: false, value: fallback, error: null });
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, ok: true, value, error: null });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, ok: false, value: fallback, error });
      },
    );
  });
}

/* ---------------------------------------------------------------------------
 * 启动
 * ------------------------------------------------------------------------ */
async function bootstrap() {
  mount = document.getElementById('app');
  if (!mount) throw new Error('缺少 #app 挂载点');

  // 1. 先用默认主题铺底（此时还没读回用户的 ui 偏好）
  themeManager.applyTheme(null, { animate: false });
  themeManager.setColorScheme('dark');

  // 2. 骨架屏已经由 index.html 内联渲染（页面一解析完就可见）。
  //    这里只确保它处于「可见」状态 —— 首屏绝不空白。
  showSkeleton();

  // 3. 后台并行启动词库加载：**不阻塞** 路由决策，稍后按需消费结果。
  const bankTask = withTimeout(wordBankService.ensureLoaded(), BOOT_TIMEOUT, 'timeout');

  // 4. 主题强度偏好异步补上（失败不影响启动）
  dataService.getUI()
    .then((ui) => {
      if (ui && typeof ui.themeIntensity === 'number') themeManager.setIntensity(ui.themeIntensity);
    })
    .catch(() => { /* 首次运行无数据，忽略 */ });

  // 5. 会话校验：3 秒硬超时；超时视为「未登录」并提示重试
  const sessionResult = await withTimeout(resolveSession(), BOOT_TIMEOUT, null);
  const session = sessionResult.value;
  if (sessionResult.timedOut) {
    console.warn('[app] 登录验证超时（>3s），按未登录处理');
    bootNotice = '登录验证超时，请重试';
  }

  // 6. 依据会话决定视图
  if (session) {
    await showApp(session);
  } else {
    showLogin();
  }

  // 7. 视图已就绪 → 立刻移除骨架屏（这一步绝不等待词库）
  removeSplash();
  booted = true;

  // 8. 词库结果稍后消费：超时 / 失败 → 给可重试提示（不阻塞、不影响已渲染界面）
  bankTask.then((r) => {
    if (r.timedOut) {
      showToast('词库加载较慢', {
        desc: '已转入后台继续加载，可正常操作；若长时间无内容请点「重新载入」。',
        type: 'warn',
        duration: 3200,
      });
    } else if (!r.ok) {
      showToast('词库加载失败', {
        desc: '可点击页面上的「重新载入」按钮重试。',
        type: 'err',
        duration: 3200,
      });
    }
  });
}

/**
 * 解析本地会话（含可选的 3s 后端校验）。
 * 当前实现只读 localStorage（毫秒级）；数据层迁移后若需要向后端校验，
 * authService 只要导出 verifySession(userId) 即会被自动接入（仍在 3s 超时内）。
 * @returns {Promise<{userId:string, username:string}|null>}
 */
async function resolveSession() {
  const session = authService.loadSession();
  if (!session || !session.userId) return null;
  if (typeof authService.verifySession === 'function') {
    const valid = await authService.verifySession(session.userId);
    if (valid === false) return null;
  }
  return session;
}

/* ---------------------------------------------------------------------------
 * 视图
 * ------------------------------------------------------------------------ */

/** 确保启动骨架屏可见（index.html 已内联，缺失时也无副作用） */
function showSkeleton() {
  const splash = document.getElementById('boot-splash');
  if (splash) splash.classList.remove('is-fading');
  document.body.classList.remove('is-ready');
}

function removeSplash() {
  if (typeof window !== 'undefined' && window.__bootSplashTimer) {
    clearTimeout(window.__bootSplashTimer);
    window.__bootSplashTimer = null;
  }
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

  // 启动阶段若发生过超时（例如登录验证超时），登录页渲染后提示一次重试
  if (bootNotice) {
    showToast(bootNotice, { desc: '请重新登录。', type: 'err', duration: 3200 });
    bootNotice = '';
  }
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
  removeSplash();
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
