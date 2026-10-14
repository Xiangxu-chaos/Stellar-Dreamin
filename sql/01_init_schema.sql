-- ============================================================================
-- 六级单词 · 兴趣化记忆卡片 —— Supabase 建表脚本（第一步：认证 + 数据表 + RLS）
-- ============================================================================
-- 使用方式：
--   打开 Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘贴 → Run。
--   本脚本是**幂等**的（IF NOT EXISTS / DROP POLICY IF EXISTS），可以重复执行。
--
-- 设计约定（与前端 src/services/dataService.js 的 localStorage 结构一一对应，
-- 便于「数据迁移」阶段直接把本地数据搬上来）：
--
--   localStorage 的 key                  →  本脚本的表
--   wb:cet6:favorites    {domainId::word: {word, domainId, favoritedAt}} → public.favorites
--   wb:cet6:wrongWords   {domainId::word: {word, domainId, wrongCount,
--                                          totalAttempts, lastWrongAt}}  → public.wrong_words
--   wb:cet6:masteredWords{domainId::word: {word, domainId, masteredAt}}  → public.mastered_words
--   wb:cet6:userDomains  ['slay_the_spire', ...]                        → public.user_domains
--
-- 安全模型：
--   四张表全部开启 RLS，策略统一为「auth.uid() = user_id」——
--   任何用户只能看到 / 修改自己的行。前端只带 publishable key，
--   即使被反编译也无法读到别人的数据。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. 前置
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- 统一的 updated_at 自动维护函数（被下面四张表的触发器复用）
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ===========================================================================
-- 1. favorites —— 收藏夹
-- ===========================================================================
create table if not exists public.favorites (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  domain_id    text        not null,
  word         text        not null,
  -- 归一化小写列：保证「Ascension」与「ascension」不会在同一用户+领域下重复
  word_lower   text        generated always as (lower(word)) stored,
  favorited_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint favorites_user_domain_word_key unique (user_id, domain_id, word_lower)
);

comment on table  public.favorites is '用户收藏的单词（跨领域，同词不同领域各自独立）';
comment on column public.favorites.word_lower is 'lower(word) 生成列，仅用于唯一约束 / 查询';

create index if not exists favorites_user_domain_idx on public.favorites (user_id, domain_id);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
drop policy if exists "favorites_insert_own" on public.favorites;
drop policy if exists "favorites_update_own" on public.favorites;
drop policy if exists "favorites_delete_own" on public.favorites;

create policy "favorites_select_own" on public.favorites
  for select to authenticated using (auth.uid() = user_id);
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (auth.uid() = user_id);
create policy "favorites_update_own" on public.favorites
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists favorites_touch_updated_at on public.favorites;
create trigger favorites_touch_updated_at
  before update on public.favorites
  for each row execute function public.touch_updated_at();


-- ===========================================================================
-- 2. wrong_words —— 错题本
-- ===========================================================================
create table if not exists public.wrong_words (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  domain_id      text        not null,
  word           text        not null,
  word_lower     text        generated always as (lower(word)) stored,
  wrong_count    integer     not null default 0 check (wrong_count >= 0),
  total_attempts integer     not null default 0 check (total_attempts >= 0),
  last_wrong_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wrong_words_user_domain_word_key unique (user_id, domain_id, word_lower)
);

comment on table public.wrong_words is '错题本：错误率 = wrong_count / total_attempts';

create index if not exists wrong_words_user_domain_idx on public.wrong_words (user_id, domain_id);

alter table public.wrong_words enable row level security;

drop policy if exists "wrong_words_select_own" on public.wrong_words;
drop policy if exists "wrong_words_insert_own" on public.wrong_words;
drop policy if exists "wrong_words_update_own" on public.wrong_words;
drop policy if exists "wrong_words_delete_own" on public.wrong_words;

create policy "wrong_words_select_own" on public.wrong_words
  for select to authenticated using (auth.uid() = user_id);
