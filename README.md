# Ugnay

A minimal AI chat workspace: talk to several models in one place, keep conversations in
workspaces, and own your data. Built with Next.js (App Router), Tailwind CSS, Zustand, Supabase
and OpenRouter.

- **Streaming chat** over an NDJSON endpoint, with per-message Thinking and Web search toggles.
- **Multiple providers** behind one interface — OpenRouter, Groq, Google Gemini, Cohere and Puter.
- **Workspaces** (projects) that own their conversations and their own instructions.
- **Supabase auth** with email/password and Google sign-in, and Row Level Security on every table.
- **Installable PWA**, responsive from phone to desktop, light/dark/system themes.

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Create the database.** In your Supabase project, open the SQL editor and run
   [`supabase/schema.sql`](supabase/schema.sql). It is idempotent — re-run it after pulling changes.
   It creates `profiles`, `chats`, `projects`, `messages`, `user_settings`, `message_embeddings`,
   `message_feedback` and `app_feedback`, their indexes and triggers, and the RLS policies that
   isolate each user's data.

3. **Configure the environment.** Copy `.env.example` to `.env.local` and fill it in:

   | Variable | Where it runs | Required | Purpose |
   | --- | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | browser + server | yes | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | yes | Supabase anon/publishable key |
   | `OPENROUTER_API_KEY` | **server only** | yes | OpenRouter credentials — also powers text-to-speech and dictation clean-up |
   | `OPENROUTER_SITE_URL` | server only | no | Sent as `HTTP-Referer` to OpenRouter |
   | `OPENROUTER_APP_NAME` | server only | no | Sent as `X-Title` to OpenRouter |
   | `GROQ_API_KEY` | server only | no | Enables the Groq provider |
   | `GEMINI_API_KEY` | server only | no | Enables the Google Gemini provider |
   | `COHERE_API_KEY` | server only | no | Enables the Cohere provider |
   | `PUTER_API_TOKEN` | server only | no | Enables the Puter provider (metered — see below) |
   | `PUTER_MAX_TOKENS`, `PUTER_HISTORY_TURNS` | server only | no | Puter request limits |
   | `PUTER_MONTHLY_LIMIT` | server only | no | Puter replies allowed per account per month (default 50) |

   Provider keys must never be prefixed with `NEXT_PUBLIC_`. They are read exclusively inside
   `lib/providers/*` and the API routes, which run on the server. A provider whose key is unset is
   reported as `configured: false` and never appears in the model picker.

4. **Run**

   ```bash
   npm run dev        # development server on :3000
   npm run typecheck  # tsc --noEmit
   npm run lint       # next lint
   npm run build      # production build
   npm start          # serve the production build
   ```

   Sign up at `/login`, then start chatting. Every unauthenticated route redirects to the login page
   via `middleware.ts`.

### Google sign-in

`/login` offers "Continue with Google" alongside email/password. The Google client id and secret are
held by Supabase, not this app — there is nothing to add to `.env`:

1. Google Cloud console → Credentials → OAuth client (Web application). Authorised redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase dashboard → Authentication → Providers → Google: enable it and paste the client id and
   secret.
3. Supabase dashboard → Authentication → URL Configuration: add `http://localhost:3000/**` (and your
   deployed origin) to the redirect allow-list.

The browser is sent to Google, returns to `/auth/callback`, which exchanges the code for a session
and forwards to `next`. The `handle_new_user` trigger creates the profile and settings rows, and
`getCurrentUser()` self-heals them for accounts that predate it.

### Deployment

The app is a standard Next.js 14 App Router project and deploys unchanged to any Node host
(Vercel being the path of least resistance):

1. Set every variable from the table above in the host's environment. Only the two
   `NEXT_PUBLIC_*` values are exposed to the browser.
2. Set `OPENROUTER_SITE_URL` to the deployed origin.
3. Add that origin to Supabase → Authentication → URL Configuration, so OAuth can return to it.
4. Run `supabase/schema.sql` against the production project.
5. Build with `npm run build`. The API routes need the Node runtime (they declare
   `runtime = "nodejs"`), so a static export is not supported.

## Features

### Chat

- Replies stream token by token; **Stop** ends a stream mid-flight and keeps what arrived.
- **Thinking** (low/medium/high) and **Web search** are per-message toggles, read from the request
  that turn, so flipping one takes effect on the next message.
- Messages can be edited and resent, rated up/down, copied, and read aloud (text-to-speech through
  OpenRouter).
