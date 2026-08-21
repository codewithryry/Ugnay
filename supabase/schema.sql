-- Ugnay schema: profiles, chats, messages, user_settings (+ RLS)
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------- chats
create table if not exists public.chats (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null default 'New chat',
  provider      text not null default 'openrouter',
  model         text not null default 'openrouter/free',
  system_prompt text,                              -- per-chat system prompt override
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);

-- ---------------------------------------------------------------- projects
-- Workspaces: named folders a chat can belong to. A chat with no project_id is
-- a plain conversation and shows under History.
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_created_idx on public.projects (user_id, created_at desc);

-- Instructions every conversation in the workspace is answered with.
alter table public.projects
  add column if not exists instructions text not null default '';

-- Deleting a workspace keeps its conversations; they fall back to History.
alter table public.chats
  add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists chats_project_idx on public.chats (project_id);

-- ---------------------------------------------------------------- messages
create table if not exists public.messages (
  id                uuid primary key default gen_random_uuid(),
  chat_id           uuid not null references public.chats(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null check (role in ('system','user','assistant')),
  content           text not null default '',
  provider          text,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  created_at        timestamptz not null default now()
);
create index if not exists messages_chat_created_idx on public.messages (chat_id, created_at asc);
create index if not exists messages_user_idx on public.messages (user_id);

-- ----------------------------------------------------------- user_settings
create table if not exists public.user_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  global_system_prompt text not null default '',
  default_provider     text not null default 'openrouter',
  default_model        text not null default 'openrouter/free',
  temperature          double precision not null default 0.7 check (temperature >= 0 and temperature <= 2),
  max_tokens           integer not null default 2048 check (max_tokens > 0 and max_tokens <= 32768),
  presets              jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Data & Information preferences. Added after the initial release, so they are
-- applied as idempotent alters for existing projects.
alter table public.user_settings
  add column if not exists improve_model boolean not null default false;
alter table public.user_settings
  add column if not exists share_links_enabled boolean not null default true;
alter table public.user_settings
  add column if not exists personalize_with_history boolean not null default false;

-- Behavior preferences.
alter table public.user_settings
  add column if not exists auto_scroll boolean not null default true;
alter table public.user_settings
  add column if not exists notify_on_finish boolean not null default false;
alter table public.user_settings
  add column if not exists cmd_enter_to_submit boolean not null default false;

-- Appearance preferences.
alter table public.user_settings
  add column if not exists theme text not null default 'dark'
  check (theme in ('light', 'dark', 'system'));
alter table public.user_settings
  add column if not exists wrap_code_lines boolean not null default false;

alter table public.user_settings
  add column if not exists rich_text_editor boolean not null default false;
alter table public.user_settings
  add column if not exists dictation_refinement text not null default 'none'
  check (dictation_refinement in ('none', 'tidy', 'full'));

-- Preferred short name Ugnay uses when addressing the user.
alter table public.profiles add column if not exists nickname text;

-- ------------------------------------------------ message embeddings (RAG)
-- Vector memory behind Settings → Data Controls → "Personalize AI with your
-- conversation history". 1,024 dimensions = liquid/lfm-2.5-embedding-350m.
create extension if not exists vector;

create table if not exists public.message_embeddings (
  message_id uuid primary key references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  content    text not null,
  embedding  vector(1024) not null,
  created_at timestamptz not null default now()
);
create index if not exists message_embeddings_user_idx on public.message_embeddings (user_id);
create index if not exists message_embeddings_vector_idx
  on public.message_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Nearest neighbours among the CALLER's own messages. Security invoker, so the
-- RLS policy below is what scopes the search.
create or replace function public.match_user_messages(
  query_embedding text,
  match_count     integer default 5,
  exclude_chat    uuid default null
)
returns table (chat_id uuid, chat_title text, content text, similarity double precision)
language sql stable security invoker set search_path = public as $$
  select
    e.chat_id,
    c.title as chat_title,
    e.content,
    1 - (e.embedding <=> query_embedding::vector) as similarity
  from public.message_embeddings e
  join public.chats c on c.id = e.chat_id
  where e.user_id = auth.uid()
    and (exclude_chat is null or e.chat_id <> exclude_chat)
  order by e.embedding <=> query_embedding::vector
  limit greatest(1, least(match_count, 20));
$$;

-- --------------------------------------------------- message feedback
-- Thumbs up/down on assistant replies. Only written while Settings → Data
-- Controls → "Improve the model" is on; nothing else consumes it, so no
-- training claim is implied by its presence.
create table if not exists public.message_feedback (
  message_id uuid primary key references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  rating     text not null check (rating in ('up', 'down')),
  created_at timestamptz not null default now()
);
create index if not exists message_feedback_chat_idx on public.message_feedback (chat_id);

-- ------------------------------------------------------ product feedback
-- Free-form feedback sent from the Feedback page. One row per submission, kept
-- so it can be read back by the account that sent it.
create table if not exists public.app_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('idea', 'bug', 'other')),
  message    text not null check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists app_feedback_user_created_idx
  on public.app_feedback (user_id, created_at desc);

