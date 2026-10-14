/**
 * loginView.js —— 登录 / 注册页面（本轮新增）
 * ============================================================================
 * 纯视图组件：只负责渲染表单、做本地校验、把提交结果交给 core/supabaseClient。
 * 不做路由决策（路由在 main.js：未登录渲染本页，登录成功切到 homePage）。
 *
 * 数据流：
 *   loginView → supabaseClient.signInWithEmail / signUpWithEmail → Supabase Auth
 *   Auth 成功 → props.onAuthed(session) → main.js 挂载主界面
 *
 * 与既有分层约定一致：组件不直接碰 localStorage / 不直接 fetch；
 * 所有网络与持久化都收在 core/supabaseClient.js 里。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { signInWithEmail, signUpWithEmail } from '../core/supabaseClient.js';

/**
 * @param {object} [props]
 * @param {(session:object) => void} [props.onAuthed]      认证成功回调（拿到 session）
 * @param {string} [props.initialError]                    进入页面时的初始错误（如 SDK 加载失败）
 * @param {string} [props.notice]                          顶部提示（如「已退出登录」）
 * @returns {HTMLElement}
 */
export function createLoginView(props = {}) {
  const { onAuthed, initialError = '', notice = '' } = props;

  let mode = 'signin';       // signin | signup
  let busy = false;

  /* ---- 输入元素 ---- */
  const emailInput = h('input', {
    type: 'email',
    name: 'email',
    placeholder: 'you@example.com',
    autocomplete: 'email',
    required: true,
    spellcheck: 'false',
  });

  const passInput = h('input', {
    type: 'password',
    name: 'password',
    placeholder: '至少 6 位',
    autocomplete: 'current-password',
    required: true,
  });

  const passToggle = h('button.field__icon.auth__eye', {
    type: 'button',
    title: '显示密码',
    'aria-label': '显示 / 隐藏密码',
    onClick: () => {
      const show = passInput.type === 'password';
      passInput.type = show ? 'text' : 'password';
      passToggle.replaceChildren(svgIcon(iconPath(show ? 'eyeOff' : 'eye'), { size: 15 }));
      passToggle.setAttribute('title', show ? '隐藏密码' : '显示密码');
    },
  }, [svgIcon(iconPath('eye'), { size: 15 })]);

  const submitBtn = h('button.btn.btn--accent.auth__submit', {
    type: 'button',
    onClick: () => submit(),
  }, [svgIcon(iconPath('arrowRight'), { size: 15, cls: 'btn__icon' }), '登录']);

  const msgBox = h('div.auth__msg', { role: 'status', 'aria-live': 'polite' });

  /* ---- 标签页 ---- */
  const tabSignin = h('button.auth-tab', {
    type: 'button',
    class: 'is-active',
    onClick: () => setMode('signin'),
  }, '登录');

  const tabSignup = h('button.auth-tab', {
    type: 'button',
    onClick: () => setMode('signup'),
  }, '注册');

  const tabs = h('div.auth__tabs', {}, [tabSignin, tabSignup]);
  const titleEl = h('div.auth__heading', { text: '欢迎回来' });
  const subEl = h('div.auth__sub', { text: '登录后即可跨设备同步你的收藏、错题与熟词库。' });

  /* ---- 表单 ---- */
  const form = h('form.auth__form', {
    onSubmit: (e) => { e.preventDefault(); submit(); },
  }, [
    h('div.auth__fieldset', {}, [
      h('label.auth__label', { for: 'auth-email', text: '邮箱' }),
      h('div.field.auth__field', {}, [svgIcon(iconPath('user'), { size: 15, cls: 'field__icon' }), emailInput]),
    ]),
    h('div.auth__fieldset', {}, [
      h('label.auth__label', { for: 'auth-pass', text: '密码' }),
      h('div.field.auth__field', {}, [svgIcon(iconPath('key'), { size: 15, cls: 'field__icon' }), passInput, passToggle]),
    ]),
    msgBox,
    submitBtn,
    h('div.auth__foot', {}, [
      h('span', { text: '继续即表示你同意仅将数据用于本应用的学习记录同步。' }),
    ]),
  ]);

  emailInput.id = 'auth-email';
  passInput.id = 'auth-pass';

  const card = h('div.auth__card', {}, [
    h('div.auth__brand', {}, [
      h('div.brand__mark', {}, [svgIcon(iconPath('sparkles'), { size: 24 })]),
      h('div', {}, [
        h('div.brand__title', { text: '六级单词 · 兴趣化记忆卡片' }),
        h('div.brand__sub', { text: 'Interest-Driven Vocabulary Cards' }),
      ]),
    ]),
    tabs,
    titleEl,
    subEl,
    form,
  ]);

  const root = h('div.auth', {}, [card]);

  setMode('signin', { silent: true });
  if (notice) setMsg(notice, 'ok');
  if (initialError) setMsg(initialError, 'err');

  /* ------------------------------------------------------------------ */
  function setMode(next, { silent = false } = {}) {
    mode = next;
    tabSignin.classList.toggle('is-active', mode === 'signin');
    tabSignup.classList.toggle('is-active', mode === 'signup');
    if (mode === 'signin') {
      titleEl.textContent = '欢迎回来';
      subEl.textContent = '登录后即可跨设备同步你的收藏、错题与熟词库。';
      passInput.setAttribute('autocomplete', 'current-password');
      setBtnLabel('登录');
    } else {
      titleEl.textContent = '创建账号';
      subEl.textContent = '用邮箱注册，学习记录将自动同步到云端。';
      passInput.setAttribute('autocomplete', 'new-password');
      setBtnLabel('注册');
    }
    if (!silent) setMsg('', null);
    emailInput.focus?.();
  }

  function setBtnLabel(text) {
    submitBtn.replaceChildren(
      svgIcon(iconPath(mode === 'signin' ? 'arrowRight' : 'plus'), { size: 15, cls: 'btn__icon' }),
      document.createTextNode(text),
    );
  }

  function setMsg(text, kind) {
    msgBox.textContent = text || '';
    msgBox.className = `auth__msg${kind ? ` auth__msg--${kind}` : ''}`;
  }

  function setBusy(on) {
    busy = on;
    submitBtn.disabled = on;
    emailInput.disabled = on;
    passInput.disabled = on;
  }

  async function submit() {
    if (busy) return;
    const email = String(emailInput.value || '').trim();
    const password = String(passInput.value || '');

    if (!isValidEmail(email)) { setMsg('请输入正确的邮箱地址。', 'err'); emailInput.focus?.(); return; }
    if (password.length < 6) { setMsg('密码至少 6 位。', 'err'); passInput.focus?.(); return; }

    setBusy(true);
    setMsg(mode === 'signin' ? '正在登录…' : '正在注册…', null);

    try {
      if (mode === 'signin') {
        const { session } = await signInWithEmail(email, password);
        if (!session) throw new Error('登录成功但未取得会话，请重试。');
        setMsg('登录成功，正在进入…', 'ok');
        onAuthed?.(session);
      } else {
        const { session, needsConfirm } = await signUpWithEmail(email, password);
        if (session) {
          setMsg('注册成功，正在进入…', 'ok');
          onAuthed?.(session);
        } else {
          // 项目开启了「邮箱确认」：必须先点邮件里的链接
          setMode('signin', { silent: true });
          setMsg(
            needsConfirm
              ? '注册成功！我们已发送确认邮件，请到邮箱点击链接后再登录。'
              : '注册成功，请返回登录页登录。',
            'ok',
          );
        }
      }
    } catch (e) {
      setMsg(e?.message || '操作失败，请稍后重试。', 'err');
    } finally {
      setBusy(false);
    }
  }

  /** 对外暴露：允许路由层清空错误后重挂 */
  root.__setMsg = setMsg;
  root.__mode = () => mode;

  return root;
}

/** 轻量邮箱校验（够用即可，真正的校验交给 Supabase） */
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ''));
}

export default createLoginView;
