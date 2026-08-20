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
