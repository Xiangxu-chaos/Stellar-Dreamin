/**
 * supabaseClient.js —— Supabase 客户端与认证封装（本轮新增）
 * ============================================================================
 * 职责边界：
 *   ✅ 本项目**唯一**允许接触 Supabase SDK / 网络认证的地方。
 *   ✅ 对外只暴露 Promise 语义的认证函数，配套中文错误文案。
 *   ❌ 不渲染任何 UI（UI 在 views/loginView.js）。
 *   ❌ 不读写业务数据表（收藏 / 错题 / 熟词）—— 那是「数据迁移」阶段的事。
 *
 * 为什么用「动态 import」而不是顶层静态 import：
 *   项目是原生 ES Module，无构建链，SDK 走 CDN（esm.sh）。
 *   顶层静态 import 一旦 CDN 不可达，会让**整个模块图加载失败** →
 *   main.js 直接白屏，用户连错误提示都看不到。
 *   改成惰性动态 import + 缓存 Promise 后：
 *     - 首次用到时才拉取 SDK；
 *     - 拉取失败会抛出可读错误，由 loginView 渲染成提示 + 重试按钮。
 *
 * ⚠️ 安全说明：这里的 KEY 是 Supabase 的 **publishable（可公开）** 密钥，
 *   设计上就允许出现在浏览器端。真正的数据隔离靠数据库的 RLS 策略
 *   （见 sql/01_init_schema.sql）。切勿把 service_role 密钥放进前端。
 * ============================================================================
 */

/**
 * Supabase 请求地址 —— 走 Cloudflare Worker 反向代理。
 * 真实项目域名：https://codtjrpxoaiqpoglqcz.supabase.co（国内直连被墙）
 * 代理域名：    https://api.stellar-dreamin.site  ← 当前使用
 * ⚠️ 代理必须完整转发 /auth/v1/* 与 /rest/v1/*，且不能改写 apikey / Authorization 头。
 */
export const SUPABASE_URL = 'https://api.stellar-dreamin.site';

/** Supabase publishable key（可公开，配合 RLS 使用） */
export const SUPABASE_KEY = 'sb_publishable_qCqTiudUkNVhCmpV_I7R8g_6aKQPatt';

/** CDN 上的 supabase-js v2（原生 ESM，无需 npm） */
const SDK_CDN = 'https://esm.sh/@supabase/supabase-js@2';

/** localStorage 中存放 auth 会话的 key（独立命名空间，便于日后清理） */
const AUTH_STORAGE_KEY = 'wb:cet6:auth';

let client = null;
let clientPromise = null;

/**
 * 取（并按需创建）单例客户端。
 * @returns {Promise<object>} supabase client
 */
export function getSupabase() {
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = import(/* @vite-ignore */ SDK_CDN)
      .then((mod) => {
        const createClient = mod.createClient || mod.default?.createClient;
        if (typeof createClient !== 'function') {
          throw new Error('Supabase SDK 导出异常（未找到 createClient）');
        }
        client = createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
            persistSession: true,        // 会话持久化到 localStorage → 刷新免登录
            autoRefreshToken: true,      // 到期自动续期
            detectSessionInUrl: true,    // 支持「邮箱确认链接」回跳后自动登录
            storageKey: AUTH_STORAGE_KEY,
            flowType: 'pkce',
          },
        });
        return client;
      })
      .catch((e) => {
        clientPromise = null;   // 允许重试
        const msg = String(e?.message || e);
        throw new Error(
          /fetch|network|Failed to fetch|Load failed/i.test(msg)
            ? '无法加载 Supabase SDK，请检查网络后重试。'
            : `Supabase 初始化失败：${msg}`,
        );
      });
  }
  return clientPromise;
}

/** SDK 是否已就绪（不影响业务，仅用于调试） */
export function isReady() {
  return Boolean(client);
}

/* ---------------------------------------------------------------------------
 * 会话
 * ------------------------------------------------------------------------ */