-- ------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists chats_touch on public.chats;
create trigger chats_touch before update on public.chats
  for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Bump the parent chat whenever a message lands, so history sorts by activity.
create or replace function public.touch_chat_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end $$;

drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat after insert on public.messages
  for each row execute function public.touch_chat_on_message();

-- --------------------------------------------------- profile auto-creation
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------- RLS
alter table public.profiles      enable row level security;
alter table public.chats         enable row level security;
alter table public.projects      enable row level security;
alter table public.messages      enable row level security;
alter table public.user_settings enable row level security;
alter table public.message_embeddings enable row level security;
alter table public.message_feedback enable row level security;
alter table public.app_feedback enable row level security;

drop policy if exists "profiles: own row"      on public.profiles;
drop policy if exists "chats: own rows"        on public.chats;
drop policy if exists "projects: own rows"     on public.projects;
drop policy if exists "messages: own rows"     on public.messages;
drop policy if exists "settings: own row"      on public.user_settings;
drop policy if exists "embeddings: own rows"   on public.message_embeddings;
drop policy if exists "feedback: own rows"      on public.message_feedback;
drop policy if exists "app feedback: own rows"  on public.app_feedback;

create policy "profiles: own row" on public.profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "chats: own rows" on public.chats
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "projects: own rows" on public.projects
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A message is reachable only if it is owned by the caller AND its chat is too.
create policy "messages: own rows" on public.messages
  for all to authenticated
  using (
    auth.uid() = user_id
    and exists (select 1 from public.chats c where c.id = messages.chat_id and c.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.chats c where c.id = messages.chat_id and c.user_id = auth.uid())
  );

