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

-- ======================================================================
-- v0.8 — workflows and knowledge
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- ------------------------------------------------------------- workflows
-- A reusable chain of prompts, e.g. summarise -> analyse -> write a report.
-- Steps live in one jsonb array rather than a child table: they are always read
-- and written together, and their order is the array's order.
create table if not exists public.workflows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  /* [{ "title": text, "prompt": text }, ...] */
  steps       jsonb not null default '[]'::jsonb,
  /* Null means "use the account default", like projects do. */
  provider    text,
  model       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists workflows_user_updated_idx
  on public.workflows (user_id, updated_at desc);

drop trigger if exists workflows_touch on public.workflows;
create trigger workflows_touch before update on public.workflows
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------- knowledge (file RAG)
-- Uploaded files are recorded in public.files (already defined above). Their
-- text is split into chunks here, each with its own embedding, so a question
-- can be answered from the passages that actually matter instead of a whole
-- document. Same 1,024 dimensions as message_embeddings.
create table if not exists public.file_chunks (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.files(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  embedding   vector(1024) not null,
  created_at  timestamptz not null default now(),
  unique (file_id, chunk_index)
);
create index if not exists file_chunks_user_idx on public.file_chunks (user_id);
create index if not exists file_chunks_file_idx on public.file_chunks (file_id);
create index if not exists file_chunks_vector_idx
  on public.file_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Marks how far indexing got, so the UI can tell "no text yet" apart from
-- "this format cannot be read". Null means never attempted.
alter table public.files add column if not exists indexed_at timestamptz;
alter table public.files add column if not exists index_error text;

-- Nearest passages among the CALLER's own uploads. Security invoker plus the
-- auth.uid() filter, exactly like match_user_messages.
create or replace function public.match_user_files(
  query_embedding text,
  match_count     integer default 5
)
returns table (
  file_id    uuid,
  file_name  text,
  content    text,
  similarity double precision
)
language sql stable security invoker set search_path = public as $$
  select
    c.file_id,
    f.name as file_name,
    c.content,
    1 - (c.embedding <=> query_embedding::vector) as similarity
  from public.file_chunks c
  join public.files f on f.id = c.file_id
  where c.user_id = auth.uid()
  order by c.embedding <=> query_embedding::vector
  limit greatest(1, least(match_count, 20));
$$;

-- --------------------------------------------------------------------- RLS
alter table public.workflows   enable row level security;
alter table public.file_chunks enable row level security;

drop policy if exists "workflows: own rows"   on public.workflows;
drop policy if exists "file chunks: own rows" on public.file_chunks;

create policy "workflows: own rows" on public.workflows
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A chunk is reachable only if it is owned by the caller AND its file is too,
-- mirroring the messages policy.
create policy "file chunks: own rows" on public.file_chunks
  for all to authenticated
  using (
    auth.uid() = user_id
    and exists (select 1 from public.files f where f.id = file_chunks.file_id and f.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.files f where f.id = file_chunks.file_id and f.user_id = auth.uid())
  );

-- ------------------------------------------------------- storage: knowledge
-- Private bucket for the uploaded originals. Every object is stored under the
-- owner's user id, and the policies below are what keep one account out of
-- another's folder.
insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', false)
on conflict (id) do nothing;

drop policy if exists "knowledge: own objects" on storage.objects;
create policy "knowledge: own objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);

-- ======================================================================
-- v0.8.1 — knowledge indexing visibility
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- How much of a file actually made it into the index. `total_chunks` is what
-- the whole text would produce and `chunk_count` is what was embedded, so
-- total > count means the file is indexed in part and the UI can say so
-- instead of reporting it as complete.
alter table public.files add column if not exists chunk_count integer;
alter table public.files add column if not exists total_chunks integer;

-- ======================================================================
-- v0.9 — embedding provider is recorded with every vector
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- Which model produced each vector. Vectors from two different models are not
-- comparable, so a search has to stay inside one model — this column is what
-- makes that possible, and what lets the UI spot a file that predates a
-- provider change and offer to re-index it.
--
-- Null means "written before this column existed", i.e. by the retired
-- OpenRouter model. Those rows are excluded by the filter below rather than
-- deleted, so nothing is destroyed automatically.
alter table public.file_chunks add column if not exists embedding_model text;
alter table public.files add column if not exists embedding_model text;
create index if not exists file_chunks_model_idx on public.file_chunks (user_id, embedding_model);

-- Same function, plus an optional model filter. The default keeps every
-- existing caller working; passing a model scopes the search to vectors that
-- model produced.
create or replace function public.match_user_files(
  query_embedding text,
  match_count     integer default 5,
  model_filter    text default null
)
returns table (
  file_id    uuid,
  file_name  text,
  content    text,
  similarity double precision
)
language sql stable security invoker set search_path = public as $$
  select
    c.file_id,
    f.name as file_name,
    c.content,
    1 - (c.embedding <=> query_embedding::vector) as similarity
  from public.file_chunks c
  join public.files f on f.id = c.file_id
  where c.user_id = auth.uid()
    and (model_filter is null or c.embedding_model = model_filter)
  order by c.embedding <=> query_embedding::vector
  limit greatest(1, least(match_count, 20));
$$;

-- ======================================================================
-- v0.10 — training dataset preserved across account deletion
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- ------------------------------------------------------ training_messages
-- Conversation data kept for future model training after the account that
-- produced it is deleted. Deliberately holds no account-identifying columns:
-- no user id, no email, no profile or chat title. `conversation_id` is the
-- source chat's random uuid, kept only so turns of one conversation can be
-- grouped back together; the chat row itself is gone.
--
-- Not read by any live feature yet — this is a dataset, not a cache.
create table if not exists public.training_messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null,
  -- The source message uuid, kept solely to make preservation idempotent:
  -- re-running deletion can never duplicate a turn.
  source_message_id  uuid not null unique,
  turn_index         integer not null default 0,
  role               text not null check (role in ('system','user','assistant')),
  content            text not null default '',
  provider           text,
  model              text,
  prompt_tokens      integer,
  completion_tokens  integer,
  total_tokens       integer,
  system_prompt      text,
  message_created_at timestamptz,
  collected_at       timestamptz not null default now()
);
create index if not exists training_messages_conversation_idx
  on public.training_messages (conversation_id, turn_index asc);

-- No policies: RLS on with none defined means no client role can read or
-- write this table. Only the security-definer collector below touches it.
alter table public.training_messages enable row level security;
revoke all on public.training_messages from anon, authenticated;

-- Copies the caller's eligible conversations into the training dataset.
-- Eligible = the account opted in via Settings → Data Controls → "Improve the
-- model for everyone" (user_settings.improve_model).
create or replace function public.collect_training_messages(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = target_user and improve_model
  ) then
    return;
  end if;

  insert into public.training_messages (
    conversation_id, source_message_id, turn_index, role, content,
    provider, model, prompt_tokens, completion_tokens, total_tokens,
    system_prompt, message_created_at
  )
  select
    m.chat_id,
    m.id,
    row_number() over (partition by m.chat_id order by m.created_at, m.id) - 1,
    m.role,
    m.content,
    coalesce(m.provider, c.provider),
    coalesce(m.model, c.model),
    m.prompt_tokens,
    m.completion_tokens,
    m.total_tokens,
    c.system_prompt,
    m.created_at
  from public.messages m
  join public.chats c on c.id = m.chat_id
  where m.user_id = target_user
  on conflict (source_message_id) do nothing;
end $$;

revoke all on function public.collect_training_messages(uuid) from public, anon, authenticated;

-- Deletion, unchanged in effect for the account: the preservation step runs
-- first, inside the same transaction as the delete, so the training copy
-- exists before the source rows cascade away — and neither happens if the
-- other fails.
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
  perform public.collect_training_messages(auth.uid());
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;

-- ======================================================================
-- v0.11 — admin role and AI model management
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- ---------------------------------------------------------------- role
-- Two roles only: every account is a 'user' until someone with database access
-- promotes it. Nothing in the app can hand out 'admin'.
alter table public.profiles add column if not exists role text not null default 'user';
do $$
begin
  alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));
exception when duplicate_object then null;
end $$;

-- Is the caller an admin? Security definer so it can be used inside policies
-- on profiles itself without recursing through that table's own RLS.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to authenticated;

-- The "profiles: own row" policy lets an account update its own profile, so
-- the role column needs its own guard: only an admin may change it.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ------------------------------------------------------- model controls
-- Admin overrides on top of the provider registry in lib/providers. A row is
-- an override, so a model with no row behaves exactly as it does today.
-- `model_id = ''` means the row applies to the whole provider.
create table if not exists public.model_controls (
  provider_id text not null,
  model_id    text not null default '',
  status      text not null default 'available'
              check (status in ('available', 'disabled', 'maintenance')),
  /* Higher wins when automatic routing ranks candidates. */
  priority    integer not null default 0,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (provider_id, model_id)
);

drop trigger if exists model_controls_touch on public.model_controls;
create trigger model_controls_touch before update on public.model_controls
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------- ai settings
-- One row, holding the global switch that takes Ugnay AI chat offline.
create table if not exists public.ai_settings (
  id          boolean primary key default true check (id),
  maintenance boolean not null default false,
  message     text not null default 'Ugnay AI is temporarily unavailable for maintenance.',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists ai_settings_touch on public.ai_settings;
create trigger ai_settings_touch before update on public.ai_settings
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------- RLS
-- Both tables are read by routing on every request, so any signed-in account
-- may read them; only an admin may write.
alter table public.model_controls enable row level security;
alter table public.ai_settings    enable row level security;

drop policy if exists "model controls: read"  on public.model_controls;
drop policy if exists "model controls: admin" on public.model_controls;
drop policy if exists "ai settings: read"     on public.ai_settings;
drop policy if exists "ai settings: admin"    on public.ai_settings;

create policy "model controls: read" on public.model_controls
  for select to authenticated using (true);
create policy "model controls: admin" on public.model_controls
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "ai settings: read" on public.ai_settings
  for select to authenticated using (true);
create policy "ai settings: admin" on public.ai_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ======================================================================
-- v0.12 — unified admin dashboard
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- Everything the /admin dashboard shows, in one round trip. Security definer
-- because an admin has to see totals across every account, which RLS rightly
-- hides from the ordinary policies; the is_admin() guard is what replaces it.
-- Only counts and non-sensitive columns are returned — no message content.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'admins', (select count(*) from public.profiles where role = 'admin'),
      'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days')
    ),
    'conversations', jsonb_build_object(
      'chats', (select count(*) from public.chats),
      'messages', (select count(*) from public.messages),
      'messages_7d', (select count(*) from public.messages where created_at >= now() - interval '7 days'),
      'projects', (select count(*) from public.projects),
      'shared', (select count(*) from public.shared_chats where not revoked),
      'by_model', coalesce((
        select jsonb_agg(m) from (
          select coalesce(provider, 'unknown') as provider,
                 coalesce(model, 'unknown') as model,
                 count(*) as messages,
                 coalesce(sum(total_tokens), 0) as total_tokens
          from public.messages
          where role = 'assistant'
          group by 1, 2 order by 3 desc limit 10
        ) m), '[]'::jsonb)
    ),
    'knowledge', jsonb_build_object(
      'files', (select count(*) from public.files),
      'indexed', (select count(*) from public.files where indexed_at is not null),
      'failed', (select count(*) from public.files where index_error is not null),
      'chunks', (select count(*) from public.file_chunks),
      'embeddings', (select count(*) from public.message_embeddings)
    ),
    'training', jsonb_build_object(
      'messages', (select count(*) from public.training_messages),
      'conversations', (select count(distinct conversation_id) from public.training_messages),
      'last_collected_at', (select max(collected_at) from public.training_messages),
      'opted_in', (select count(*) from public.user_settings where improve_model)
    ),
    'feedback', jsonb_build_object(
      'app', (select count(*) from public.app_feedback),
      'up', (select count(*) from public.message_feedback where rating = 'up'),
      'down', (select count(*) from public.message_feedback where rating = 'down')
    ),
    'audit', coalesce((
      select jsonb_agg(a) from (
        select c.provider_id, c.model_id, c.status, c.priority, c.updated_at,
               (select p.email from public.profiles p where p.id = c.updated_by) as updated_by
        from public.model_controls c order by c.updated_at desc limit 20
      ) a), '[]'::jsonb),
    'ai_settings_updated_at', (select updated_at from public.ai_settings where id)
  ) into result;

  return result;
end $$;

revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ======================================================================
-- v0.13 — whole-site maintenance
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- The AI switch takes chat offline; this one takes the whole app offline for
-- everyone but an admin, who keeps working so the site can be fixed.
alter table public.ai_settings add column if not exists site_maintenance boolean not null default false;
-- Empty by default: the maintenance screen shows only what an admin writes.
alter table public.ai_settings add column if not exists site_message text not null default '';

-- The maintenance screen has to render for signed-out visitors too, so the
-- read policy covers anon as well. Only the two switches are exposed; writing
-- still requires an admin.
drop policy if exists "ai settings: read" on public.ai_settings;
create policy "ai settings: read" on public.ai_settings
  for select to anon, authenticated using (true);

-- ======================================================================
-- v0.14 — maintenance window end time
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- When the site is expected back. Null means "no estimate given", and the
-- maintenance screen then simply says nothing about timing.
alter table public.ai_settings add column if not exists site_back_at timestamptz;

-- Clears the generic text rows created before the default became empty, so a
-- project that never set its own message shows the heading alone.
update public.ai_settings
set site_message = ''
where site_message = 'Ugnay is down for maintenance. Please check back shortly.';

-- ======================================================================
-- v0.15 — Ugnay Credits
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Credits are Ugnay's own unit, kept deliberately separate from the token
-- counts providers report: public.messages still records real prompt and
-- completion tokens for usage tracking, and nothing here changes that. Credits
-- are what an account spends to use the paid features, and what it earns back.
--
-- Every balance change goes through the security-definer functions below,
-- inside one transaction, so the balance and the ledger can never disagree and
-- no client can write either directly.

