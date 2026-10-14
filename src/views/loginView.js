/**
 * loginView.js —— 登录 / 注册页（自建后端：Cloudflare Worker + D1）
 * ============================================================================
 * 路由：由 src/main.js 决定 —— 本地没有 userId 时渲染本页，有则直接进主界面。
 *
 * 结构：
 *   品牌头 → 「登录 / 注册」双标签 → 用户名 + 密码 → 提交按钮 → 提示区
 *
 * 职责边界：
 *   ✅ 只负责收集输入与调用 core/authService.js，成功后通过 onSuccess 回调交还控制权。
 *   ❌ 不直接碰 localStorage、不直接 fetch（分层铁律）。
 *
 * 关于事件绑定（重要）：
 *   同时给 <form> 绑 submit、给提交按钮绑 click，并用 busy 标志去重。
 *   这样「浏览器里点按钮 / 按回车」与「Node 测试环境里直接触发 click」三条路径
 *   都能走通，且不会重复提交。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import * as authService from '../core/authService.js';

/** 两种模式对应的文案 */
const MODES = {
  signin: {
    heading: '欢迎回来',
    sub: '登录后即可同步你的学习进度与行为记录。',
    submit: '登录',
    submitBusy: '登录中…',
    passwordAuto: 'current-password',
    tip: '还没有账号？点上方「注册」创建一个。',
  },
  signup: {
    heading: '创建账号',
    sub: '注册即开始记录你的收藏、错题与熟词行为。',
    submit: '注册并登录',
    submitBusy: '注册中…',
    passwordAuto: 'new-password',
    tip: '已有账号？点上方「登录」直接进入。',
  },
};

/**
 * @param {object} [options]
 * @param {string} [options.initialMode] 'signin' | 'signup'
 * @param {(session: {userId: string, username: string}) => void} [options.onSuccess]
 *        登录 / 注册成功后的回调（此时会话已写入 localStorage）
 * @returns {HTMLElement}
 */