/**
 * 读取当前会话（未登录返回 null）。
 * ⚠️ 网络/SDK 异常时**抛出**而不是静默返回 null —— 调用方需要区分
 *    「确实没登录」和「连不上认证服务」，前者跳登录页，后者要提示用户。
 */
export async function getSession() {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

/** 当前登录用户（未登录返回 null） */
export async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

/* ---------------------------------------------------------------------------
 * 注册 / 登录 / 退出
 * ------------------------------------------------------------------------ */

/**
 * 邮箱注册。
 * @returns {Promise<{user:object|null, session:object|null, needsConfirm:boolean}>}
 *   needsConfirm = true 表示项目开启了「邮箱确认」，需要用户去邮箱点确认链接后才能登录。
 */
export async function signUpWithEmail(email, password) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: currentRedirectUrl() },
  });
  if (error) throw new Error(translateAuthError(error));
  return {
    user: data?.user || null,
    session: data?.session || null,
    // 开邮箱确认时：user 存在但没有 session
    needsConfirm: Boolean(data?.user) && !data?.session,
  };
}

/**
 * 邮箱密码登录。
 * @returns {Promise<{user:object, session:object}>}
 */
export async function signInWithEmail(email, password) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error));
  return { user: data?.user || null, session: data?.session || null };
}

/** 退出登录（清本地会话） */
export async function signOutUser() {
  const sb = await getSupabase();
  const { error } = await sb.auth.signOut();
  if (error) throw new Error(translateAuthError(error));
  return true;
}

/** 发送「重置密码」邮件（预留给后续设置页使用） */
export async function sendPasswordReset(email) {
  const sb = await getSupabase();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: currentRedirectUrl(),
  });
  if (error) throw new Error(translateAuthError(error));
  return true;
}

/**
 * 订阅认证状态变化。
 * @param {(event:string, session:object|null) => void} cb
 * @returns {() => void} 取消订阅
 */
export function onAuthStateChange(cb) {
  let unsubscribed = false;
  let unsubscribe = () => { unsubscribed = true; };

  getSupabase()
    .then((sb) => {
      if (unsubscribed) return;
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        try { cb(event, session); } catch (e) { console.warn('[supabaseClient] auth 回调异常', e); }
      });
      unsubscribe = () => { unsubscribed = true; data?.subscription?.unsubscribe?.(); };
    })
    .catch(() => { /* SDK 不可用时静默：路由层已用 getSession() 做过一次判断 */ });

  return () => unsubscribe();
}

/* ---------------------------------------------------------------------------
 * 工具
 * ------------------------------------------------------------------------ */

/** 邮箱确认 / 重置密码的跳回地址（当前页面，去掉 hash 与查询串） */
function currentRedirectUrl() {
  try {
    if (typeof window === 'undefined' || !window.location) return undefined;
    const { origin, pathname } = window.location;
    return `${origin}${pathname}`;
  } catch (e) {
    return undefined;
  }
}

/** 把 Supabase 的英文报错翻成用户能看懂的中文 */
export function translateAuthError(err) {
  const raw = String(err?.message || err || '');
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return '邮箱或密码不正确。';
  if (m.includes('email not confirmed')) return '邮箱尚未确认，请先到邮箱点击确认链接。';
  if (m.includes('user already registered') || m.includes('already been registered')) return '该邮箱已注册，请直接登录。';
  if (m.includes('password should be at least')) return '密码太短，至少需要 6 位。';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return '邮箱格式不正确。';
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) return '邮件发送过于频繁，请稍后再试。';
  if (m.includes('for security purposes')) return '操作过于频繁，请稍后再试。';
  if (m.includes('signup is disabled')) return '当前项目已关闭注册，请联系管理员。';
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network')) return '网络连接失败，请检查网络后重试。';
  return raw || '操作失败，请稍后重试。';
}

export default { getSupabase, getSession, getCurrentUser, signInWithEmail, signUpWithEmail, signOutUser, onAuthStateChange };