-- ------------------------------------------------------------ credit rules
-- Prices and reward amounts, editable from Admin. A missing row means the
-- feature costs nothing, so an empty table changes no behaviour.
create table if not exists public.credit_rules (
  key         text primary key,
  /* Credits per unit. For spend keys the unit is named by `per`; for reward
     keys it is the amount granted per claim. */
  amount      numeric(12, 4) not null default 0 check (amount >= 0),
  per         text not null default 'claim' check (per in ('message', 'thousand_tokens', 'claim')),
  enabled     boolean not null default true,
  /* Reward keys only: how often a claim is allowed, and how many per day. */
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  daily_limit      integer not null default 0 check (daily_limit >= 0),
  description text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

drop trigger if exists credit_rules_touch on public.credit_rules;
create trigger credit_rules_touch before update on public.credit_rules
  for each row execute function public.touch_updated_at();

-- The rules Ugnay ships with. Existing rows are left alone, so an admin's
-- edits survive re-running this file.
insert into public.credit_rules (key, amount, per, cooldown_seconds, daily_limit, description) values
  ('chat',         1.0000, 'thousand_tokens', 0,  0, 'AI chat, per 1,000 tokens the provider reported'),
  ('web_search',   2.0000, 'message',         0,  0, 'Web search on a message'),
  ('knowledge',    1.0000, 'message',         0,  0, 'Knowledge recall (embedding and passage search)'),
  ('memory',       1.0000, 'message',         0,  0, 'Personalisation with conversation history'),
  ('speech',       1.0000, 'message',         0,  0, 'Reading a reply aloud'),
  ('daily_login', 25.0000, 'claim',       82800,  1, 'Signing in on a new day'),
  ('streak',      10.0000, 'claim',       82800,  1, 'Bonus for consecutive daily claims'),
  ('rewarded_ad', 15.0000, 'claim',         300, 10, 'Watching a rewarded ad, verified server-side')
on conflict (key) do nothing;

-- ----------------------------------------------------------- credit wallet
-- One row per account. The balance is a cache of the ledger, kept in step by
-- the functions that write both.
create table if not exists public.credit_wallets (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  balance      numeric(12, 4) not null default 0 check (balance >= 0),
  total_earned numeric(14, 4) not null default 0,
  total_spent  numeric(14, 4) not null default 0,
  /* Consecutive days the daily reward was claimed, for the streak bonus. */
  streak_days  integer not null default 0,
  last_claim_on date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists credit_wallets_touch on public.credit_wallets;
create trigger credit_wallets_touch before update on public.credit_wallets
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------- credit transactions
-- Append-only: the trigger below refuses every update and delete, including
-- from the definer functions, so the ledger is a record rather than state.
create table if not exists public.credit_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  /* Negative to spend, positive to earn. */
  amount        numeric(12, 4) not null check (amount <> 0),
  kind          text not null check (kind in ('spend', 'earn')),
  /* A credit_rules key, or 'admin_grant'. */
  reason        text not null,
  /* Balance after this row, so a statement never has to be recomputed. */
  balance_after numeric(12, 4) not null,
  /* What it was spent on: provider, model, tokens. Never message content. */
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists credit_transactions_user_idx
  on public.credit_transactions (user_id, created_at desc);

create or replace function public.credit_ledger_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'credit_transactions is append-only';
end $$;

drop trigger if exists credit_transactions_immutable on public.credit_transactions;
create trigger credit_transactions_immutable before update or delete
  on public.credit_transactions
  for each row execute function public.credit_ledger_is_append_only();

-- ------------------------------------------------------------ reward claims
-- One row per granted reward, which is what the cooldown and the daily limit
-- read, and what stops a provider receipt being redeemed twice.
create table if not exists public.credit_reward_claims (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  rule_key    text not null,
  amount      numeric(12, 4) not null,
  /* The reward provider's transaction id, when there is one. */
  external_id text,
  created_at  timestamptz not null default now()
);
create index if not exists credit_reward_claims_user_idx
  on public.credit_reward_claims (user_id, rule_key, created_at desc);
create unique index if not exists credit_reward_claims_external_idx
  on public.credit_reward_claims (rule_key, external_id) where external_id is not null;

-- ----------------------------------------------------------------- wallets
create or replace function public.ensure_credit_wallet(target_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.credit_wallets (user_id) values (target_user)
  on conflict (user_id) do nothing;
$$;

-- Accounts that predate this release get a wallet once.
insert into public.credit_wallets (user_id)
select id from public.profiles on conflict (user_id) do nothing;

-- Same trigger as before, plus the wallet.
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

  insert into public.credit_wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

-- ------------------------------------------------------------- spend/earn
-- Spends credits and returns the new balance, or raises 'insufficient_credits'
-- when the wallet cannot cover it. The wallet row is locked for the
-- transaction, so two concurrent turns cannot both pass the check.
create or replace function public.spend_credits(
  target_user    uuid,
  spend_amount   numeric,
  spend_reason   text,
  spend_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 4);
begin
  if spend_amount is null or spend_amount <= 0 then
    return (select balance from public.credit_wallets where user_id = target_user);
  end if;

  perform public.ensure_credit_wallet(target_user);

  select balance into current_balance
  from public.credit_wallets where user_id = target_user for update;

  if current_balance < spend_amount then
    raise exception 'insufficient_credits' using errcode = 'check_violation';
  end if;

  update public.credit_wallets
  set balance = balance - spend_amount,
      total_spent = total_spent + spend_amount
  where user_id = target_user
  returning balance into current_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, -spend_amount, 'spend', spend_reason, current_balance,
          coalesce(spend_metadata, '{}'::jsonb));

  return current_balance;
end $$;

-- Grants credits. `external_ref` is the reward provider's transaction id; the
-- unique index on it is what makes a replayed callback a no-op.
create or replace function public.grant_credits(
  target_user    uuid,
  grant_amount   numeric,
  grant_reason   text,
  external_ref   text default null,
  grant_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 4);
begin
  if grant_amount is null or grant_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  perform public.ensure_credit_wallet(target_user);
  perform 1 from public.credit_wallets where user_id = target_user for update;

  if exists (select 1 from public.credit_rules where key = grant_reason) then
    insert into public.credit_reward_claims (user_id, rule_key, amount, external_id)
    values (target_user, grant_reason, grant_amount, external_ref);
  end if;

  update public.credit_wallets
  set balance = balance + grant_amount,
      total_earned = total_earned + grant_amount
  where user_id = target_user
  returning balance into new_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, grant_amount, 'earn', grant_reason, new_balance,
          coalesce(grant_metadata, '{}'::jsonb));

  return new_balance;
end $$;

-- Claims the daily login reward, and the streak bonus with it. Idempotent by
-- date: a second call on the same day grants nothing and says so.
create or replace function public.claim_daily_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet        public.credit_wallets;
  daily_amount  numeric(12, 4);
  streak_amount numeric(12, 4);
  today         date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform public.ensure_credit_wallet(auth.uid());
  select * into wallet from public.credit_wallets where user_id = auth.uid() for update;

  select amount into daily_amount from public.credit_rules
  where key = 'daily_login' and enabled;

  if wallet.last_claim_on = today or daily_amount is null then
    return jsonb_build_object('claimed', false, 'granted', 0, 'balance', wallet.balance,
                              'streak', wallet.streak_days);
  end if;

  -- Yesterday continues the streak; any older gap starts it again.
  update public.credit_wallets
  set streak_days = case when wallet.last_claim_on = today - 1 then wallet.streak_days + 1 else 1 end,
      last_claim_on = today
  where user_id = auth.uid()
  returning * into wallet;

  perform public.grant_credits(auth.uid(), daily_amount, 'daily_login', null,
                               jsonb_build_object('day', today));

  -- The streak bonus rides on the daily claim rather than being its own button.
  select amount into streak_amount from public.credit_rules where key = 'streak' and enabled;
  if streak_amount is not null and wallet.streak_days > 1 then
    perform public.grant_credits(auth.uid(), streak_amount, 'streak', null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    streak_amount := 0;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'granted', daily_amount + coalesce(streak_amount, 0),
    'balance', (select balance from public.credit_wallets where user_id = auth.uid()),
    'streak', wallet.streak_days
  );
end $$;

-- --------------------------------------------------------------------- RLS
alter table public.credit_wallets       enable row level security;
alter table public.credit_transactions  enable row level security;
alter table public.credit_reward_claims enable row level security;
alter table public.credit_rules         enable row level security;

drop policy if exists "wallet: own row"     on public.credit_wallets;
drop policy if exists "wallet: admin read"  on public.credit_wallets;
drop policy if exists "ledger: own rows"    on public.credit_transactions;
drop policy if exists "claims: own rows"    on public.credit_reward_claims;
drop policy if exists "credit rules: read"  on public.credit_rules;
drop policy if exists "credit rules: admin" on public.credit_rules;

-- Read-only for the owner: balances are written only by the definer functions.
create policy "wallet: own row" on public.credit_wallets
  for select to authenticated using (auth.uid() = user_id);
create policy "wallet: admin read" on public.credit_wallets
  for select to authenticated using (public.is_admin());
create policy "ledger: own rows" on public.credit_transactions
  for select to authenticated using (auth.uid() = user_id or public.is_admin());
create policy "claims: own rows" on public.credit_reward_claims
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- Prices are read by the wallet UI, so any signed-in account may read them.
create policy "credit rules: read" on public.credit_rules
  for select to authenticated using (true);
create policy "credit rules: admin" on public.credit_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on function public.spend_credits(uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, numeric, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ensure_credit_wallet(uuid) from public, anon, authenticated;
revoke all on function public.claim_daily_credits() from public, anon;
grant execute on function public.claim_daily_credits() to authenticated;

-- ======================================================================
-- v0.16 — credit achievements, and the reward callback's own path in
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================

-- ---------------------------------------------------------- achievements
-- Streak milestones, paid once each time the streak reaches them. Same rules
-- table, same ledger — an achievement is simply a reward with its own key, so
-- an admin edits or disables it like any other.
insert into public.credit_rules (key, amount, per, cooldown_seconds, daily_limit, description) values
  ('streak_7',   50.0000, 'claim', 0, 1, 'Achievement: a 7-day streak'),
  ('streak_30', 250.0000, 'claim', 0, 1, 'Achievement: a 30-day streak')
on conflict (key) do nothing;

-- The daily claim, plus the milestone payouts. The daily reward and the
-- ordinary streak bonus behave exactly as before; a milestone is granted only
-- on the day the streak reaches it, and only while its rule is enabled.
create or replace function public.claim_daily_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet          public.credit_wallets;
  daily_amount    numeric(12, 4);
  streak_amount   numeric(12, 4);
  milestone_key   text;
  milestone_amount numeric(12, 4);
  today           date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform public.ensure_credit_wallet(auth.uid());
  select * into wallet from public.credit_wallets where user_id = auth.uid() for update;

  select amount into daily_amount from public.credit_rules
  where key = 'daily_login' and enabled;

  if wallet.last_claim_on = today or daily_amount is null then
    return jsonb_build_object('claimed', false, 'granted', 0, 'balance', wallet.balance,
                              'streak', wallet.streak_days);
  end if;

  -- Yesterday continues the streak; any older gap starts it again.
  update public.credit_wallets
  set streak_days = case when wallet.last_claim_on = today - 1 then wallet.streak_days + 1 else 1 end,
      last_claim_on = today
  where user_id = auth.uid()
  returning * into wallet;

  perform public.grant_credits(auth.uid(), daily_amount, 'daily_login', null,
                               jsonb_build_object('day', today));

  -- The streak bonus rides on the daily claim rather than being its own button.
  select amount into streak_amount from public.credit_rules where key = 'streak' and enabled;
  if streak_amount is not null and wallet.streak_days > 1 then
    perform public.grant_credits(auth.uid(), streak_amount, 'streak', null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    streak_amount := 0;
  end if;

  -- A milestone the streak has just reached, if there is a rule for it.
  milestone_key := 'streak_' || wallet.streak_days::text;
  select amount into milestone_amount from public.credit_rules
  where key = milestone_key and enabled;
  if milestone_amount is not null then
    perform public.grant_credits(auth.uid(), milestone_amount, milestone_key, null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    milestone_amount := 0;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'granted', daily_amount + coalesce(streak_amount, 0) + coalesce(milestone_amount, 0),
    'balance', (select balance from public.credit_wallets where user_id = auth.uid()),
    'streak', wallet.streak_days,
    'milestone', case when coalesce(milestone_amount, 0) > 0 then milestone_key end
  );
end $$;

revoke all on function public.claim_daily_credits() from public, anon;
grant execute on function public.claim_daily_credits() to authenticated;

-- ======================================================================
-- v0.17 — the credit functions are callable by the routes that use them
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- v0.15 revoked EXECUTE on spend_credits/grant_credits from `authenticated`,
-- but the API routes call them with the caller's own Supabase client, which is
-- exactly that role — so every chat charge failed with "permission denied" and
-- nothing was ever written to the wallet or the ledger.
--
-- Granting EXECUTE alone would be worse than the bug: any client could then
-- spend another account's balance, or grant itself credits. So the check moves
-- inside the functions, where it belongs:
--
--   spend_credits  — a signed-in caller may only ever spend their own wallet.
--   grant_credits  — a signed-in caller must be an admin.
--
-- A caller with no auth.uid() is the service role (the rewarded-ad callback),
-- which has already proved itself with the network's signature.

create or replace function public.spend_credits(
  target_user    uuid,
  spend_amount   numeric,
  spend_reason   text,
  spend_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 4);
begin
  -- Pinned to the caller: a signed-in account can only spend its own credits.
  if auth.uid() is not null and target_user is distinct from auth.uid() then
    raise exception 'a caller may only spend their own credits';
  end if;

  if spend_amount is null or spend_amount <= 0 then
    return (select balance from public.credit_wallets where user_id = target_user);
  end if;

  perform public.ensure_credit_wallet(target_user);

  select balance into current_balance
  from public.credit_wallets where user_id = target_user for update;

  if current_balance < spend_amount then
    raise exception 'insufficient_credits' using errcode = 'check_violation';
  end if;

  update public.credit_wallets
  set balance = balance - spend_amount,
      total_spent = total_spent + spend_amount
  where user_id = target_user
  returning balance into current_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, -spend_amount, 'spend', spend_reason, current_balance,
          coalesce(spend_metadata, '{}'::jsonb));

  return current_balance;
end $$;

create or replace function public.grant_credits(
  target_user    uuid,
  grant_amount   numeric,
  grant_reason   text,
  external_ref   text default null,
  grant_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 4);
begin
  -- Only an admin may hand out credits. The daily claim and the streak bonus
  -- reach this through claim_daily_credits(), which is a definer function and
  -- therefore not a "signed-in caller" here.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may grant credits';
  end if;

  if grant_amount is null or grant_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  perform public.ensure_credit_wallet(target_user);
  perform 1 from public.credit_wallets where user_id = target_user for update;

  if exists (select 1 from public.credit_rules where key = grant_reason) then
    insert into public.credit_reward_claims (user_id, rule_key, amount, external_id)
    values (target_user, grant_reason, grant_amount, external_ref);
  end if;

  update public.credit_wallets
  set balance = balance + grant_amount,
      total_earned = total_earned + grant_amount
  where user_id = target_user
  returning balance into new_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, grant_amount, 'earn', grant_reason, new_balance,
          coalesce(grant_metadata, '{}'::jsonb));

  return new_balance;
end $$;

-- claim_daily_credits() calls grant_credits() while running as the definer, so
-- auth.uid() is still the claimer inside it. It is the one legitimate case of a
-- signed-in non-admin granting, and it is why the daily reward has always
-- worked: give it its own path rather than loosening the check above.
create or replace function public.claim_daily_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet           public.credit_wallets;
  daily_amount     numeric(12, 4);
  streak_amount    numeric(12, 4);
  milestone_key    text;
  milestone_amount numeric(12, 4);
  today            date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform public.ensure_credit_wallet(auth.uid());
  select * into wallet from public.credit_wallets where user_id = auth.uid() for update;

  select amount into daily_amount from public.credit_rules
  where key = 'daily_login' and enabled;

  if wallet.last_claim_on = today or daily_amount is null then
    return jsonb_build_object('claimed', false, 'granted', 0, 'balance', wallet.balance,
                              'streak', wallet.streak_days);
  end if;

  update public.credit_wallets
  set streak_days = case when wallet.last_claim_on = today - 1 then wallet.streak_days + 1 else 1 end,
      last_claim_on = today
  where user_id = auth.uid()
  returning * into wallet;

  perform public.award_credits(auth.uid(), daily_amount, 'daily_login', null,
                               jsonb_build_object('day', today));

  select amount into streak_amount from public.credit_rules where key = 'streak' and enabled;
  if streak_amount is not null and wallet.streak_days > 1 then
    perform public.award_credits(auth.uid(), streak_amount, 'streak', null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    streak_amount := 0;
  end if;

  milestone_key := 'streak_' || wallet.streak_days::text;
  select amount into milestone_amount from public.credit_rules
  where key = milestone_key and enabled;
  if milestone_amount is not null then
    perform public.award_credits(auth.uid(), milestone_amount, milestone_key, null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    milestone_amount := 0;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'granted', daily_amount + coalesce(streak_amount, 0) + coalesce(milestone_amount, 0),
    'balance', (select balance from public.credit_wallets where user_id = auth.uid()),
    'streak', wallet.streak_days,
    'milestone', case when coalesce(milestone_amount, 0) > 0 then milestone_key end
  );
end $$;

-- The unchecked award used by claim_daily_credits(). Same wallet, same ledger,
-- same shape as grant_credits() — it simply has no caller check of its own,
-- which is why nothing may execute it directly.
create or replace function public.award_credits(
  target_user    uuid,
  grant_amount   numeric,
  grant_reason   text,
  external_ref   text default null,
  grant_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 4);
begin
  if grant_amount is null or grant_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  perform public.ensure_credit_wallet(target_user);
  perform 1 from public.credit_wallets where user_id = target_user for update;

  if exists (select 1 from public.credit_rules where key = grant_reason) then
    insert into public.credit_reward_claims (user_id, rule_key, amount, external_id)
    values (target_user, grant_reason, grant_amount, external_ref);
  end if;

  update public.credit_wallets
  set balance = balance + grant_amount,
      total_earned = total_earned + grant_amount
  where user_id = target_user
  returning balance into new_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, grant_amount, 'earn', grant_reason, new_balance,
          coalesce(grant_metadata, '{}'::jsonb));

  return new_balance;
end $$;

-- Who may call what.
revoke all on function public.award_credits(uuid, numeric, text, text, jsonb)
  from public, anon, authenticated;

revoke all on function public.spend_credits(uuid, numeric, text, jsonb) from public, anon;
grant execute on function public.spend_credits(uuid, numeric, text, jsonb) to authenticated;

revoke all on function public.grant_credits(uuid, numeric, text, text, jsonb) from public, anon;
grant execute on function public.grant_credits(uuid, numeric, text, text, jsonb) to authenticated;

-- The rewarded-ad callback has no session; it calls in as the service role.
grant execute on function public.grant_credits(uuid, numeric, text, text, jsonb) to service_role;
grant execute on function public.spend_credits(uuid, numeric, text, jsonb) to service_role;

-- ======================================================================
-- v0.18 — Tasks & Rewards
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- A task is a thing an account has actually done — a workspace created, a file
-- indexed, a first message sent. Completion is never asserted by the client:
-- every task names a check that is run in the database against the account's
-- own rows, and the reward is paid through award_credits(), so it lands in the
-- same wallet and the same append-only ledger as every other credit.
--
-- Nothing here touches the daily claim, the streak bonus, the achievements or
-- the rewarded ads; they keep their own rules and their own paths.

-- ------------------------------------------------------------ credit tasks
create table if not exists public.credit_tasks (
  key         text primary key,
  title       text not null,
  description text not null default '',
  amount      numeric(12, 4) not null default 0 check (amount >= 0),
  enabled     boolean not null default true,
  /* One-time unless repeatable; a repeatable task pays again once its
     cooldown has passed, up to daily_limit times a day. */
  repeatable  boolean not null default false,
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  daily_limit      integer not null default 0 check (daily_limit >= 0),
  /* Where the account goes to do it, when there is somewhere to go. */
  action_href text,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

drop trigger if exists credit_tasks_touch on public.credit_tasks;
create trigger credit_tasks_touch before update on public.credit_tasks
  for each row execute function public.touch_updated_at();

-- The tasks Ugnay ships with. Each key is matched by a check in
-- credit_task_progress() below; a key with no check can never complete, which
-- is why new tasks are added in both places or not at all.
insert into public.credit_tasks
  (key, title, description, amount, repeatable, cooldown_seconds, daily_limit, action_href, sort_order)
values
  ('profile_complete', 'Complete your profile',
   'Add a display name and a preferred short name in Settings.', 20.0000,
   false, 0, 0, null, 10),
  ('first_message', 'Send your first message',
   'Ask Ugnay anything and read the reply.', 20.0000,
   false, 0, 0, null, 20),
  ('first_workspace', 'Create a workspace',
   'Group related conversations under a project with its own instructions.', 30.0000,
   false, 0, 0, null, 30),
  ('first_knowledge_file', 'Upload a Knowledge file',
   'Upload a document so Ugnay can answer from it.', 40.0000,
   false, 0, 0, '/knowledge', 40),
  ('first_prompt', 'Save a prompt',
   'Keep a prompt you use often in the prompt library.', 20.0000,
   false, 0, 0, null, 50),
  ('first_workflow', 'Build a workflow',
   'Chain a few prompts into a workflow you can run again.', 30.0000,
   false, 0, 0, '/workflows', 60),
  ('first_share', 'Share a conversation',
   'Publish a read-only link to a conversation.', 20.0000,
   false, 0, 0, null, 70),
  ('first_feedback', 'Send feedback',
   'Tell us what to build or fix next.', 15.0000,
   false, 0, 0, '/feedback', 80),
  ('daily_conversation', 'Hold a conversation today',
   'Send at least three messages in a day.', 10.0000,
   true, 82800, 1, null, 90)
on conflict (key) do nothing;

-- ------------------------------------------------------ credit task claims
-- One row per payout. The partial unique index is what makes a one-time task
-- one-time: a second insert for the same account and key is refused by the
-- database, not by the code that calls it.
create table if not exists public.credit_task_claims (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_key   text not null references public.credit_tasks(key) on delete cascade,
  amount     numeric(12, 4) not null,
  /* Null for a one-time claim; the UTC day for a repeatable one, so a day's
     allowance is enforced by the same unique index. */
  claimed_on date,
  created_at timestamptz not null default now()
);
create index if not exists credit_task_claims_user_idx
  on public.credit_task_claims (user_id, task_key, created_at desc);
create unique index if not exists credit_task_claims_once_idx
  on public.credit_task_claims (user_id, task_key) where claimed_on is null;

-- ------------------------------------------------------------- progress
-- Has the caller actually done each task? Every answer is a count over the
-- account's own rows — the client says nothing and is believed about nothing.
create or replace function public.credit_task_progress()
returns table (task_key text, done boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.key,
         case t.key
           when 'profile_complete' then exists (
             select 1 from public.profiles p
             where p.id = auth.uid()
               and coalesce(p.display_name, '') <> ''
               and coalesce(p.nickname, '') <> ''
           )
           when 'first_message' then exists (
             select 1 from public.messages m
             where m.user_id = auth.uid() and m.role = 'assistant'
           )
           when 'first_workspace' then exists (
             select 1 from public.projects p where p.user_id = auth.uid()
           )
           when 'first_knowledge_file' then exists (
             select 1 from public.files f
             where f.user_id = auth.uid() and f.indexed_at is not null
           )
           when 'first_prompt' then exists (
             select 1 from public.prompts p where p.user_id = auth.uid()
           )
           when 'first_workflow' then exists (
             select 1 from public.workflows w where w.user_id = auth.uid()
           )
           when 'first_share' then exists (
             select 1 from public.shared_chats s
             where s.user_id = auth.uid() and not s.revoked
           )
           when 'first_feedback' then exists (
             select 1 from public.app_feedback a where a.user_id = auth.uid()
           )
           when 'daily_conversation' then (
             select count(*) >= 3 from public.messages m
             where m.user_id = auth.uid()
               and m.role = 'user'
               and m.created_at >= date_trunc('day', now() at time zone 'utc')
           )
           else false
         end as done
  from public.credit_tasks t
  where t.enabled
$$;

grant execute on function public.credit_task_progress() to authenticated;

-- ---------------------------------------------------------------- claiming
-- Claims one task for the caller. The wallet row is locked first, so two
-- requests racing each other queue rather than both pay; the unique index is
-- the backstop if they somehow do not.
create or replace function public.claim_credit_task(task text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rule         public.credit_tasks;
  is_done      boolean;
  today        date := (now() at time zone 'utc')::date;
  claims_today integer;
  last_claim   timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into rule from public.credit_tasks where key = task and enabled;
  if rule is null then
    return jsonb_build_object('claimed', false, 'reason', 'That task is not available.');
  end if;

  -- Serialise this account's claims against each other.
  perform public.ensure_credit_wallet(auth.uid());
  perform 1 from public.credit_wallets where user_id = auth.uid() for update;

  select p.done into is_done from public.credit_task_progress() p where p.task_key = task;
  if not coalesce(is_done, false) then
    return jsonb_build_object('claimed', false, 'reason', 'That task is not finished yet.');
  end if;

  if not rule.repeatable then
    if exists (
      select 1 from public.credit_task_claims
      where user_id = auth.uid() and task_key = task and claimed_on is null
    ) then
      return jsonb_build_object('claimed', false, 'reason', 'Already claimed.');
    end if;

    insert into public.credit_task_claims (user_id, task_key, amount, claimed_on)
    values (auth.uid(), task, rule.amount, null);
  else
    if rule.cooldown_seconds > 0 then
      select max(created_at) into last_claim from public.credit_task_claims
      where user_id = auth.uid() and task_key = task;
      if last_claim is not null
         and last_claim > now() - make_interval(secs => rule.cooldown_seconds) then
        return jsonb_build_object('claimed', false, 'reason', 'Not yet — come back later.');
      end if;
    end if;

    if rule.daily_limit > 0 then
      select count(*) into claims_today from public.credit_task_claims
      where user_id = auth.uid() and task_key = task and claimed_on = today;
      if claims_today >= rule.daily_limit then
        return jsonb_build_object('claimed', false, 'reason', 'Already claimed today.');
      end if;
    end if;

    insert into public.credit_task_claims (user_id, task_key, amount, claimed_on)
    values (auth.uid(), task, rule.amount, today);
  end if;

  -- Paid through the same internal award as the daily claim: one wallet, one
  -- ledger, one place a balance can change.
  perform public.award_credits(auth.uid(), rule.amount, 'task:' || task, null,
                               jsonb_build_object('task', task));

  return jsonb_build_object(
    'claimed', true,
    'granted', rule.amount,
    'balance', (select balance from public.credit_wallets where user_id = auth.uid())
  );
end $$;

revoke all on function public.claim_credit_task(text) from public, anon;
grant execute on function public.claim_credit_task(text) to authenticated;

-- --------------------------------------------------------------------- RLS
alter table public.credit_tasks       enable row level security;
alter table public.credit_task_claims enable row level security;

drop policy if exists "credit tasks: read"   on public.credit_tasks;
drop policy if exists "credit tasks: admin"  on public.credit_tasks;
drop policy if exists "task claims: own rows" on public.credit_task_claims;

-- The task list is shown in the wallet, so any signed-in account may read it;
-- only an admin may change what a task pays or whether it runs at all.
create policy "credit tasks: read" on public.credit_tasks
  for select to authenticated using (true);
create policy "credit tasks: admin" on public.credit_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Claims are readable by their owner and by an admin, and written only by the
-- definer function above.
create policy "task claims: own rows" on public.credit_task_claims
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- ======================================================================
-- v0.19 — signup credits, a persistent reward identity, admin entitlement
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Rewards are worth farming: delete the account, sign up again, claim the
-- signup bonus and every one-time task a second time. Preventing that needs
-- something that outlives auth.users(id) — but as little of it as possible.
--
-- credit_identities holds exactly one column of substance: a SHA-256 hash of
-- "provider:subject". For an OAuth account the subject is the provider's own
-- stable identifier for that person; for a password account, where there is no
-- such subject, it is the normalised email — hashed, never stored in the clear,
-- and never used on its own as a key. No name, no email, no token, no profile
-- data survives a deletion here; the hash cannot be turned back into an address
-- and is useful for nothing but answering "has this identity claimed already?".

-- ------------------------------------------------------- credit identities
create table if not exists public.credit_identities (
  identity_hash    text primary key,
  /* The account using this identity now, if any. Cleared, not cascaded, when
     the account is deleted — the row is the whole point. */
  current_user_id  uuid references auth.users(id) on delete set null,
  signup_claimed_at timestamptz,
  /* Repeatable rewards are limited per identity as well as per wallet, so a
     recreated account cannot claim today's credits twice. */
  last_daily_on    date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists credit_identities_touch on public.credit_identities;
create trigger credit_identities_touch before update on public.credit_identities
  for each row execute function public.touch_updated_at();

-- The caller's stable identity, created on first sight. Security definer
-- because auth.identities is not readable by an ordinary role; only the hash
-- ever leaves this function.
create or replace function public.credit_identity(target_user uuid default null)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  who     uuid := coalesce(target_user, auth.uid());
  subject text;
  hashed  text;
begin
  if who is null then
    raise exception 'authentication required';
  end if;
  -- A signed-in caller may only ever ask about itself; a caller with no
  -- auth.uid() is the service role, which asks on the ad network's behalf.
  if auth.uid() is not null and who is distinct from auth.uid() then
    raise exception 'a caller may only read their own identity';
  end if;

  -- Prefer a real OAuth subject: it is the provider's own stable id for this
  -- person and survives an Ugnay account being deleted and made again.
  select i.provider || ':' || i.provider_id into subject
  from auth.identities i
  where i.user_id = who and i.provider <> 'email'
  order by i.created_at
  limit 1;

  -- No OAuth identity: fall back to the normalised email, which is hashed with
  -- the provider name exactly like the subject above.
  if subject is null then
    select 'email:' || lower(trim(u.email)) into subject
    from auth.users u where u.id = who;
  end if;

  if subject is null then
    return null;
  end if;

  -- sha256() is a Postgres built-in, so this does not depend on pgcrypto
  -- being on the search_path (on Supabase it lives in the extensions schema).
  hashed := encode(sha256(convert_to('ugnay-credit-identity:' || subject, 'UTF8')), 'hex');

  insert into public.credit_identities (identity_hash, current_user_id)
  values (hashed, who)
  on conflict (identity_hash) do update set current_user_id = excluded.current_user_id;

  return hashed;
end $$;

revoke all on function public.credit_identity(uuid) from public, anon;
grant execute on function public.credit_identity(uuid) to authenticated, service_role;

-- --------------------------------------------------------- signup reward
insert into public.credit_rules (key, amount, per, cooldown_seconds, daily_limit, description)
values ('signup', 100.0000, 'claim', 0, 0, 'Welcome bonus for a new account')
on conflict (key) do nothing;

-- Pays the welcome bonus once per identity, ever. Called when the wallet is
-- read, so it lands whether the account signed up with a password or through a
-- provider — by which time the OAuth identity row certainly exists.
create or replace function public.claim_signup_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  identity text;
  amount_due numeric(12, 4);
  already  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select amount into amount_due from public.credit_rules where key = 'signup' and enabled;
  if amount_due is null or amount_due <= 0 then
    return jsonb_build_object('claimed', false);
  end if;

  identity := public.credit_identity();
  if identity is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Locked, so two first loads in two tabs cannot both pay.
  select signup_claimed_at into already from public.credit_identities
  where identity_hash = identity for update;
  if already is not null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.credit_identities
  set signup_claimed_at = now()
  where identity_hash = identity;

  perform public.award_credits(auth.uid(), amount_due, 'signup', null,
                               jsonb_build_object('identity', identity));

  return jsonb_build_object(
    'claimed', true,
    'granted', amount_due,
    'balance', (select balance from public.credit_wallets where user_id = auth.uid())
  );
end $$;

revoke all on function public.claim_signup_credits() from public, anon;
grant execute on function public.claim_signup_credits() to authenticated;

-- ------------------------------------- claims survive an account deletion
-- The claim rows are what make a one-time reward one-time, so they must outlive
-- the account. user_id becomes a courtesy column: it is cleared on deletion,
-- and identity_hash is what the uniqueness is enforced on from here.
alter table public.credit_task_claims add column if not exists identity_hash text;
alter table public.credit_reward_claims add column if not exists identity_hash text;

do $$
begin
  alter table public.credit_task_claims alter column user_id drop not null;
  alter table public.credit_task_claims drop constraint if exists credit_task_claims_user_id_fkey;
  alter table public.credit_task_claims add constraint credit_task_claims_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

  alter table public.credit_reward_claims alter column user_id drop not null;
  alter table public.credit_reward_claims drop constraint if exists credit_reward_claims_user_id_fkey;
  alter table public.credit_reward_claims add constraint credit_reward_claims_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;
end $$;

-- Backfill the identity for rows written before this release, where the account
-- still exists to resolve it from.
update public.credit_task_claims c
set identity_hash = public.credit_identity(c.user_id)
where c.identity_hash is null and c.user_id is not null;

update public.credit_reward_claims c
set identity_hash = public.credit_identity(c.user_id)
where c.identity_hash is null and c.user_id is not null;

create index if not exists credit_task_claims_identity_idx
  on public.credit_task_claims (identity_hash, task_key, created_at desc);
create index if not exists credit_reward_claims_identity_idx
  on public.credit_reward_claims (identity_hash, rule_key, created_at desc);

-- One-time now means one-time per identity, not per account.
drop index if exists public.credit_task_claims_once_idx;
create unique index if not exists credit_task_claims_once_identity_idx
  on public.credit_task_claims (identity_hash, task_key) where claimed_on is null;

-- ------------------------------------------------- claiming, by identity
create or replace function public.claim_credit_task(task text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rule         public.credit_tasks;
  identity     text;
  is_done      boolean;
  today        date := (now() at time zone 'utc')::date;
  claims_today integer;
  last_claim   timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into rule from public.credit_tasks where key = task and enabled;
  if rule is null then
    return jsonb_build_object('claimed', false, 'reason', 'That task is not available.');
  end if;

  identity := public.credit_identity();

  perform public.ensure_credit_wallet(auth.uid());
  perform 1 from public.credit_wallets where user_id = auth.uid() for update;

  select p.done into is_done from public.credit_task_progress() p where p.task_key = task;
  if not coalesce(is_done, false) then
    return jsonb_build_object('claimed', false, 'reason', 'That task is not finished yet.');
  end if;

  if not rule.repeatable then
    if exists (
      select 1 from public.credit_task_claims
      where identity_hash = identity and task_key = task and claimed_on is null
    ) then
      return jsonb_build_object('claimed', false, 'reason', 'Already claimed.');
    end if;

    insert into public.credit_task_claims (user_id, identity_hash, task_key, amount, claimed_on)
    values (auth.uid(), identity, task, rule.amount, null);
  else
    if rule.cooldown_seconds > 0 then
      select max(created_at) into last_claim from public.credit_task_claims
      where identity_hash = identity and task_key = task;
      if last_claim is not null
         and last_claim > now() - make_interval(secs => rule.cooldown_seconds) then
        return jsonb_build_object('claimed', false, 'reason', 'Not yet — come back later.');
      end if;
    end if;

    if rule.daily_limit > 0 then
      select count(*) into claims_today from public.credit_task_claims
      where identity_hash = identity and task_key = task and claimed_on = today;
      if claims_today >= rule.daily_limit then
        return jsonb_build_object('claimed', false, 'reason', 'Already claimed today.');
      end if;
    end if;

    insert into public.credit_task_claims (user_id, identity_hash, task_key, amount, claimed_on)
    values (auth.uid(), identity, task, rule.amount, today);
  end if;

  perform public.award_credits(auth.uid(), rule.amount, 'task:' || task, null,
                               jsonb_build_object('task', task));

  return jsonb_build_object(
    'claimed', true,
    'granted', rule.amount,
    'balance', (select balance from public.credit_wallets where user_id = auth.uid())
  );
end $$;

revoke all on function public.claim_credit_task(text) from public, anon;
grant execute on function public.claim_credit_task(text) to authenticated;

-- award_credits stamps the identity on every reward claim it records, so the
-- ad network's per-identity limits survive a deletion too.
create or replace function public.award_credits(
  target_user    uuid,
  grant_amount   numeric,
  grant_reason   text,
  external_ref   text default null,
  grant_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 4);
begin
  if grant_amount is null or grant_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  perform public.ensure_credit_wallet(target_user);
  perform 1 from public.credit_wallets where user_id = target_user for update;

  if exists (select 1 from public.credit_rules where key = grant_reason) then
    insert into public.credit_reward_claims (user_id, identity_hash, rule_key, amount, external_id)
    values (target_user, public.credit_identity(target_user), grant_reason, grant_amount, external_ref);
  end if;

  update public.credit_wallets
  set balance = balance + grant_amount,
      total_earned = total_earned + grant_amount
  where user_id = target_user
  returning balance into new_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, grant_amount, 'earn', grant_reason, new_balance,
          coalesce(grant_metadata, '{}'::jsonb));

  return new_balance;
end $$;

revoke all on function public.award_credits(uuid, numeric, text, text, jsonb)
  from public, anon, authenticated;

-- The daily claim also checks the identity, so deleting an account no longer
-- hands out a second helping of today's credits. Everything else about it —
-- the streak, the milestones, the amounts — is exactly as before.
create or replace function public.claim_daily_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet           public.credit_wallets;
  identity         text;
  identity_day     date;
  daily_amount     numeric(12, 4);
  streak_amount    numeric(12, 4);
  milestone_key    text;
  milestone_amount numeric(12, 4);
  today            date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform public.ensure_credit_wallet(auth.uid());
  select * into wallet from public.credit_wallets where user_id = auth.uid() for update;

  identity := public.credit_identity();
  select last_daily_on into identity_day from public.credit_identities
  where identity_hash = identity;

  select amount into daily_amount from public.credit_rules
  where key = 'daily_login' and enabled;

  if wallet.last_claim_on = today or identity_day = today or daily_amount is null then
    return jsonb_build_object('claimed', false, 'granted', 0, 'balance', wallet.balance,
                              'streak', wallet.streak_days);
  end if;

  update public.credit_wallets
  set streak_days = case when wallet.last_claim_on = today - 1 then wallet.streak_days + 1 else 1 end,
      last_claim_on = today
  where user_id = auth.uid()
  returning * into wallet;

  update public.credit_identities set last_daily_on = today where identity_hash = identity;

  perform public.award_credits(auth.uid(), daily_amount, 'daily_login', null,
                               jsonb_build_object('day', today));

  select amount into streak_amount from public.credit_rules where key = 'streak' and enabled;
  if streak_amount is not null and wallet.streak_days > 1 then
    perform public.award_credits(auth.uid(), streak_amount, 'streak', null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    streak_amount := 0;
  end if;

  milestone_key := 'streak_' || wallet.streak_days::text;
  select amount into milestone_amount from public.credit_rules
  where key = milestone_key and enabled;
  if milestone_amount is not null then
    perform public.award_credits(auth.uid(), milestone_amount, milestone_key, null,
                                 jsonb_build_object('streak_days', wallet.streak_days));
  else
    milestone_amount := 0;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'granted', daily_amount + coalesce(streak_amount, 0) + coalesce(milestone_amount, 0),
    'balance', (select balance from public.credit_wallets where user_id = auth.uid()),
    'streak', wallet.streak_days,
    'milestone', case when coalesce(milestone_amount, 0) > 0 then milestone_key end
  );
end $$;

revoke all on function public.claim_daily_credits() from public, anon;
grant execute on function public.claim_daily_credits() to authenticated;

-- A one-time task already claimed by this identity reads as claimed, even for
-- a freshly created account that has no rows of its own.
create or replace function public.credit_task_claimed()
returns table (task_key text, claimed_on date, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.task_key, c.claimed_on, c.created_at
  from public.credit_task_claims c
  where c.identity_hash = public.credit_identity()
$$;

grant execute on function public.credit_task_claimed() to authenticated;

-- --------------------------------------------------------------------- RLS
-- Nothing reads this table directly: it is reached only through the definer
-- functions above, which is why it has RLS on and no policy at all.
alter table public.credit_identities enable row level security;
revoke all on public.credit_identities from anon, authenticated;

-- ======================================================================
-- v0.20 — the reward and task amounts Ugnay actually ships with
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- The earlier releases seeded amounts that were too generous once the economy
-- was priced properly. Rows are inserted for any project that does not have
-- them yet, and the shipped defaults are corrected — but only where the row
-- still holds the value it was seeded with. An amount an admin has since
-- changed is theirs, and is left exactly as they set it.

-- ------------------------------------------------------------ new rows
insert into public.credit_rules (key, amount, per, cooldown_seconds, daily_limit, description) values
  ('signup', 25.0000, 'claim', 0, 0, 'Welcome bonus for a new account')
on conflict (key) do nothing;

-- ------------------------------------------------- corrected seed values
-- (key, old seeded amount, new amount)
do $$
declare
  seed record;
begin
  for seed in
    select * from (values
      ('signup',      100.0000,  25.0000),
      ('daily_login',  25.0000,  10.0000),
      ('rewarded_ad',  15.0000,   5.0000),
      ('streak',       10.0000,  10.0000),
      ('streak_7',     50.0000,  25.0000),
      ('streak_30',   250.0000, 100.0000)
    ) as t(key, was, now_amount)
  loop
    update public.credit_rules
    set amount = seed.now_amount
    where key = seed.key and amount = seed.was and amount <> seed.now_amount;
  end loop;
end $$;

-- Rewarded ads are the one reward with a real cost behind it, so they are
-- capped rather than left open. Corrected only from the value it was seeded
-- with, like the amounts above.
update public.credit_rules
set daily_limit = 3
where key = 'rewarded_ad' and daily_limit = 10;

-- A zero daily limit means "no limit", which is right for a reward that is
-- gated some other way and wrong for an ad. This is the guard that keeps an
-- accidental 0 from turning ads into an open tap.
create or replace function public.guard_credit_rule_limits()
returns trigger language plpgsql as $$
begin
  if new.key = 'rewarded_ad' and coalesce(new.daily_limit, 0) < 1 then
    raise exception 'rewarded ads need a daily limit of at least 1';
  end if;
  return new;
end $$;

drop trigger if exists credit_rules_guard_limits on public.credit_rules;
create trigger credit_rules_guard_limits before insert or update on public.credit_rules
  for each row execute function public.guard_credit_rule_limits();

-- Any project that already stored 0 is repaired before the guard can bite.
update public.credit_rules set daily_limit = 3
where key = 'rewarded_ad' and coalesce(daily_limit, 0) < 1;

-- --------------------------------------------------------- task amounts
insert into public.credit_tasks
  (key, title, description, amount, repeatable, cooldown_seconds, daily_limit, action_href, sort_order)
values
  ('profile_complete', 'Complete your profile',
   'Add a display name and a preferred short name in Settings.', 5.0000,
   false, 0, 0, null, 10),
  ('first_message', 'Send your first message',
   'Ask Ugnay anything and read the reply.', 5.0000,
   false, 0, 0, null, 20),
  ('first_workspace', 'Create a workspace',
   'Group related conversations under a project with its own instructions.', 10.0000,
   false, 0, 0, null, 30),
  ('first_knowledge_file', 'Upload a Knowledge file',
   'Upload a document so Ugnay can answer from it.', 20.0000,
   false, 0, 0, '/knowledge', 40),
  ('first_prompt', 'Save a prompt',
   'Keep a prompt you use often in the prompt library.', 5.0000,
   false, 0, 0, null, 50),
  ('first_workflow', 'Build a workflow',
   'Chain a few prompts into a workflow you can run again.', 5.0000,
   false, 0, 0, '/workflows', 60),
  ('first_share', 'Share a conversation',
   'Publish a read-only link to a conversation.', 5.0000,
   false, 0, 0, null, 70),
  ('first_feedback', 'Send feedback',
   'Tell us what to build or fix next.', 5.0000,
   false, 0, 0, '/feedback', 80),
  ('daily_conversation', 'Hold a conversation today',
   'Send at least three messages in a day.', 5.0000,
   true, 82800, 1, null, 90)
on conflict (key) do nothing;

do $$
declare
  seed record;
begin
  for seed in
    select * from (values
      ('profile_complete',    20.0000,  5.0000),
      ('first_message',       20.0000,  5.0000),
      ('first_workspace',     30.0000, 10.0000),
      ('first_knowledge_file',40.0000, 20.0000),
      ('first_prompt',        20.0000,  5.0000),
      ('first_workflow',      30.0000,  5.0000),
      ('first_share',         20.0000,  5.0000),
      ('first_feedback',      15.0000,  5.0000),
      ('daily_conversation',  10.0000,  5.0000)
    ) as t(key, was, now_amount)
  loop
    update public.credit_tasks
    set amount = seed.now_amount
    where key = seed.key and amount = seed.was and amount <> seed.now_amount;
  end loop;
end $$;

-- The one repeatable task stays at one claim a day, whatever else changes.
update public.credit_tasks
set daily_limit = 1
where key = 'daily_conversation' and repeatable and coalesce(daily_limit, 0) < 1;

-- ======================================================================
-- v0.21 — buying credits: packages, orders, manual verification
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Paid credits sit alongside the free ones rather than replacing them: the
-- same wallet, the same append-only ledger, the same award path. What is new
-- is an order — a record of someone saying "I have paid" — which is worth
-- nothing until a human with the admin role says otherwise.
--
-- Nothing here verifies a payment automatically. PayPal shows the configured
-- destination and waits; GCash shows the account and takes a reference number.
-- Both land in 'submitted' and stay there until an admin approves or rejects.
-- The provider column is what a real PayPal API integration would later hook
-- into, without touching the order shape or the granting path.

-- --------------------------------------------------------- credit packages
create table if not exists public.credit_packages (
  key         text primary key,
  title       text not null,
  credits     numeric(12, 4) not null check (credits > 0),
  /* Minor units of `currency` — 19900 is ₱199.00. Integers only: money is
     never a float here. */
  price_cents integer not null check (price_cents >= 0),
  currency    text not null default 'PHP',
  enabled     boolean not null default true,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

drop trigger if exists credit_packages_touch on public.credit_packages;
create trigger credit_packages_touch before update on public.credit_packages
  for each row execute function public.touch_updated_at();

insert into public.credit_packages (key, title, credits, price_cents, currency, sort_order) values
  ('credits_500',   '500 credits',    500.0000,   4900, 'PHP', 10),
  ('credits_1000',  '1,000 credits', 1000.0000,   9900, 'PHP', 20),
  ('credits_2500',  '2,500 credits', 2500.0000,  22900, 'PHP', 30),
  ('credits_5000',  '5,000 credits', 5000.0000,  39900, 'PHP', 40)
on conflict (key) do nothing;

-- ----------------------------------------------------------- credit orders
-- One row per attempt to buy. `credits` and `price_cents` are copied from the
-- package at the moment the order is made, so a later price change never
-- rewrites what someone agreed to pay.
create table if not exists public.credit_orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  /* Kept so an order still means something after an account is deleted. */
  identity_hash text,
  package_key  text not null references public.credit_packages(key),
  credits      numeric(12, 4) not null check (credits > 0),
  price_cents  integer not null check (price_cents >= 0),
  currency     text not null default 'PHP',
  /* 'paypal' | 'gcash' — which set of instructions was shown. */
  provider     text not null check (provider in ('paypal', 'gcash')),
  status       text not null default 'pending'
               check (status in ('pending', 'submitted', 'approved', 'rejected', 'cancelled')),
  /* What the payer says identifies their payment. Manual verification only:
     this is never trusted, only shown to an admin. */
  reference    text,
  /* Storage path of an uploaded receipt, when there is one. */
  proof_path   text,
  admin_note   text,
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  /* Set when the credits were actually granted; the idempotency latch. */
  granted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists credit_orders_user_idx
  on public.credit_orders (user_id, created_at desc);
create index if not exists credit_orders_status_idx
  on public.credit_orders (status, created_at desc);

drop trigger if exists credit_orders_touch on public.credit_orders;
create trigger credit_orders_touch before update on public.credit_orders
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------- ordering
-- Starts an order for the caller. The amounts come from the package row, not
-- from the request, so a client cannot buy 5,000 credits at the 500 price.
create or replace function public.create_credit_order(
  package     text,
  pay_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pack     public.credit_packages;
  order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if pay_provider not in ('paypal', 'gcash') then
    raise exception 'unknown payment method';
  end if;

  select * into pack from public.credit_packages where key = package and enabled;
  if pack is null then
    return jsonb_build_object('ok', false, 'reason', 'That package is not available.');
  end if;

  insert into public.credit_orders
    (user_id, identity_hash, package_key, credits, price_cents, currency, provider, status)
  values
    (auth.uid(), public.credit_identity(), pack.key, pack.credits, pack.price_cents,
     pack.currency, pay_provider, 'pending')
  returning id into order_id;

  return jsonb_build_object('ok', true, 'orderId', order_id);
end $$;

revoke all on function public.create_credit_order(text, text) from public, anon;
grant execute on function public.create_credit_order(text, text) to authenticated;

-- The payer says they have paid. Moves their own pending order to 'submitted'
-- and records what they gave us. Still worth nothing until an admin looks.
create or replace function public.submit_credit_order(
  order_id  uuid,
  reference_text text,
  proof     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found public.credit_orders;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into found from public.credit_orders
  where id = order_id and user_id = auth.uid() for update;

  if found is null then
    return jsonb_build_object('ok', false, 'reason', 'Order not found.');
  end if;
  if found.status not in ('pending', 'submitted') then
    return jsonb_build_object('ok', false, 'reason', 'That order can no longer be changed.');
  end if;

  update public.credit_orders
  set status = 'submitted',
      reference = nullif(trim(reference_text), ''),
      proof_path = coalesce(nullif(trim(proof), ''), proof_path)
  where id = order_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.submit_credit_order(uuid, text, text) from public, anon;
grant execute on function public.submit_credit_order(uuid, text, text) to authenticated;

-- The payer changes their mind. Only their own order, only before review.
create or replace function public.cancel_credit_order(order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.credit_orders
  set status = 'cancelled'
  where id = order_id and user_id = auth.uid() and status in ('pending', 'submitted');

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That order can no longer be cancelled.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cancel_credit_order(uuid) from public, anon;
grant execute on function public.cancel_credit_order(uuid) to authenticated;

-- ---------------------------------------------------------------- review
-- An admin approves or rejects. Approval is the only path that ever grants
-- purchased credits, and `granted_at` is the latch that makes it happen once:
-- the row is locked, checked and stamped in the same transaction as the grant,
-- so two admins clicking together cannot pay twice.
create or replace function public.review_credit_order(
  order_id uuid,
  decision text,
  note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found public.credit_orders;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  select * into found from public.credit_orders where id = order_id for update;
  if found is null then
    return jsonb_build_object('ok', false, 'reason', 'Order not found.');
  end if;

  -- Already settled: say so rather than doing it again.
  if found.granted_at is not null or found.status in ('approved', 'rejected', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'That order has already been reviewed.');
  end if;

  if decision = 'rejected' then
    update public.credit_orders
    set status = 'rejected', admin_note = note, reviewed_by = auth.uid(), reviewed_at = now()
    where id = order_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- Approved: stamp first, then pay. Both in this transaction, so a failure
  -- anywhere rolls back the stamp along with the grant.
  update public.credit_orders
  set status = 'approved', admin_note = note, reviewed_by = auth.uid(),
      reviewed_at = now(), granted_at = now()
  where id = order_id;

  perform public.award_credits(found.user_id, found.credits, 'purchase', order_id::text,
                               jsonb_build_object('order', order_id, 'package', found.package_key));

  return jsonb_build_object('ok', true, 'status', 'approved', 'credits', found.credits);
end $$;

revoke all on function public.review_credit_order(uuid, text, text) from public, anon;
grant execute on function public.review_credit_order(uuid, text, text) to authenticated;

-- Every pending order, for the admin queue. Definer because RLS rightly hides
-- other accounts' orders; the is_admin() guard is what replaces it.
create or replace function public.admin_credit_orders(limit_count integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return coalesce((
    select jsonb_agg(o) from (
      select c.id, c.package_key, c.credits, c.price_cents, c.currency, c.provider,
             c.status, c.reference, c.proof_path, c.admin_note, c.created_at, c.reviewed_at,
             (select p.email from public.profiles p where p.id = c.user_id) as account
      from public.credit_orders c
      order by
        case when c.status = 'submitted' then 0 when c.status = 'pending' then 1 else 2 end,
        c.created_at desc
      limit greatest(1, least(limit_count, 200))
    ) o), '[]'::jsonb);
end $$;

revoke all on function public.admin_credit_orders(integer) from public, anon;
grant execute on function public.admin_credit_orders(integer) to authenticated;

-- --------------------------------------------------------------------- RLS
alter table public.credit_packages enable row level security;
alter table public.credit_orders   enable row level security;

drop policy if exists "credit packages: read"  on public.credit_packages;
drop policy if exists "credit packages: admin" on public.credit_packages;
drop policy if exists "credit orders: own rows" on public.credit_orders;

-- The store is shown to any signed-in account; only an admin sets prices.
create policy "credit packages: read" on public.credit_packages
  for select to authenticated using (true);
create policy "credit packages: admin" on public.credit_packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- An account reads its own orders and nothing else. Every write goes through
-- the definer functions above, so there is no insert or update policy at all.
create policy "credit orders: own rows" on public.credit_orders
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- ------------------------------------------------------- storage: receipts
-- Private bucket for GCash proof. Each object lives under the payer's user id,
-- exactly like the knowledge bucket, and an admin may read any of them.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts: own objects" on storage.objects;
create policy "receipts: own objects" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'receipts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  )
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ======================================================================
-- v0.22 — admin wallet management and circulation figures
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Reading another account's wallet is exactly what RLS forbids, so the two
-- functions here are security definer with an is_admin() guard — the same
-- pattern as admin_overview(). Neither writes anything: granting still goes
-- through grant_credits(), which is admin-only, atomic, and the only thing that
-- may move a balance.
--
-- Admins are excluded from every figure below. They are entitled rather than
-- funded (their chat is never charged), so counting their wallets would make
-- "in circulation" mean nothing.

-- A page of wallets, newest account first, optionally filtered by email or
-- display name. Only what the table shows is returned.
create or replace function public.admin_credit_wallets(
  search      text default null,
  limit_count integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle text := nullif(trim(coalesce(search, '')), '');
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return jsonb_build_object(
    -- Circulation counts ordinary accounts only: an admin's balance is not
    -- spendable in the way everyone else's is.
    'totals', (
      select jsonb_build_object(
        'wallets', count(*),
        'active', count(*) filter (where w.balance > 0),
        'balance', coalesce(sum(w.balance), 0),
        'earned', coalesce(sum(w.total_earned), 0),
        'spent', coalesce(sum(w.total_spent), 0)
      )
      from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where p.role <> 'admin'
    ),
    'admins', (
      select count(*) from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where p.role = 'admin'
    ),
    'wallets', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select w.user_id,
               p.email,
               p.display_name,
               p.role,
               w.balance,
               w.total_earned,
               w.total_spent,
               w.streak_days,
               w.updated_at
        from public.credit_wallets w
        join public.profiles p on p.id = w.user_id
        where needle is null
           or p.email ilike '%' || needle || '%'
           or coalesce(p.display_name, '') ilike '%' || needle || '%'
        order by w.balance desc, p.created_at desc
        limit greatest(1, least(limit_count, 200))
      ) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_credit_wallets(text, integer) from public, anon;
grant execute on function public.admin_credit_wallets(text, integer) to authenticated;

-- One wallet and its recent ledger, for the drawer an admin opens before
-- granting. Read-only, and no message content is ever involved.
create or replace function public.admin_credit_wallet(target_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return jsonb_build_object(
    'wallet', (
      select jsonb_build_object(
        'user_id', w.user_id,
        'email', p.email,
        'display_name', p.display_name,
        'role', p.role,
        'balance', w.balance,
        'total_earned', w.total_earned,
        'total_spent', w.total_spent,
        'streak_days', w.streak_days
      )
      from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where w.user_id = target_user
    ),
    'transactions', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select c.id, c.amount, c.kind, c.reason, c.balance_after, c.metadata, c.created_at
        from public.credit_transactions c
        where c.user_id = target_user
        order by c.created_at desc
        limit 30
      ) t), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_credit_wallet(uuid) from public, anon;
grant execute on function public.admin_credit_wallet(uuid) to authenticated;

-- ======================================================================
-- v0.23 — a ceiling on circulation, and admin credit removal
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Two additions, both server-side:
--
--   * A maximum circulation. Every path that creates credits — signup, daily,
--     streak, achievements, tasks, rewarded ads, purchases, admin grants —
--     already funnels through award_credits() or grant_credits(), so the check
--     goes there once, inside the same transaction that writes the balance.
--     A grant that would breach the ceiling is refused whole; nothing is ever
--     partially paid.
--
--   * Removing credits. Balances only ever moved up by a grant or down by a
--     spend, and an admin correcting a mistake had no path at all. Removal is
--     a spend by another name: same wallet, same append-only ledger, its own
--     'admin_adjustment' reason, and the same non-negative guard.
--
-- Spending is deliberately untouched by the ceiling: it lowers circulation, so
-- an account at a full supply can always keep using what it already has.

-- ------------------------------------------------------------ the setting
alter table public.ai_settings
  add column if not exists max_circulation numeric(14, 4) not null default 0
  check (max_circulation >= 0);

comment on column public.ai_settings.max_circulation is
  'Ceiling on the sum of ordinary accounts'' balances. 0 means no ceiling.';

-- Credits in circulation right now: ordinary accounts only. Admins are
-- entitled rather than funded, so their balances are not in circulation.
create or replace function public.credits_in_circulation()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(w.balance), 0)
  from public.credit_wallets w
  join public.profiles p on p.id = w.user_id
  where p.role <> 'admin';
$$;

revoke all on function public.credits_in_circulation() from public, anon;
grant execute on function public.credits_in_circulation() to authenticated;

-- --------------------------------------------------- award, with a ceiling
-- The single place credits come into being. The ceiling is read and enforced
-- inside this transaction, after the wallet row is locked, so two concurrent
-- grants queue rather than both squeezing past the same remaining capacity.
create or replace function public.award_credits(
  target_user    uuid,
  grant_amount   numeric,
  grant_reason   text,
  external_ref   text default null,
  grant_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 4);
  ceiling     numeric(14, 4);
  circulating numeric(14, 4);
  recipient   text;
begin
  if grant_amount is null or grant_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  perform public.ensure_credit_wallet(target_user);
  perform 1 from public.credit_wallets where user_id = target_user for update;

  -- An admin's wallet is outside circulation, so topping it up cannot breach
  -- the ceiling and is not measured against it.
  select p.role into recipient from public.profiles p where p.id = target_user;

  select max_circulation into ceiling from public.ai_settings where id;
  if coalesce(ceiling, 0) > 0 and coalesce(recipient, 'user') <> 'admin' then
    circulating := public.credits_in_circulation();
    -- Whole or nothing: a reward is never rounded down to fit.
    if circulating + grant_amount > ceiling then
      raise exception 'circulation_limit_reached' using errcode = 'check_violation';
    end if;
  end if;

  if exists (select 1 from public.credit_rules where key = grant_reason) then
    insert into public.credit_reward_claims (user_id, identity_hash, rule_key, amount, external_id)
    values (target_user, public.credit_identity(target_user), grant_reason, grant_amount, external_ref);
  end if;

  update public.credit_wallets
  set balance = balance + grant_amount,
      total_earned = total_earned + grant_amount
  where user_id = target_user
  returning balance into new_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, grant_amount, 'earn', grant_reason, new_balance,
          coalesce(grant_metadata, '{}'::jsonb));

  return new_balance;
end $$;

revoke all on function public.award_credits(uuid, numeric, text, text, jsonb)
  from public, anon, authenticated;

-- grant_credits() keeps its admin check and now simply defers the writing to
-- award_credits(), so the ceiling applies to an admin grant exactly as it does
-- to a daily claim. One place creates credits; one place enforces the supply.
create or replace function public.grant_credits(
  target_user    uuid,
  grant_amount   numeric,
  grant_reason   text,
  external_ref   text default null,
  grant_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may grant credits';
  end if;

  return public.award_credits(target_user, grant_amount, grant_reason,
                              external_ref, grant_metadata);
end $$;

revoke all on function public.grant_credits(uuid, numeric, text, text, jsonb) from public, anon;
grant execute on function public.grant_credits(uuid, numeric, text, text, jsonb) to authenticated;
grant execute on function public.grant_credits(uuid, numeric, text, text, jsonb) to service_role;

-- ------------------------------------------------------- removing credits
-- An admin taking credits back off a wallet: a correction, not a deletion.
-- Nothing historical is touched — this appends a negative row like any spend,
-- and the wallet's own check constraint refuses to go below zero.
create or replace function public.remove_credits(
  target_user uuid,
  take_amount numeric,
  note        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 4);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if take_amount is null or take_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Amount must be more than zero.');
  end if;
  if coalesce(trim(note), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'Give a reason for this adjustment.');
  end if;

  perform public.ensure_credit_wallet(target_user);

  select balance into current_balance
  from public.credit_wallets where user_id = target_user for update;

  if current_balance < take_amount then
    return jsonb_build_object(
      'ok', false,
      'reason', 'That account only has ' || trim(to_char(current_balance, 'FM999999990.99')) ||
                ' credits.'
    );
  end if;

  update public.credit_wallets
  set balance = balance - take_amount,
      total_spent = total_spent + take_amount
  where user_id = target_user
  returning balance into current_balance;

  insert into public.credit_transactions (user_id, amount, kind, reason, balance_after, metadata)
  values (target_user, -take_amount, 'spend', 'admin_adjustment', current_balance,
          jsonb_build_object('removed_by', auth.uid(), 'note', left(trim(note), 400)));

  return jsonb_build_object('ok', true, 'balance', current_balance);
end $$;

revoke all on function public.remove_credits(uuid, numeric, text) from public, anon;
grant execute on function public.remove_credits(uuid, numeric, text) to authenticated;

-- ------------------------------------------- circulation in the admin view
-- The wallet listing gains the ceiling and what is left of it, so the figures
-- an admin acts on are the ones the database is actually enforcing.
create or replace function public.admin_credit_wallets(
  search      text default null,
  limit_count integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle  text := nullif(trim(coalesce(search, '')), '');
  ceiling numeric(14, 4);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select max_circulation into ceiling from public.ai_settings where id;

  return jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'wallets', count(*),
        'active', count(*) filter (where w.balance > 0),
        'balance', coalesce(sum(w.balance), 0),
        'earned', coalesce(sum(w.total_earned), 0),
        'spent', coalesce(sum(w.total_spent), 0)
      )
      from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where p.role <> 'admin'
    ),
    'maxCirculation', coalesce(ceiling, 0),
    'remaining', case
      when coalesce(ceiling, 0) > 0
      then greatest(0, ceiling - public.credits_in_circulation())
    end,
    'admins', (
      select count(*) from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where p.role = 'admin'
    ),
    'wallets', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select w.user_id,
               p.email,
               p.display_name,
               p.role,
               w.balance,
               w.total_earned,
               w.total_spent,
               w.streak_days,
               w.updated_at
        from public.credit_wallets w
        join public.profiles p on p.id = w.user_id
        where needle is null
           or p.email ilike '%' || needle || '%'
           or coalesce(p.display_name, '') ilike '%' || needle || '%'
        order by w.balance desc, p.created_at desc
        limit greatest(1, least(limit_count, 200))
      ) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_credit_wallets(text, integer) from public, anon;
grant execute on function public.admin_credit_wallets(text, integer) to authenticated;

-- ======================================================================
-- v0.24 — an admin may erase one account's application data
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Deleting the auth user is the account owner's own affair (delete_own_account
-- does that, and cascades everything). This is the other case: an admin
-- clearing out what one account has *made* — conversations, workspaces,
-- knowledge, prompts, workflows, feedback and its wallet — while the sign-in
-- itself stays where it is.
--
-- Three things are deliberately kept:
--
--   * public.credit_identities and the claim rows keyed to it. They hold a
--     hash and nothing else — no email, no name, no token — and they are what
--     stops the signup bonus and the one-time tasks being farmed by wiping an
--     account and starting again. Erasing them would hand back exactly the
--     eligibility they exist to withhold.
--   * public.credit_transactions. The ledger is append-only by design; a
--     balance can go to zero, but the record of how it got there is never
--     rewritten or removed. It does not reference the wallet, so the wallet
--     can go without it.
--   * public.training_messages, which carries no account identifier by design
--     and is not reachable from a user id at all.
--
-- And two things are refused outright: the admin's own account, and any other
-- admin. Both checks live here, in the database, not in the route that calls it.

-- ------------------------------------------------------------ admin audit
-- A record of consequential admin actions, kept independently of the rows an
-- action removed. Readable only by an admin; written only by the definer
-- functions that record into it.
create table if not exists public.admin_audit (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,
  /* Who did it, and to whom. Both are cleared rather than cascaded, so the
     record outlives either account. */
  actor      uuid references auth.users(id) on delete set null,
  target     uuid references auth.users(id) on delete set null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;

drop policy if exists "admin audit: admin read" on public.admin_audit;
create policy "admin audit: admin read" on public.admin_audit
  for select to authenticated using (public.is_admin());

-- ------------------------------------------------------- the deletion
create or replace function public.admin_delete_user_data(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target         public.profiles;
  removed        jsonb;
  chat_count     integer;
  message_count  integer;
  file_count     integer;
  wallet_balance numeric(12, 4);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if target_user is null then
    return jsonb_build_object('ok', false, 'reason', 'Which account?');
  end if;
  -- The one thing an admin must not be able to do by mistake.
  if target_user = auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'You cannot delete your own data from here.');
  end if;

  select * into target from public.profiles where id = target_user;
  if target is null then
    return jsonb_build_object('ok', false, 'reason', 'No such account.');
  end if;
  -- Admins are not wiped by other admins from a dashboard button.
  if target.role = 'admin' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'That account is an admin. Change its role first if this is intended.'
    );
  end if;

  -- What is about to go, for the audit row and for the answer.
  select count(*) into chat_count from public.chats where user_id = target_user;
  select count(*) into message_count from public.messages where user_id = target_user;
  select count(*) into file_count from public.files where user_id = target_user;
  select balance into wallet_balance from public.credit_wallets where user_id = target_user;

  -- One statement per table, children before parents, so foreign keys are
  -- satisfied even where a cascade would have handled it. All of it in this
  -- transaction: a failure anywhere leaves the account exactly as it was.
  delete from public.message_embeddings where user_id = target_user;
  delete from public.message_feedback   where user_id = target_user;
  delete from public.file_chunks        where user_id = target_user;
  delete from public.files              where user_id = target_user;
  delete from public.shared_chats       where user_id = target_user;
  delete from public.messages           where user_id = target_user;
  delete from public.chats              where user_id = target_user;
  delete from public.projects           where user_id = target_user;
  delete from public.prompts            where user_id = target_user;
  delete from public.workflows          where user_id = target_user;
  delete from public.app_feedback       where user_id = target_user;

  -- Credits: the orders and the wallet go, and with the wallet the balance.
  -- The ledger and the reward claims stay — the first because it is a record,
  -- the second because it is the anti-farming key.
  delete from public.credit_orders  where user_id = target_user;
  delete from public.credit_wallets where user_id = target_user;

  -- The account keeps its sign-in and its profile; its settings go back to the
  -- defaults, so what is left is a usable but empty account.
  update public.user_settings
  set global_system_prompt = '',
      presets = '[]'::jsonb,
      improve_model = false,
      personalize_with_history = false
  where user_id = target_user;

  removed := jsonb_build_object(
    'chats', chat_count,
    'messages', message_count,
    'files', file_count,
    'balance', coalesce(wallet_balance, 0)
  );

  insert into public.admin_audit (action, actor, target, details)
  values ('delete_user_data', auth.uid(), target_user, removed);

  return jsonb_build_object('ok', true, 'removed', removed);
end $$;

revoke all on function public.admin_delete_user_data(uuid) from public, anon;
grant execute on function public.admin_delete_user_data(uuid) to authenticated;

-- The wallet listing already excludes admins from circulation; it now also
-- says which row is the caller, so the UI can refuse to offer deletion there.
create or replace function public.admin_credit_wallets(
  search      text default null,
  limit_count integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle  text := nullif(trim(coalesce(search, '')), '');
  ceiling numeric(14, 4);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select max_circulation into ceiling from public.ai_settings where id;

  return jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'wallets', count(*),
        'active', count(*) filter (where w.balance > 0),
        'balance', coalesce(sum(w.balance), 0),
        'earned', coalesce(sum(w.total_earned), 0),
        'spent', coalesce(sum(w.total_spent), 0)
      )
      from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where p.role <> 'admin'
    ),
    'maxCirculation', coalesce(ceiling, 0),
    'remaining', case
      when coalesce(ceiling, 0) > 0
      then greatest(0, ceiling - public.credits_in_circulation())
    end,
    'admins', (
      select count(*) from public.credit_wallets w
      join public.profiles p on p.id = w.user_id
      where p.role = 'admin'
    ),
    'wallets', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select w.user_id,
               p.email,
               p.display_name,
               p.role,
               w.balance,
               w.total_earned,
               w.total_spent,
               w.streak_days,
               w.updated_at,
               (w.user_id = auth.uid()) as is_self
        from public.credit_wallets w
        join public.profiles p on p.id = w.user_id
        where needle is null
           or p.email ilike '%' || needle || '%'
           or coalesce(p.display_name, '') ilike '%' || needle || '%'
        order by w.balance desc, p.created_at desc
        limit greatest(1, least(limit_count, 200))
      ) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_credit_wallets(text, integer) from public, anon;
grant execute on function public.admin_credit_wallets(text, integer) to authenticated;

-- ======================================================================
-- v0.25 — a controlled way to clear one account's credit data
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- The ledger is append-only, and stays that way. But permanently deleting an
-- account's data is the one operation where its rows genuinely have to go —
-- leaving a ledger behind for a wallet that no longer exists is a record of
-- nothing, and the earlier version of this deleted them by disabling the
-- table's trigger, which is a global act for a single-account job.
--
-- Instead the trigger now honours one thing: a transaction-local flag that
-- only admin_clear_credit_data() sets. Outside that function the flag is unset,
-- so every ordinary insert, update and delete meets exactly the protection it
-- met before — and the flag cannot outlive the transaction that set it, so a
-- failure anywhere leaves both the flag and the rows as they were.

-- The same guard, plus the one sanctioned exception.
create or replace function public.credit_ledger_is_append_only()
returns trigger language plpgsql as $$
begin
  -- set_config(..., true) is transaction-local: it disappears at commit or
  -- rollback, and no session can carry it into another statement.
  if current_setting('ugnay.credit_cleanup', true) = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'credit_transactions is append-only';
end $$;

drop trigger if exists credit_transactions_immutable on public.credit_transactions;
create trigger credit_transactions_immutable before update or delete
  on public.credit_transactions
  for each row execute function public.credit_ledger_is_append_only();

-- ------------------------------------------------- the cleanup itself
-- Removes one account's wallet and ledger, and nothing else. Admin-only, never
-- the caller's own account, and never another admin — the same three refusals
-- as the deletion flow that calls it, repeated here because this function is
-- executable on its own.
create or replace function public.admin_clear_credit_data(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role    text;
  wallet_balance numeric(12, 4);
  ledger_rows    integer;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if target_user is null then
    return jsonb_build_object('ok', false, 'reason', 'Which account?');
  end if;
  if target_user = auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'You cannot clear your own credit data.');
  end if;

  select role into target_role from public.profiles where id = target_user;
  if target_role = 'admin' then
    return jsonb_build_object('ok', false, 'reason', 'That account is an admin.');
  end if;

  -- Locking the wallet first serialises this against any grant or spend for
  -- the same account, so nothing is written to a ledger being removed.
  select balance into wallet_balance
  from public.credit_wallets where user_id = target_user for update;

  select count(*) into ledger_rows
  from public.credit_transactions where user_id = target_user;

  -- Scoped to this transaction and to these two statements. Every filter is on
  -- the one account, so no other wallet or ledger can be touched.
  perform set_config('ugnay.credit_cleanup', 'on', true);
  delete from public.credit_transactions where user_id = target_user;
  perform set_config('ugnay.credit_cleanup', 'off', true);

  delete from public.credit_wallets where user_id = target_user;

  -- credit_identities and its claim rows are deliberately left alone: they are
  -- the anti-farming record, and they hold a hash rather than anything about
  -- the person.
  return jsonb_build_object(
    'ok', true,
    'balance', coalesce(wallet_balance, 0),
    'transactions', coalesce(ledger_rows, 0)
  );
end $$;

revoke all on function public.admin_clear_credit_data(uuid) from public, anon;
grant execute on function public.admin_clear_credit_data(uuid) to authenticated;

-- ------------------------------- the deletion flow uses the cleanup now
-- Identical to v0.24 except for the credit step, which is delegated rather
-- than done inline. Still one transaction: if the cleanup raises, every other
-- deletion above it rolls back with it.
create or replace function public.admin_delete_user_data(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target         public.profiles;
  removed        jsonb;
  cleared        jsonb;
  chat_count     integer;
  message_count  integer;
  file_count     integer;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if target_user is null then
    return jsonb_build_object('ok', false, 'reason', 'Which account?');
  end if;
  if target_user = auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'You cannot delete your own data from here.');
  end if;

  select * into target from public.profiles where id = target_user;
  if target is null then
    return jsonb_build_object('ok', false, 'reason', 'No such account.');
  end if;
  if target.role = 'admin' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'That account is an admin. Change its role first if this is intended.'
    );
  end if;

  select count(*) into chat_count from public.chats where user_id = target_user;
  select count(*) into message_count from public.messages where user_id = target_user;
  select count(*) into file_count from public.files where user_id = target_user;

  delete from public.message_embeddings where user_id = target_user;
  delete from public.message_feedback   where user_id = target_user;
  delete from public.file_chunks        where user_id = target_user;
  delete from public.files              where user_id = target_user;
  delete from public.shared_chats       where user_id = target_user;
  delete from public.messages           where user_id = target_user;
  delete from public.chats              where user_id = target_user;
  delete from public.projects           where user_id = target_user;
  delete from public.prompts            where user_id = target_user;
  delete from public.workflows          where user_id = target_user;
  delete from public.app_feedback       where user_id = target_user;
  delete from public.credit_orders      where user_id = target_user;

  -- The wallet, the balance and the ledger, through the one function allowed
  -- to remove them.
  cleared := public.admin_clear_credit_data(target_user);
  if not coalesce((cleared ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', cleared ->> 'reason');
  end if;

  update public.user_settings
  set global_system_prompt = '',
      presets = '[]'::jsonb,
      improve_model = false,
      personalize_with_history = false
  where user_id = target_user;

  removed := jsonb_build_object(
    'chats', chat_count,
    'messages', message_count,
    'files', file_count,
    'balance', cleared -> 'balance',
    'transactions', cleared -> 'transactions'
  );

  insert into public.admin_audit (action, actor, target, details)
  values ('delete_user_data', auth.uid(), target_user, removed);

  return jsonb_build_object('ok', true, 'removed', removed);
end $$;

revoke all on function public.admin_delete_user_data(uuid) from public, anon;
grant execute on function public.admin_delete_user_data(uuid) to authenticated;

-- ======================================================================
-- v0.26 — configurable payment methods, and what a payer must submit
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- Two additions, and nothing about how credits are granted changes: approval
-- still goes through review_credit_order(), which is admin-only, latched on
-- granted_at, and pays through award_credits() — so the wallet, the ledger,
-- the circulation ceiling and the identity record all behave exactly as they
-- did before.
--
--   * payment_methods. GCash needs an account number, a name and a QR image,
--     and an admin has to be able to set them without a redeploy. A method is
--     "configured" when it has a destination; an unconfigured one is shown
--     greyed out rather than hidden, so it is obvious that it exists and is
--     simply not available yet.
--
--   * The order gains the amount the payer says they sent, and their note.
--     Both are claims, not facts: they are shown to the admin reviewing the
--     payment and are never checked by the database, never compared against
--     the price to auto-approve, and never grant anything on their own.
--
-- PayPal ships unconfigured and with verification 'unavailable'. It stays grey
-- until a real integration exists — a destination alone is not enough, because
-- a PayPal payment is not something an admin can confirm by eye the way a
-- GCash reference and receipt can be.

-- ---------------------------------------------------------- payment methods
create table if not exists public.payment_methods (
  id           text primary key,
  label        text not null,
  /* 'manual'      — an admin confirms each payment by hand.
     'unavailable' — no way to take payment yet; always shown greyed out. */
  verification text not null default 'manual'
               check (verification in ('manual', 'unavailable')),
  /* Where the money goes. Public by nature: it is how someone pays. Empty
     means unconfigured, which is what greys the method out. */
  destination  text not null default '',
  /* The account name shown beside the number, when the method has one. */
  account_name text not null default '',
  /* Storage path in the 'receipts' bucket, or an absolute URL. */
  qr_path      text not null default '',
  instructions text not null default '',
  /* An admin may switch a configured method off without clearing its details. */
  enabled      boolean not null default true,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

drop trigger if exists payment_methods_touch on public.payment_methods;
create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function public.touch_updated_at();

-- The two methods Ugnay knows about, both unconfigured. Nothing is invented
-- here: no number, no name, no QR — an admin supplies those or the method
-- stays greyed out.
insert into public.payment_methods
  (id, label, verification, instructions, enabled, sort_order)
values
  ('gcash', 'GCash', 'manual',
   'Send the exact amount to the GCash account shown, or scan the QR code.' || E'\n' ||
   'Copy the reference number GCash gives you.' || E'\n' ||
   'Fill in the amount you sent, attach your receipt screenshot, and submit for review.',
   true, 10),
  ('paypal', 'PayPal', 'unavailable',
   'PayPal payments are not available yet.', false, 20)
on conflict (id) do nothing;

-- --------------------------------------------------------------------- RLS
-- The store shows every method, including the greyed-out ones, so any signed-in
-- account may read them. Only an admin may configure one.
alter table public.payment_methods enable row level security;

drop policy if exists "payment methods: read"  on public.payment_methods;
drop policy if exists "payment methods: admin" on public.payment_methods;

create policy "payment methods: read" on public.payment_methods
  for select to authenticated using (true);
create policy "payment methods: admin" on public.payment_methods
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------- what the payer submits
-- The amount they say they sent, in minor units of the order's currency, and
-- whatever they wanted to tell the reviewer. Both are unverified claims.
alter table public.credit_orders
  add column if not exists paid_cents integer check (paid_cents is null or paid_cents >= 0);
alter table public.credit_orders
  add column if not exists payer_note text;

comment on column public.credit_orders.paid_cents is
  'What the payer says they sent. A claim shown to the reviewing admin, never checked automatically and never sufficient to grant credits.';

-- ------------------------------------------------------------ submission
-- Same function, plus the amount and the note. Proof is required now: a manual
-- review needs something to look at. The order still lands in 'submitted' and
-- is worth nothing until an admin approves it.
create or replace function public.submit_credit_order(
  order_id       uuid,
  reference_text text,
  proof          text default null,
  paid_amount    integer default null,
  note_text      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  found public.credit_orders;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into found from public.credit_orders
  where id = order_id and user_id = auth.uid() for update;

  if found is null then
    return jsonb_build_object('ok', false, 'reason', 'Order not found.');
  end if;
  if found.status not in ('pending', 'submitted') then
    return jsonb_build_object('ok', false, 'reason', 'That order can no longer be changed.');
  end if;
  if coalesce(trim(reference_text), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'Enter your payment reference number.');
  end if;
  if coalesce(trim(proof), '') = '' and coalesce(found.proof_path, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'Attach your proof of payment.');
  end if;

  update public.credit_orders
  set status = 'submitted',
      reference = trim(reference_text),
      proof_path = coalesce(nullif(trim(proof), ''), proof_path),
      paid_cents = coalesce(paid_amount, paid_cents),
      payer_note = nullif(trim(coalesce(note_text, '')), '')
  where id = order_id;

  return jsonb_build_object('ok', true);
end $BODY$;

revoke all on function public.submit_credit_order(uuid, text, text, integer, text)
  from public, anon;
grant execute on function public.submit_credit_order(uuid, text, text, integer, text)
  to authenticated;

-- The three-argument version from v0.21 is dropped: leaving it callable would
-- let a client submit an order with no proof, which is exactly the check that
-- was just added above.
drop function if exists public.submit_credit_order(uuid, text, text);

-- ---------------------------------------------------- the admin's queue
-- The same listing, plus what the payer claimed. Still admin-only, still
-- read-only, and still nothing here approves anything.
create or replace function public.admin_credit_orders(limit_count integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $BODY$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return coalesce((
    select jsonb_agg(o) from (
      select c.id, c.package_key, c.credits, c.price_cents, c.currency, c.provider,
             c.status, c.reference, c.proof_path, c.admin_note, c.created_at, c.reviewed_at,
             c.paid_cents, c.payer_note,
             (select p.email from public.profiles p where p.id = c.user_id) as account
      from public.credit_orders c
      order by
        case when c.status = 'submitted' then 0 when c.status = 'pending' then 1 else 2 end,
        c.created_at desc
      limit greatest(1, least(limit_count, 200))
    ) o), '[]'::jsonb);
end $BODY$;

revoke all on function public.admin_credit_orders(integer) from public, anon;
grant execute on function public.admin_credit_orders(integer) to authenticated;

-- ------------------------------------------------------- ordering, guarded
-- An order may only be started against a method that is enabled and actually
-- configured. The route checks this too; this is the check that cannot be
-- bypassed by calling the function directly.
create or replace function public.create_credit_order(
  package      text,
  pay_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  pack     public.credit_packages;
  method   public.payment_methods;
  order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into method from public.payment_methods where id = pay_provider;
  if method is null
     or not method.enabled
     or method.verification = 'unavailable'
     or coalesce(trim(method.destination), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'That payment method is unavailable.');
  end if;

  select * into pack from public.credit_packages where key = package and enabled;
  if pack is null then
    return jsonb_build_object('ok', false, 'reason', 'That package is not available.');
  end if;

  insert into public.credit_orders
    (user_id, identity_hash, package_key, credits, price_cents, currency, provider, status)
  values
    (auth.uid(), public.credit_identity(), pack.key, pack.credits, pack.price_cents,
     pack.currency, pay_provider, 'pending')
  returning id into order_id;

  return jsonb_build_object('ok', true, 'orderId', order_id);
end $BODY$;

revoke all on function public.create_credit_order(text, text) from public, anon;
grant execute on function public.create_credit_order(text, text) to authenticated;

-- --------------------------------------------------- storage: the QR image
-- The QR lives in the same private 'receipts' bucket, under a 'public/' prefix
-- that only an admin may write. Payers are handed a signed URL by the store
-- route rather than the bucket being opened up.
drop policy if exists "receipts: own objects" on storage.objects;
create policy "receipts: own objects" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  )
  with check (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] = 'public' and public.is_admin())
    )
  );

-- ======================================================================
-- v0.27 — Invite & Earn: referrals on the existing identity and ledger
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- A referral is a reward like any other: it is priced by a row in
-- credit_rules ('referral'), it is paid by award_credits(), and it therefore
-- lands in the same wallet, the same append-only ledger and under the same
-- circulation ceiling as the daily claim. There is no second currency, no
-- second balance and no second ledger.
--
-- What makes referrals different is only *who* may be counted, and the answer
-- is the credit_identities hash from v0.19 rather than the account id. That
-- matters because an account id is cheap: delete it, sign up again, and a
-- naive referral system pays the same referrer twice. The identity hash
-- survives exactly that, so:
--
--   * self-referral is refused — the two identities are the same hash;
--   * a referred identity may be counted once, ever, even if the account it
--     belongs to is deleted and recreated;
--   * a referrer's monthly cap counts identities, not sign-ups.
--
-- Nothing is paid when a link is copied, shared or opened. A referral is
-- recorded as 'pending' when someone signs up through a code, and becomes
-- 'qualified' — and only then pays — once the referred identity has done the
-- configured qualifying action, which is checked here, in the database.

-- ------------------------------------------------------------- the rule
-- 'referral' is an ordinary reward key, so Admin → Credits already lists it
-- under Rewards and can change its amount or switch it off. daily_limit is
-- reused as the monthly cap on paid referrals (0 = no cap).
insert into public.credit_rules (key, amount, per, cooldown_seconds, daily_limit, description)
values ('referral', 25.0000, 'claim', 0, 20,
        'Someone signed up with your invite code and started using Ugnay')
on conflict (key) do nothing;

-- How much the invited person gets for accepting an invite. Separate key so an
-- admin can run a one-sided or two-sided offer without touching the other.
insert into public.credit_rules (key, amount, per, cooldown_seconds, daily_limit, description)
values ('referral_welcome', 10.0000, 'claim', 0, 0,
        'Bonus for joining Ugnay through an invite code')
on conflict (key) do nothing;

-- ------------------------------------------------------- the invite code
-- One code per identity, not per account: signing out, deleting the account
-- and signing up again with the same provider gives back the same code, and
-- the referrals already earned on it are still there.
alter table public.credit_identities
  add column if not exists referral_code text;

-- Who invited this identity, and whether that has been paid for yet. Held on
-- the invited side because that is the side that can only ever be claimed
-- once, whatever happens to the account.
alter table public.credit_identities
  add column if not exists referred_by text references public.credit_identities(identity_hash);
alter table public.credit_identities
  add column if not exists referred_at timestamptz;

create unique index if not exists credit_identities_referral_code_idx
  on public.credit_identities (referral_code) where referral_code is not null;
create index if not exists credit_identities_referred_by_idx
  on public.credit_identities (referred_by);

-- ------------------------------------------------------------ referrals
-- One row per invited identity, ever. The unique constraint on invitee is the
-- thing that makes a referral unrepeatable: it is the identity hash, so a
-- deleted-and-recreated account collides with its own earlier row rather than
-- earning a second time.
create table if not exists public.credit_referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer     text not null references public.credit_identities(identity_hash),
  invitee      text not null unique references public.credit_identities(identity_hash),
  /* 'pending'   — signed up, has not yet done the qualifying action.
     'qualified' — done, and the reward has been paid.
     'rejected'  — refused; `reason` says why. Never paid. */
  status       text not null default 'pending'
               check (status in ('pending', 'qualified', 'rejected')),
  reason       text,
  /* What the referrer was actually paid, copied at the moment of payment so a
     later price change never rewrites history. */
  amount       numeric(12, 4) not null default 0,
  qualified_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists credit_referrals_referrer_idx
  on public.credit_referrals (referrer, created_at desc);
create index if not exists credit_referrals_status_idx
  on public.credit_referrals (status, created_at desc);

-- Nothing reads this table directly: it is reached only through the definer
-- functions below, which is why RLS is on with no policy at all.
alter table public.credit_referrals enable row level security;
revoke all on public.credit_referrals from anon, authenticated;

-- ---------------------------------------------------------- the code
-- The caller's own invite code, minted on first ask. Deliberately short and
-- unambiguous: no 0/O or 1/I, so it survives being read aloud or typed from a
-- screenshot. The code is derived from the identity hash, never from the email
-- or the user id, so it reveals nothing about the person.
create or replace function public.referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  identity  text;
  existing  text;
  candidate text;
  alphabet  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt   integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  identity := public.credit_identity();
  if identity is null then
    return null;
  end if;

  select referral_code into existing from public.credit_identities
  where identity_hash = identity for update;
  if existing is not null then
    return existing;
  end if;

  -- Eight characters from a 32-symbol alphabet. A collision simply means
  -- another go; the unique index is what actually guarantees uniqueness.
  loop
    attempt := attempt + 1;
    candidate := '';
    for i in 1..8 loop
      candidate := candidate ||
        substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;

    exit when not exists (
      select 1 from public.credit_identities where referral_code = candidate
    );
    if attempt > 20 then
      raise exception 'could not mint a referral code';
    end if;
  end loop;

  update public.credit_identities
  set referral_code = candidate
  where identity_hash = identity;

  return candidate;
end $BODY$;

revoke all on function public.referral_code() from public, anon;
grant execute on function public.referral_code() to authenticated;

-- --------------------------------------------------------- accepting one
-- Records that the caller arrived through someone's code. This pays nobody:
-- it creates a 'pending' referral, and the money question is settled later by
-- settle_referral() once the qualifying action is actually done.
create or replace function public.accept_referral(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  identity   text;
  inviter    text;
  already    text;
  welcome    numeric(12, 4);
  rule_row   public.credit_rules;
  month_start timestamptz := date_trunc('month', now() at time zone 'utc');
  paid_this_month integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  identity := public.credit_identity();
  if identity is null then
    return jsonb_build_object('ok', false, 'reason', 'Could not identify this account.');
  end if;

  select * into rule_row from public.credit_rules where key = 'referral' and enabled;
  if rule_row is null then
    return jsonb_build_object('ok', false, 'reason', 'Invites are not running at the moment.');
  end if;

  -- Locked, so two tabs cannot both attach this identity to a referrer.
  select referred_by into already from public.credit_identities
  where identity_hash = identity for update;
  if already is not null then
    return jsonb_build_object('ok', false, 'reason', 'You have already used an invite code.');
  end if;
  -- An identity that has already been invited once is spent, even if the row
  -- was written for an account that has since been deleted.
  if exists (select 1 from public.credit_referrals where invitee = identity) then
    return jsonb_build_object('ok', false, 'reason', 'This account has already been invited.');
  end if;

  select identity_hash into inviter from public.credit_identities
  where referral_code = upper(trim(code));
  if inviter is null then
    return jsonb_build_object('ok', false, 'reason', 'That invite code is not valid.');
  end if;
  -- The whole point of hashing an identity rather than keying on the account:
  -- the same person under a new account is the same hash, so this catches a
  -- self-referral that a user_id check would wave through.
  if inviter = identity then
    return jsonb_build_object('ok', false, 'reason', 'You cannot invite yourself.');
  end if;

  -- The referrer's monthly cap is checked here as well as at payment, so an
  -- invite that could never be paid is refused rather than left pending.
  if rule_row.daily_limit > 0 then
    select count(*) into paid_this_month from public.credit_referrals
    where referrer = inviter and status = 'qualified' and qualified_at >= month_start;
    if paid_this_month >= rule_row.daily_limit then
      return jsonb_build_object(
        'ok', false,
        'reason', 'That account has reached its invite limit for this month.'
      );
    end if;
  end if;

  update public.credit_identities
  set referred_by = inviter, referred_at = now()
  where identity_hash = identity;

  insert into public.credit_referrals (referrer, invitee, status)
  values (inviter, identity, 'pending')
  on conflict (invitee) do nothing;

  -- The invited person's own welcome bonus, if the offer is two-sided. Paid
  -- through award_credits() like everything else, so the ceiling applies.
  select amount into welcome from public.credit_rules
  where key = 'referral_welcome' and enabled;
  if welcome is not null and welcome > 0 then
    begin
      perform public.award_credits(auth.uid(), welcome, 'referral_welcome', identity,
                                   jsonb_build_object('referrer', inviter));
    exception when others then
      -- A full supply must not stop the invite being recorded; the referrer's
      -- own reward is attempted separately, later.
      null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'welcome', coalesce(welcome, 0));
end $BODY$;

revoke all on function public.accept_referral(text) from public, anon;
grant execute on function public.accept_referral(text) to authenticated;

-- ----------------------------------------------------- has it qualified?
-- The qualifying action, checked against the invited account's own rows. The
-- client is not asked and is not believed: this is the same approach as
-- credit_task_progress(), and it is why sharing or copying a link can never
-- pay anybody.
create or replace function public.referral_qualified(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $BODY$
  -- Held a real conversation: three assistant replies. Enough to mean the
  -- invite produced a user rather than a sign-up.
  select count(*) >= 3
  from public.messages m
  where m.user_id = target_user and m.role = 'assistant';
$BODY$;

revoke all on function public.referral_qualified(uuid) from public, anon;

-- ------------------------------------------------------------ settling
-- Pays the referrer if, and only if, the caller was invited and has now done
-- the qualifying action. Called whenever the caller's wallet is read, so it
-- settles itself without a cron; every branch is idempotent.
create or replace function public.settle_referral()
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  identity    text;
  row_ref     public.credit_referrals;
  rule_row    public.credit_rules;
  inviter_id  uuid;
  month_start timestamptz := date_trunc('month', now() at time zone 'utc');
  paid_this_month integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  identity := public.credit_identity();
  if identity is null then
    return jsonb_build_object('settled', false);
  end if;

  -- Locked: two concurrent wallet reads must not both pay the referrer.
  select * into row_ref from public.credit_referrals
  where invitee = identity and status = 'pending' for update;
  if row_ref is null then
    return jsonb_build_object('settled', false);
  end if;

  if not public.referral_qualified(auth.uid()) then
    return jsonb_build_object('settled', false);
  end if;

  select * into rule_row from public.credit_rules where key = 'referral' and enabled;
  if rule_row is null then
    return jsonb_build_object('settled', false);
  end if;

  -- The referrer must still have an account to pay. If they have deleted it,
  -- the row is closed rather than left pending for ever.
  select current_user_id into inviter_id from public.credit_identities
  where identity_hash = row_ref.referrer;
  if inviter_id is null then
    update public.credit_referrals
    set status = 'rejected', reason = 'The inviting account no longer exists.'
    where id = row_ref.id;
    return jsonb_build_object('settled', false);
  end if;

  -- The monthly cap, counted on qualified referrals for this referrer.
  if rule_row.daily_limit > 0 then
    select count(*) into paid_this_month from public.credit_referrals
    where referrer = row_ref.referrer and status = 'qualified' and qualified_at >= month_start;
    if paid_this_month >= rule_row.daily_limit then
      update public.credit_referrals
      set status = 'rejected', reason = 'Monthly invite limit reached.'
      where id = row_ref.id;
      return jsonb_build_object('settled', false);
    end if;
  end if;

  -- Stamp first, then pay, both in this transaction: a failure in the award —
  -- the circulation ceiling, say — rolls the stamp back with it, so the
  -- referral stays pending and can settle later rather than being lost.
  update public.credit_referrals
  set status = 'qualified', amount = rule_row.amount, qualified_at = now()
  where id = row_ref.id;

  perform public.award_credits(inviter_id, rule_row.amount, 'referral', identity,
                               jsonb_build_object('invitee', identity));

  return jsonb_build_object('settled', true, 'granted', rule_row.amount);
end $BODY$;

revoke all on function public.settle_referral() from public, anon;
grant execute on function public.settle_referral() to authenticated;

-- ------------------------------------------------- what the modal shows
-- The caller's own referral standing. Read-only; the counts come from the
-- referral rows, and the credits earned from the rows' own recorded amounts.
create or replace function public.referral_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $BODY$
declare
  identity    text;
  rule_row    public.credit_rules;
  month_start timestamptz := date_trunc('month', now() at time zone 'utc');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  identity := public.credit_identity();
  if identity is null then
    return jsonb_build_object('code', null);
  end if;

  select * into rule_row from public.credit_rules where key = 'referral';

  return jsonb_build_object(
    'code', (select referral_code from public.credit_identities where identity_hash = identity),
    'enabled', coalesce(rule_row.enabled, false),
    'reward', coalesce(rule_row.amount, 0),
    'welcome', coalesce((select amount from public.credit_rules
                         where key = 'referral_welcome' and enabled), 0),
    'monthlyLimit', coalesce(rule_row.daily_limit, 0),
    'monthlyCount', (
      select count(*) from public.credit_referrals
      where referrer = identity and status = 'qualified' and qualified_at >= month_start
    ),
    'successful', (
      select count(*) from public.credit_referrals
      where referrer = identity and status = 'qualified'
    ),
    'pending', (
      select count(*) from public.credit_referrals
      where referrer = identity and status = 'pending'
    ),
    'earned', (
      select coalesce(sum(amount), 0) from public.credit_referrals
      where referrer = identity and status = 'qualified'
    ),
    -- The history the modal lists. Deliberately anonymous: a referrer learns
    -- that someone joined and what it paid, never who they are.
    'history', coalesce((
      select jsonb_agg(row_to_json(h)) from (
        select r.id, r.status, r.amount, r.created_at, r.qualified_at, r.reason
        from public.credit_referrals r
        where r.referrer = identity
        order by r.created_at desc
        limit 25
      ) h), '[]'::jsonb)
  );
end $BODY$;

revoke all on function public.referral_summary() from public, anon;
grant execute on function public.referral_summary() to authenticated;

-- ======================================================================
-- v0.28 — the referral summary is genuinely read-only
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- v0.27 had referral_summary() marked `stable` while calling credit_identity(),
-- which INSERTs the identity row on first sight. Postgres runs a `stable`
-- function in a read-only transaction, so the insert failed with "cannot
-- execute INSERT in a read-only transaction" and GET /api/credits/referrals
-- answered 500 for anyone whose identity row happened to need touching.
--
-- The mistake was structural rather than a matter of volatility labelling:
-- a *summary* had a side effect at all. Reading how many people you have
-- invited should not create anything, settle anything, or pay anyone. So the
-- read and the write are split here:
--
--   credit_identity()        — unchanged. Still the one place an identity row
--                              is created, still used by every write path.
--   credit_identity_read()   — new, and pure. Computes the same hash and looks
--                              it up, returning null when there is no row yet
--                              rather than creating one.
--   referral_summary()       — now uses the read-only lookup and SELECTs only.
--   referral_code()          — unchanged and still the only minting path, but
--                              no longer called on a GET.
--
-- Nothing about the anti-farming behaviour changes: the hash is computed the
-- same way from the same source, so an identity that already exists resolves
-- to exactly the row it always did. An account with no identity row yet simply
-- has no referral standing to show, which is true — it has never been invited
-- and has never invited anyone.

-- ------------------------------------------------- the read-only identity
-- The same hash as credit_identity(), with no write of any kind. Returns null
-- when the identity has never been recorded, which a caller renders as "no
-- code yet" rather than treating as an error.
--
-- Security definer for one reason only: auth.identities is not readable by an
-- ordinary role. Only the hash ever leaves the function, and the same
-- "a caller may only ask about itself" rule applies as before.
create or replace function public.credit_identity_read(target_user uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $BODY$
declare
  who     uuid := coalesce(target_user, auth.uid());
  subject text;
  hashed  text;
begin
  if who is null then
    raise exception 'authentication required';
  end if;
  if auth.uid() is not null and who is distinct from auth.uid() then
    raise exception 'a caller may only read their own identity';
  end if;

  -- Identical derivation to credit_identity(), deliberately: the two must
  -- agree, or a read would miss the row a write had created.
  select i.provider || ':' || i.provider_id into subject
  from auth.identities i
  where i.user_id = who and i.provider <> 'email'
  order by i.created_at
  limit 1;

  if subject is null then
    select 'email:' || lower(trim(u.email)) into subject
    from auth.users u where u.id = who;
  end if;

  if subject is null then
    return null;
  end if;

  hashed := encode(sha256(convert_to('ugnay-credit-identity:' || subject, 'UTF8')), 'hex');

  -- The one difference: look, do not create.
  return (
    select identity_hash from public.credit_identities where identity_hash = hashed
  );
end $BODY$;

revoke all on function public.credit_identity_read(uuid) from public, anon;
grant execute on function public.credit_identity_read(uuid) to authenticated;

-- ------------------------------------------------------------ the summary
-- Now what its name says: SELECTs only. No identity is created, no code is
-- minted, no referral is settled and nothing is ever paid from here.
--
-- An account with no identity row, or with one that has no code yet, gets
-- 'code' => null. The modal asks for a code explicitly, through the POST that
-- mints one, rather than a read quietly creating it.
create or replace function public.referral_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $BODY$
declare
  identity    text;
  rule_row    public.credit_rules;
  month_start timestamptz := date_trunc('month', now() at time zone 'utc');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  -- The read-only lookup: null simply means "nothing recorded yet".
  identity := public.credit_identity_read();

  select * into rule_row from public.credit_rules where key = 'referral';

  if identity is null then
    -- No identity row yet, so there is genuinely nothing to report. The prices
    -- are still returned, so the modal can explain the offer.
    return jsonb_build_object(
      'code', null,
      'enabled', coalesce(rule_row.enabled, false),
      'reward', coalesce(rule_row.amount, 0),
      'welcome', coalesce((select amount from public.credit_rules
                           where key = 'referral_welcome' and enabled), 0),
      'monthlyLimit', coalesce(rule_row.daily_limit, 0),
      'monthlyCount', 0,
      'successful', 0,
      'pending', 0,
      'earned', 0,
      'history', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'code', (select referral_code from public.credit_identities where identity_hash = identity),
    'enabled', coalesce(rule_row.enabled, false),
    'reward', coalesce(rule_row.amount, 0),
    'welcome', coalesce((select amount from public.credit_rules
                         where key = 'referral_welcome' and enabled), 0),
    'monthlyLimit', coalesce(rule_row.daily_limit, 0),
    'monthlyCount', (
      select count(*) from public.credit_referrals
      where referrer = identity and status = 'qualified' and qualified_at >= month_start
    ),
    'successful', (
      select count(*) from public.credit_referrals
      where referrer = identity and status = 'qualified'
    ),
    'pending', (
      select count(*) from public.credit_referrals
      where referrer = identity and status = 'pending'
    ),
    'earned', (
      select coalesce(sum(amount), 0) from public.credit_referrals
      where referrer = identity and status = 'qualified'
    ),
    'history', coalesce((
      select jsonb_agg(row_to_json(h)) from (
        select r.id, r.status, r.amount, r.created_at, r.qualified_at, r.reason
        from public.credit_referrals r
        where r.referrer = identity
        order by r.created_at desc
        limit 25
      ) h), '[]'::jsonb)
  );
end $BODY$;

revoke all on function public.referral_summary() from public, anon;
grant execute on function public.referral_summary() to authenticated;

-- ---------------------------------------------------------- the settling
-- Unchanged in what it does and who it pays; it is simply no longer reached
-- from a GET. It stays volatile — it writes, and it is called from a POST and
-- from the wallet read, both of which are write transactions.
--
-- Re-stated here only so that a project running v0.27 gets the grant list and
-- the comment corrected in one place.
revoke all on function public.settle_referral() from public, anon;
grant execute on function public.settle_referral() to authenticated;

revoke all on function public.referral_code() from public, anon;
grant execute on function public.referral_code() to authenticated;

-- ======================================================================
-- v0.29 — GCash goes live, with the QR still to come
-- Idempotent like everything above: safe to re-run on an existing project.
-- ======================================================================
--
-- v0.26 built the manual payment flow but shipped every method unconfigured,
-- so GCash was greyed out. This gives it the real account it takes payment to,
-- which is what flips it to available.
--
-- The QR is deliberately left empty. A method needs a destination to be
-- payable, not a QR — so GCash is fully usable by number today, and the store
-- says "QR coming soon" rather than showing a placeholder image that would be
-- worse than nothing. Uploading a real QR in Admin fills it in later with no
-- further change here.
--
-- PayPal is untouched: still 'unavailable', still greyed out, still waiting on
-- a real integration.
--
-- Nothing about granting changes. A payment is still worth nothing until an
-- admin approves it in Admin → Payments, and approval still runs through
-- review_credit_order() → award_credits(), which is latched on granted_at and
-- bounded by the circulation ceiling.

-- The account payments actually go to. A destination is public by nature — it
-- is how someone pays — so this is not a secret, and it is the one thing that
-- makes the method available to buyers.
--
-- Written only where the row is still unconfigured, so an admin who has since
-- set a different number in Admin → Payments keeps theirs.
update public.payment_methods
set destination  = '09761025310',
    account_name = 'Re***l M.',
    enabled      = true
where id = 'gcash'
  and coalesce(trim(destination), '') = '';

-- The instructions match a number-only flow: no "scan the QR" step while there
-- is no QR to scan. Corrected only from the value v0.26 seeded, so an admin's
-- own wording survives.
update public.payment_methods
set instructions =
      'Send the exact amount to the GCash number shown above.' || E'\n' ||
      'Copy the reference number GCash gives you.' || E'\n' ||
      'Fill in the amount you sent, attach your receipt screenshot, and submit for review.'
where id = 'gcash'
  and instructions =
      'Send the exact amount to the GCash account shown, or scan the QR code.' || E'\n' ||
      'Copy the reference number GCash gives you.' || E'\n' ||
      'Fill in the amount you sent, attach your receipt screenshot, and submit for review.';

-- Belt and braces: no QR path is set, so the store shows "QR coming soon"
-- rather than a broken image. This clears a path only if one was seeded by
-- mistake; a real QR an admin has uploaded is left exactly where it is.
update public.payment_methods
set qr_path = ''
where id = 'gcash' and qr_path <> '' and qr_path not like 'public/%'
  and qr_path not like 'http%';