export function createLoginView(options = {}) {
  const { initialMode = 'signin', onSuccess } = options || {};

  let mode = MODES[initialMode] ? initialMode : 'signin';
  let busy = false;

  /* ---- 输入区 ---- */
  const usernameInput = h('input', {
    type: 'text',
    name: 'username',
    placeholder: '请输入用户名',
    autocomplete: 'username',
    spellcheck: 'false',
    'aria-label': '用户名',
  });

  const passwordInput = h('input', {
    type: 'password',
    name: 'password',
    placeholder: '请输入密码',
    autocomplete: MODES[mode].passwordAuto,
    'aria-label': '密码',
  });

  const eyeBtn = h('button.auth__eye', {
    type: 'button',
    title: '显示密码',
    'aria-label': '显示 / 隐藏密码',
    onClick: () => {
      const show = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', show ? 'text' : 'password');
      eyeBtn.replaceChildren(svgIcon(iconPath(show ? 'eyeOff' : 'eye'), { size: 15 }));
      eyeBtn.setAttribute('title', show ? '隐藏密码' : '显示密码');
    },
  }, [svgIcon(iconPath('eye'), { size: 15 })]);

  /* ---- 文案节点（随模式切换）---- */
  const heading = h('h2.auth__heading', { text: MODES[mode].heading });
  const sub = h('p.auth__sub', { text: MODES[mode].sub });
  const tip = h('div.auth__foot', { text: MODES[mode].tip });
  const msg = h('div.auth__msg', { role: 'status', 'aria-live': 'polite' });

  const submitBtn = h('button.btn.btn--primary.auth__submit', {
    type: 'submit',
    onClick: (e) => attempt(e),
  }, MODES[mode].submit);

  /* ---- 标签页 ---- */
  const tabSignin = h('button.auth-tab', {
    type: 'button',
    onClick: () => setMode('signin'),
  }, '登录');
  const tabSignup = h('button.auth-tab', {
    type: 'button',
    onClick: () => setMode('signup'),
  }, '注册');
  const tabs = h('div.auth__tabs', { role: 'tablist' }, [tabSignin, tabSignup]);

  /* ---- 表单 ---- */
  const form = h('form.auth__form', {
    onSubmit: (e) => attempt(e),
    novalidate: true,
  }, [
    h('label.auth__fieldset', {}, [
      h('span.auth__label', { text: '用户名' }),
      h('div.auth__field.field', {}, [
        svgIcon(iconPath('user'), { size: 15, cls: 'field__icon' }),
        usernameInput,
      ]),
    ]),
    h('label.auth__fieldset', {}, [
      h('span.auth__label', { text: '密码' }),
      h('div.auth__field.field', {}, [
        svgIcon(iconPath('key'), { size: 15, cls: 'field__icon' }),
        passwordInput,
        eyeBtn,
      ]),
    ]),
    submitBtn,
  ]);

  const card = h('div.auth__card', {}, [
    h('div.auth__brand', {}, [
      h('div.brand__mark', {}, [svgIcon(iconPath('sparkles'), { size: 20 })]),
      h('div.brand__text', {}, [
        h('div.brand__title', { text: '六级单词 · 兴趣化记忆卡片' }),
        h('div.brand__sub', { text: 'Interest-Driven Vocabulary Cards' }),
      ]),
    ]),
    tabs,
    heading,
    sub,
    form,
    msg,
    tip,
  ]);

  const root = h('div.auth', {}, [card]);

  /** 输入框回车 → 提交（浏览器里 form 会隐式提交，这里兜住不支持的场景） */
  const onEnter = (e) => {
    if (e?.key === 'Enter') attempt(e);
  };
  usernameInput.addEventListener('keydown', onEnter);
  passwordInput.addEventListener('keydown', onEnter);

  /* -----------------------------------------------------------------------
   * 内部逻辑
   * -------------------------------------------------------------------- */

  /** 切换登录 / 注册 */
  function setMode(next, { keepMessage = false } = {}) {
    if (!MODES[next]) return;
    mode = next;
    const cfg = MODES[next];

    tabSignin.classList.toggle('is-active', next === 'signin');
    tabSignup.classList.toggle('is-active', next === 'signup');
    heading.textContent = cfg.heading;
    sub.textContent = cfg.sub;
    tip.textContent = cfg.tip;
    submitBtn.textContent = busy ? cfg.submitBusy : cfg.submit;
    passwordInput.setAttribute('autocomplete', cfg.passwordAuto);
    if (!keepMessage) setMsg('');

    // 切换模式时把焦点放到第一个空输入框，键盘用户少点一次
    const target = usernameInput.value ? passwordInput : usernameInput;
    if (typeof target.focus === 'function') target.focus();
  }

  /** 设置提示文案；level: '' | 'err' | 'ok' */
  function setMsg(text, level = '') {
    msg.className = 'auth__msg';
    if (level) msg.classList.add(level === 'ok' ? 'auth__msg--ok' : 'auth__msg--err');
    msg.textContent = text || '';
  }

  /** 忙碌态：按钮禁用并把文案改成「登录中…」 */
  function setBusy(on) {
    busy = on;
    submitBtn.disabled = on;
    usernameInput.disabled = on;
    passwordInput.disabled = on;
    const cfg = MODES[mode];
    submitBtn.textContent = on ? cfg.submitBusy : cfg.submit;
  }

  /** 提交：登录 / 注册 */
  async function attempt(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (busy) return;             // 防止 click + submit 双触发

    setBusy(true);
    setMsg(mode === 'signin' ? '正在登录…' : '正在注册…');

    const username = usernameInput.value;
    const password = passwordInput.value;

    try {
      const session = mode === 'signin'
        ? await authService.loginAndSignIn(username, password)
        : await authService.registerAndSignIn(username, password);

      setMsg(mode === 'signin' ? '登录成功，正在进入…' : '注册成功，正在进入…', 'ok');
      setBusy(false);
      if (typeof onSuccess === 'function') onSuccess(session);
    } catch (err) {
      setBusy(false);
      setMsg(authService.translateAuthError(err), 'err');
      if (typeof passwordInput.focus === 'function') passwordInput.focus();
    }
  }

  setMode(mode, { keepMessage: true });
  return root;
}

export default { createLoginView };
