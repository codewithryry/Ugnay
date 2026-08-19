# Ugnay

A minimal, Grok/ChatGPT-style AI chat workspace built with Next.js (App Router), Tailwind CSS,
Zustand, Supabase and OpenRouter.

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Create the database.** In your Supabase project, open the SQL editor and run
   [`supabase/schema.sql`](supabase/schema.sql). It creates `profiles`, `chats`, `messages` and
   `user_settings`, the indexes and triggers, and the RLS policies that isolate each user's data.

3. **Configure the environment.** Copy `.env.example` to `.env.local` and fill it in:

   | Variable | Where it runs | Purpose |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | Supabase anon/publishable key |
   | `OPENROUTER_API_KEY` | **server only** | OpenRouter credentials |

   Provider keys must never be prefixed with `NEXT_PUBLIC_`. They are read exclusively inside
   `lib/providers/*` and `app/api/chat/route.ts`, which run on the server.

4. **Run**

   ```bash
   npm run dev
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

## Architecture

```
app/
  (chat)/page.tsx         Server component: auth gate + profile, renders the client app
  api/chat/route.ts       Provider router + NDJSON streaming endpoint (holds the API keys)
  api/models/route.ts     Which providers/models are configured (booleans and ids only)
  auth/callback/route.ts  Supabase code → session exchange
components/               Sidebar, ChatWindow, MessageList, UserMessage, AssistantMessage,
                          Composer, ModelSelector, CustomInstructionsModal, SettingsPanel, …
lib/providers/            Unified provider interface + OpenRouter (active), Groq/Gemini/HF (dormant)
lib/supabase/             Browser, server and middleware Supabase clients
lib/prompt.ts             Combines the global system prompt with the per-chat override
store/chatStore.ts        Zustand: chats, messages, streaming, settings
supabase/schema.sql       Tables, indexes, triggers, RLS
```

### Provider abstraction

Every provider implements `ChatProvider` from [`lib/providers/types.ts`](lib/providers/types.ts):
`isConfigured()`, `listModels()` and `streamChat()` yielding normalised `delta` / `usage` / `done`
events. The chat route and the UI only ever speak that interface.

Adding a provider is two steps:

1. Write `lib/providers/<name>.ts` exporting a `ChatProvider`. If the provider is OpenAI-compatible
   (Groq, Cohere, most gateways) reuse `streamOpenAICompatible` and supply a base URL, key and
   model list — see `lib/providers/groq.ts`. Otherwise normalise the wire format yourself, as
   `lib/providers/gemini.ts` does for Gemini.
2. Add it to the `REGISTRY` array in `lib/providers/index.ts`.

No UI change is needed: the model selector renders whatever the catalog reports, and providers
without their key set are marked `configured: false` and hidden.

The default is `openrouter/free`, OpenRouter's free router, so the MVP never depends on a paid
model. Other free models are offered alongside it so no single model is a hard dependency.

### System prompts

`composeSystemPrompt()` merges the persistent global instruction (`user_settings.global_system_prompt`)
with the per-chat override (`chats.system_prompt`), the per-chat note last so it wins on conflicts.
Both are editable from **Customize Ugnay**; presets (Coding / Casual / Formal, plus your own) fill in
the global field.

### Security

Row Level Security is enabled on all four tables and every policy is scoped to `auth.uid()`. The
`messages` policy additionally requires the parent chat to belong to the caller, so a message cannot
be attached to someone else's conversation. All reads and writes from the browser go through the
authenticated Supabase client, so a user only ever sees their own rows.

## Extending later

The schema and interfaces leave room for the planned follow-ups without a rewrite: `ModelInfo`
carries a `capabilities` list for vision/tool models, `messages` records provider, model and token
usage per row, and the chat route already separates history loading from persistence — the hooks
regenerate, edit, branching, search and export would need.
