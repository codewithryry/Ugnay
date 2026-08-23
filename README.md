# Ugnay

A minimal AI chat workspace: several models in one place, conversations kept in workspaces, your
files answerable, and your data your own. Next.js (App Router), Tailwind, Zustand, Supabase.

- **Streaming chat** over NDJSON, with per-message Thinking and Web search toggles.
- **Multiple providers** behind one interface — OpenRouter, Groq, Gemini, Cohere, Puter.
- **Auto routing** that ranks the configured models and falls through to another when one fails.
- **Workspaces, Knowledge (file RAG), prompts, branching, sharing, compare, canvas, export.**
- **Admin dashboard** for model availability, maintenance and system status.
- **Supabase auth**, Row Level Security on every table, installable PWA, light/dark themes.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

Then run [`supabase/schema.sql`](supabase/schema.sql) in your Supabase SQL editor. It is idempotent
— re-run it after pulling changes; it creates every table, trigger, function and RLS policy.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase anon/publishable key |
| `OPENROUTER_API_KEY` | yes | OpenRouter — also text-to-speech and dictation clean-up |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` | no | Sent as `HTTP-Referer` / `X-Title` |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `COHERE_API_KEY` | no | Enable those providers |
| `PUTER_API_TOKEN` | no | Enables Puter (metered) |
| `PUTER_MAX_TOKENS`, `PUTER_HISTORY_TURNS`, `PUTER_MONTHLY_LIMIT` | no | Puter limits (default 50/month) |

Provider keys are server-only — never prefix them with `NEXT_PUBLIC_`. A provider with no key
reports `configured: false` and never reaches the picker.

Scripts: `npm run dev` · `typecheck` · `lint` · `build` · `start`.

### Google sign-in

The client id and secret live in Supabase, not in `.env`:

1. Google Cloud → Credentials → OAuth client (Web). Redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Providers → Google: enable, paste id and secret.
3. Supabase → Authentication → URL Configuration: allow `http://localhost:3000/**` and your
   deployed origin.

### Deployment

Any Node host. Set the variables above, point `OPENROUTER_SITE_URL` at the deployed origin, add that
origin to Supabase's redirect allow-list, and run `supabase/schema.sql` against production. The API
routes need the Node runtime, so a static export is not supported.

## How it works

**Providers.** Each one implements `ChatProvider` (`isConfigured`, `listModels`, `streamChat`) from
[`lib/providers/types.ts`](lib/providers/types.ts) and is registered in `lib/providers/index.ts`.
Adding a provider is one module plus one line — reuse `streamOpenAICompatible` when the API is
OpenAI-shaped, as Groq does. No UI change is needed.

**Routing.** With no model of your own picked, the chat route ranks every configured, admin-enabled,
currently-responding model (provider priority, free first, failures on a short cooldown) and tries
up to five in turn. A model you picked yourself is never swapped: it is retried once without the
optional extras, then the turn stops with a **Change model** action. Puter is excluded from
automatic selection because it is metered.

**Admin.** `/admin` is admin-only (`profiles.role = 'admin'`, enforced server-side and by RLS). It
covers model and provider availability, maintenance and priority, live health, usage totals, the
training dataset, audit of model changes, and two switches: AI maintenance (chat offline) and site
maintenance (everything but the admin surface offline, behind `/maintenance`).

**Knowledge and memory.** Uploaded documents are chunked and embedded (Cohere, 1,024 dims); relevant
passages are recalled per turn and the files are named under the reply. With Data Controls →
personalise with history on, past messages are recalled the same way. Both are opt-in.

**Security.** RLS on every table, each policy scoped to `auth.uid()`; the `messages` policy also
requires the parent chat to belong to the caller. Provider keys are read only on the server;
`/api/models` returns booleans and ids.

## Layout

```
app/
  (chat)/page.tsx        Auth gate + profile, renders the client app
  admin/                 Admin dashboard (admin-only)
  api/chat/              Provider routing, NDJSON streaming, titles, memory, knowledge
  api/models/            Which providers/models are offerable
  api/admin/             Model controls, maintenance settings, overview totals
  api/knowledge|export|feedback|refine|speech|workflows/
  auth/callback/         Supabase code → session
  maintenance/ login/ search/ faq/ release-notes/ terms/ privacy/ upgrade/ s/[slug]/
components/              Sidebar, ChatWindow, Composer, ModelSelector, SettingsPanel, Admin*, …
lib/providers/           Provider interface + OpenRouter, Groq, Gemini, Cohere, Puter, embeddings
lib/supabase/            Browser, server and middleware clients
lib/model-controls.ts    Admin overrides read by routing
store/chatStore.ts       Zustand: chats, projects, messages, streaming, settings
supabase/schema.sql      Tables, functions, triggers, RLS
```

## Future features

Planned, not built yet:

- PDF text extraction for Knowledge, and image/vision attachments in chat.
- Billing behind the `/upgrade` tiers, with real per-account limits.
- Team workspaces: shared projects, shared prompts, per-member roles.
- Admin: per-account usage and rate limits, and a full audit log beyond model changes.
- Using the preserved training dataset to fine-tune a model.
- Scheduled workflows, and workflow steps that call tools.
