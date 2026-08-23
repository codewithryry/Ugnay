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