create policy "wrong_words_insert_own" on public.wrong_words
  for insert to authenticated with check (auth.uid() = user_id);
create policy "wrong_words_update_own" on public.wrong_words
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "wrong_words_delete_own" on public.wrong_words
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists wrong_words_touch_updated_at on public.wrong_words;
create trigger wrong_words_touch_updated_at
  before update on public.wrong_words
  for each row execute function public.touch_updated_at();


-- ===========================================================================
-- 3. mastered_words —— 熟词库
-- ===========================================================================
create table if not exists public.mastered_words (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  domain_id   text        not null,
  word        text        not null,
  word_lower  text        generated always as (lower(word)) stored,
  mastered_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mastered_words_user_domain_word_key unique (user_id, domain_id, word_lower)
);

comment on table public.mastered_words is '熟词库：复习时「移入熟词库」写入这里，同时从 favorites 删除';

create index if not exists mastered_words_user_domain_idx on public.mastered_words (user_id, domain_id);

alter table public.mastered_words enable row level security;

drop policy if exists "mastered_words_select_own" on public.mastered_words;
drop policy if exists "mastered_words_insert_own" on public.mastered_words;
drop policy if exists "mastered_words_update_own" on public.mastered_words;
drop policy if exists "mastered_words_delete_own" on public.mastered_words;

create policy "mastered_words_select_own" on public.mastered_words
  for select to authenticated using (auth.uid() = user_id);
create policy "mastered_words_insert_own" on public.mastered_words
  for insert to authenticated with check (auth.uid() = user_id);
create policy "mastered_words_update_own" on public.mastered_words
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mastered_words_delete_own" on public.mastered_words
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists mastered_words_touch_updated_at on public.mastered_words;
create trigger mastered_words_touch_updated_at
  before update on public.mastered_words
  for each row execute function public.touch_updated_at();


-- ===========================================================================
-- 4. user_domains —— 我的库（用户订阅的兴趣领域列表）
-- ---------------------------------------------------------------------------
-- 说明：这张表记录的是「用户选了哪几个领域」，一行 = 一个领域，
--       因此**没有 word 列**（word 对领域订阅没有意义）。
--       收藏 / 错题 / 熟词三张表才有 word。
-- ===========================================================================
create table if not exists public.user_domains (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  domain_id  text        not null,
  enabled    boolean     not null default true,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_domains_user_domain_key unique (user_id, domain_id)
);

comment on table public.user_domains is '我的库：用户订阅的兴趣领域 id 列表（slay_the_spire / hollow_knight / honor_of_kings / valorant）';

create index if not exists user_domains_user_idx on public.user_domains (user_id);

alter table public.user_domains enable row level security;

drop policy if exists "user_domains_select_own" on public.user_domains;
drop policy if exists "user_domains_insert_own" on public.user_domains;
drop policy if exists "user_domains_update_own" on public.user_domains;
drop policy if exists "user_domains_delete_own" on public.user_domains;

create policy "user_domains_select_own" on public.user_domains
  for select to authenticated using (auth.uid() = user_id);
create policy "user_domains_insert_own" on public.user_domains
  for insert to authenticated with check (auth.uid() = user_id);
create policy "user_domains_update_own" on public.user_domains
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_domains_delete_own" on public.user_domains
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists user_domains_touch_updated_at on public.user_domains;
create trigger user_domains_touch_updated_at
  before update on public.user_domains
  for each row execute function public.touch_updated_at();


-- ===========================================================================
-- 5. 自检：确认四张表的 RLS 都已开启（应返回 4 行，rls_enabled 全为 true）
-- ===========================================================================
select
  c.relname                          as table_name,
  c.relrowsecurity                   as rls_enabled,
  count(p.policyname)                as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.tablename = c.relname and p.schemaname = n.nspname
where n.nspname = 'public'
  and c.relname in ('favorites', 'wrong_words', 'mastered_words', 'user_domains')
group by c.relname, c.relrowsecurity
order by c.relname;