create policy "settings: own row" on public.user_settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "embeddings: own rows" on public.message_embeddings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "feedback: own rows" on public.message_feedback
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "app feedback: own rows" on public.app_feedback
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ======================================================================
-- v0.6 — prompt library, branching, sharing, workspace settings, files
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- ---------------------------------------------------------------- prompts
-- Reusable prompts, inserted into the composer. `folder` is a plain label so
-- organising them needs no second table.
create table if not exists public.prompts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 8000),
  folder     text not null default '' check (char_length(folder) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prompts_user_updated_idx on public.prompts (user_id, updated_at desc);

drop trigger if exists prompts_touch on public.prompts;
create trigger prompts_touch before update on public.prompts
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------ branching & organisation
-- A branch is an ordinary chat that remembers where it came from, so the
-- original conversation is never modified.
alter table public.chats
  add column if not exists branched_from_chat_id uuid references public.chats(id) on delete set null;
alter table public.chats
  add column if not exists branched_from_message_id uuid references public.messages(id) on delete set null;
-- Sidebar organisation.
alter table public.chats add column if not exists pinned boolean not null default false;
alter table public.chats add column if not exists archived boolean not null default false;
create index if not exists chats_user_pinned_idx
  on public.chats (user_id, pinned desc, updated_at desc);

-- ------------------------------------------------------- temporary chat
-- Temporary Chat keeps its promise ("won't appear in your history") while the
-- turns are still recorded: they land in one hidden chat row per account that
-- no listing reads. The partial unique index guarantees at most one per user,
-- so concurrent first turns cannot create two.
alter table public.chats add column if not exists is_temporary boolean not null default false;
create unique index if not exists chats_one_temporary_idx
  on public.chats (user_id) where is_temporary;

-- ------------------------------------------------------ workspace settings
-- Per-workspace model default and memory switch. Null model columns mean
-- "use the account default", so existing workspaces are unaffected.
alter table public.projects add column if not exists default_provider text;
alter table public.projects add column if not exists default_model text;
alter table public.projects add column if not exists memory_enabled boolean not null default true;

-- ------------------------------------------------------------ shared chats
-- A read-only link to one conversation. `shared_up_to` freezes the snapshot so
-- messages sent after sharing are not exposed by an already-published link.
create table if not exists public.shared_chats (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (char_length(slug) between 16 and 64),
  chat_id      uuid not null references public.chats(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  shared_up_to timestamptz not null default now(),
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists shared_chats_chat_idx on public.shared_chats (chat_id);
create index if not exists shared_chats_user_idx on public.shared_chats (user_id, created_at desc);

-- ------------------------------------------------------------------- files
-- Reserved for File Chat / Workspace Files. Nothing writes here yet; the table
-- and its policies exist so that release needs no second migration.
create table if not exists public.files (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete cascade,
  chat_id        uuid references public.chats(id) on delete cascade,
  bucket         text not null default 'attachments',
  storage_path   text not null,
  name           text not null check (char_length(name) between 1 and 255),
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes >= 0),
  /* Extracted text, used to answer questions about the file. */
  extracted_text text,
  created_at     timestamptz not null default now()
);
create index if not exists files_user_created_idx on public.files (user_id, created_at desc);
create index if not exists files_project_idx on public.files (project_id);
create index if not exists files_chat_idx on public.files (chat_id);

-- --------------------------------------------------------------------- RLS
alter table public.prompts      enable row level security;
alter table public.shared_chats enable row level security;
alter table public.files        enable row level security;

drop policy if exists "prompts: own rows"      on public.prompts;
drop policy if exists "shared chats: own rows" on public.shared_chats;
drop policy if exists "files: own rows"        on public.files;

create policy "prompts: own rows" on public.prompts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Only the owner manages share links. Public reading goes through the
-- security-definer function below, never through this table.
create policy "shared chats: own rows" on public.shared_chats
  for all to authenticated
  using (
    auth.uid() = user_id
    and exists (select 1 from public.chats c where c.id = shared_chats.chat_id and c.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.chats c where c.id = shared_chats.chat_id and c.user_id = auth.uid())
  );

create policy "files: own rows" on public.files
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------- public read of a share
-- Returns one shared conversation to anyone holding the slug. Security
-- definer, because an anonymous reader has no rights on chats or messages.
--
-- Deliberately narrow: title, role, content and timestamp only. The chat's
-- system prompt, its workspace and instructions, the owner's id, the provider,
-- the model and the token counts are all withheld.
create or replace function public.get_shared_chat(share_slug text)
returns table (chat_title text, role text, content text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.title, m.role, m.content, m.created_at
  from public.shared_chats s
  join public.chats c on c.id = s.chat_id
  join public.messages m on m.chat_id = s.chat_id
  where s.slug = share_slug
    and s.revoked = false
    and m.created_at <= s.shared_up_to
    and m.role in ('user', 'assistant')
  order by m.created_at asc
  limit 2000;
$$;

-- --------------------------------------------------------------- usage
-- Aggregates for the usage dashboard. Security invoker plus an explicit
-- auth.uid() filter, exactly like match_user_messages, so a caller can only
-- ever total their own messages. Token columns are whatever the provider
-- reported; nothing is estimated here.
create or replace function public.usage_summary(since timestamptz default null)
returns table (
  provider          text,
  model             text,
  role              text,
  messages          bigint,
  prompt_tokens     bigint,
  completion_tokens bigint,
  total_tokens      bigint
)
language sql stable security invoker set search_path = public as $$
  select
    m.provider,
    m.model,
    m.role,
    count(*)::bigint,
    coalesce(sum(m.prompt_tokens), 0)::bigint,
    coalesce(sum(m.completion_tokens), 0)::bigint,
    coalesce(sum(m.total_tokens), 0)::bigint
  from public.messages m
  where m.user_id = auth.uid()
    and (since is null or m.created_at >= since)
  group by m.provider, m.model, m.role;
$$;

-- Messages per day, for the activity strip.
create or replace function public.usage_daily(since timestamptz default null)
returns table (day date, messages bigint, total_tokens bigint)
language sql stable security invoker set search_path = public as $$
  select
    (m.created_at at time zone 'utc')::date as day,
    count(*)::bigint,
    coalesce(sum(m.total_tokens), 0)::bigint
  from public.messages m
  where m.user_id = auth.uid()
    and (since is null or m.created_at >= since)
  group by 1
  order by 1 asc;
$$;

revoke all on function public.get_shared_chat(text) from public;
grant execute on function public.get_shared_chat(text) to anon, authenticated;

-- ======================================================================
-- v0.7 — self-service account deletion
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- Deletes the caller's own auth user. Every public table references
-- auth.users(id) on delete cascade, so this one delete wipes the profile,
-- chats, messages, projects, settings, prompts, share links, file records,
-- embeddings, feedback — and the sign-in sessions themselves.
--
-- Security definer because only the postgres role may write to auth.users;
-- auth.uid() pins the delete to the caller's own row, so no one can remove
-- another account.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'delete_own_account requires an authenticated caller';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