- **Dictation** transcribes speech in the composer, with optional clean-up ("Tidy up" / "Fully
  refine") through `/api/refine`.
- **Temporary chat** answers without writing anything to the database — no chat row, no messages,
  and cross-chat memory is skipped.
- Conversation titles are generated from the first user + assistant exchange, so greetings and typos
  do not become titles; a chat with no topic yet keeps the "New chat" placeholder.
- Markdown rendering with GFM, syntax-highlighted code blocks, and an optional line-wrap setting.

### Models and fallback

Every provider implements `ChatProvider` from [`lib/providers/types.ts`](lib/providers/types.ts):
`isConfigured()`, `listModels()` and `streamChat()` yielding normalised `reasoning` / `delta` /
`usage` events. The chat route and the UI only ever speak that interface, and the picker renders
whatever the catalog reports.

The default is `openrouter/free` ("Auto"), OpenRouter's free router. Fallback behaviour depends on
the choice:

- **Auto** may switch to another configured model when the upstream is busy or failing, and reports
  the substitution as a notice.
- **A model you picked yourself** is never swapped silently. It is retried once without the optional
  extras (some upstreams reject `reasoning`/web plugins), and if it still fails the turn stops with
  a **Change model** action that opens the picker.

Puter is excluded from automatic selection because it draws on a metered balance, and its replies
are capped per account per calendar month (`PUTER_MONTHLY_LIMIT`, default 50).

Adding a provider is two steps: write `lib/providers/<name>.ts` exporting a `ChatProvider` — reusing
`streamOpenAICompatible` if the API is OpenAI-shaped, as `lib/providers/groq.ts` does — then add it
to the `REGISTRY` array in `lib/providers/index.ts`. No UI change is needed.

### Workspaces

A workspace (`projects` row) is a named folder for conversations. Opening one reopens its most
recent conversation; its `+` starts a new one inside it; a chat created there carries `project_id`
and is listed under the workspace instead of History. The workspace panel beside the conversation
holds its **Instructions**, which are sent with every conversation in that workspace alongside your
global instructions, and its name. Deleting a workspace keeps its conversations — they return to
History.

### Instructions and memory

`composeSystemPrompt()` merges the global instruction (`user_settings.global_system_prompt`) with the
workspace instructions and the per-chat override, the narrower scope last so it wins on conflicts.
Presets fill in the global field.

With **Settings → Data Controls → personalise with history** on, each turn is matched against the
account's own earlier messages by vector similarity (`message_embeddings`, 1,024-dimension
embeddings via Cohere, `match_user_messages` scoped by `auth.uid()`), falling back to a digest of
recent conversation titles. It is off by default.

### Sidebar and navigation

Search, New Chat, Projects and History, collapsible to an icon rail. History is grouped by date
(Today / Yesterday / Previous 7 Days / Older) and scrolls independently of the fixed navigation and
account area. Conversations can be renamed, deleted and shared by link. The open conversation is
reflected in the route (`/?chat=<id>`), so a refresh reopens exactly that chat and New Chat stays
empty. `/search` is a full-text search over your conversations.

### Settings

Account (display name, nickname), Appearance (light/dark/system theme, code line wrapping),
Behavior (auto-scroll, notify when a reply finishes, Cmd/Ctrl+Enter to submit, rich-text composer,
dictation refinement), Customize (global and per-chat instructions, presets) and Data Controls
(improve-the-model opt-in, share links, personalisation, full export). Export downloads every
conversation as a single `.zip`: one Markdown file per chat, a JSON export and a readable index.

### Pages

`/upgrade` lists the plan tiers (presentation only — no billing provider is connected, so every
account is on Free), `/faq`, `/release-notes` and `/feedback`, which stores submissions in
`app_feedback` against the sending account.

## Architecture

```
app/
  (chat)/page.tsx            Server component: auth gate + profile, renders the client app
  api/chat/route.ts          Provider router, NDJSON streaming, titles, memory (holds the keys)
  api/models/route.ts        Which providers/models are configured (booleans and ids only)
  api/refine/route.ts        Dictation clean-up
  api/speech/route.ts        Text-to-speech for a reply
  api/export/route.ts        Every conversation as a .zip
  api/feedback/route.ts      Feedback submissions
  auth/callback/route.ts     Supabase code → session exchange
  faq/ release-notes/ feedback/ upgrade/ search/ login/
components/                  Sidebar, ChatWindow, MessageList, Composer, ModelSelector,
                             WorkspacePanel, SettingsPanel, AccountMenu, SearchOverlay, …
lib/providers/               Unified provider interface + OpenRouter, Groq, Gemini, Cohere, Puter,
                             plus speech
lib/supabase/                Browser, server and middleware Supabase clients
lib/prompt.ts                System-prompt composition and the title pass
lib/help.ts                  FAQ and release-notes content
store/chatStore.ts           Zustand: chats, projects, messages, streaming, settings
supabase/schema.sql          Tables, indexes, triggers, RLS
```

### Security

Row Level Security is enabled on every table and each policy is scoped to `auth.uid()`. The
`messages` policy additionally requires the parent chat to belong to the caller, so a message cannot
be attached to someone else's conversation. All browser reads and writes go through the
authenticated Supabase client; provider keys are only ever read server-side, and `/api/models`
returns booleans and model ids, never a key.
