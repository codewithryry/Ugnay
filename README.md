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
| `REWARDED_AD_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | no | Rewarded ads: the network's callback secret, and the service role that callback grants with |
| `PAYPAL_PAYMENT_LINK`, `GCASH_NUMBER`, `GCASH_NAME`, `GCASH_QR_URL` | no | Where credit purchases are paid; a blank method is not offered |

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
routes need the Node runtime, so the web app cannot be served as a static export — only the Android
bundle is exported, and it calls the deployed API.

## Android app

Download the APK from [Releases](../../releases) and open it on the phone. Android asks for
permission to install from an unknown source the first time; the APK is signed, but not distributed
through Play.

The app ships only the interface. Chat, Knowledge and everything else server-side runs on the
deployed site, so no provider key is ever inside the APK, and Row Level Security applies to the app
exactly as it does to the browser.

### Building it

```bash
npm run android:sync                 # export the UI and copy it into android/
npm run android:apk:debug            # android/app/build/outputs/apk/debug/
```

`NEXT_PUBLIC_API_ORIGIN` selects the API the app calls, and defaults to nothing — set it to your
deployment:

```bash
NEXT_PUBLIC_API_ORIGIN=https://ugnayai.vercel.app npm run android:sync
```

Requires the Android SDK (via Android Studio) and JDK 21. `npm run android:open` opens the project
in Android Studio; `npm run android:assets` regenerates the launcher icons from `public/logo`.

### Releasing

Publishing a GitHub release runs `.github/workflows/android.yml`, which builds the APK and attaches
it as `Ugnay-AI-v<version>.apk`. The same workflow can be run manually from the Actions tab to get
an APK without releasing.

A release APK must be signed, or Android will refuse to install it. Generate a key once:

```bash
keytool -genkey -v -keystore release.keystore -alias ugnay \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore      # the value for ANDROID_KEYSTORE_BASE64
```

Keep `release.keystore` safe and out of the repository — an update can only be installed over an
existing app if it is signed with the same key. Then add these repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (`ugnay` above) |
| `ANDROID_KEY_PASSWORD` | Key password |
| `NEXT_PUBLIC_SUPABASE_URL` | Inlined into the bundle at build time |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Inlined into the bundle at build time |

Optionally set the `NEXT_PUBLIC_API_ORIGIN` repository *variable* to point a fork at its own
deployment. For Google sign-in from the app, add `com.ugnayai.app://auth-callback` to Supabase →
Authentication → URL Configuration.

## How it works

**Providers.** Each implements `ChatProvider` (`isConfigured`, `listModels`, `streamChat`) from
[`lib/providers/types.ts`](lib/providers/types.ts) and is registered in `lib/providers/index.ts`.
Adding one is a module plus a line; reuse `streamOpenAICompatible` for OpenAI-shaped APIs.

**Routing.** With no model picked, the chat route ranks every configured, admin-enabled, responding
model and tries up to five. A model you picked yourself is never swapped. Puter is excluded from
automatic selection because it is metered.

**Credits.** Priced in Admin → Credits and spent per 1,000 provider-reported tokens, plus extras for
web search, knowledge and personalisation. Balances move only through `spend_credits` /
`grant_credits`, which lock the wallet and append to an append-only ledger in one transaction.
One-time rewards are keyed to a hashed persistent identity, so deleting and recreating an account
cannot claim them twice. Purchases (PayPal, GCash) are verified by hand in Admin → Payments.

**Knowledge and memory.** Documents are chunked and embedded (Cohere, 1,024 dims) and relevant
passages recalled per turn. With Data Controls → personalise with history on, past messages are
recalled the same way. Both are opt-in.

**Security.** RLS on every table, each policy scoped to `auth.uid()`; the `messages` policy also
requires the parent chat to belong to the caller. Provider keys are read only on the server, and
`/api/models` returns booleans and ids. The Android app authenticates with a bearer token instead of
cookies, which changes the transport only — the same JWT, the same policies.

## Layout

```
app/
  (chat)/page.tsx        Auth gate + profile, renders the client app
  admin/                 Admin dashboard (admin-only)
  api/chat/              Provider routing, NDJSON streaming, titles, memory, knowledge
  api/models/            Which providers/models are offerable
  api/admin/             Model controls, maintenance settings, credit rules, overview totals
  api/credits/           Wallet, daily claim, tasks, orders, rewarded-ad callback
  api/knowledge|export|feedback|refine|speech|workflows/
  auth/callback/         Supabase code → session
  maintenance/ login/ search/ faq/ release-notes/ terms/ privacy/ upgrade/ s/[slug]/
components/              Sidebar, ChatWindow, Composer, ModelSelector, SettingsPanel, Admin*, …
lib/providers/           Provider interface + OpenRouter, Groq, Gemini, Cohere, Puter, embeddings
lib/supabase/            Browser, server, middleware and bearer-token clients
lib/api.ts               apiFetch: same-origin on the web, bearer token in the app
lib/cors.ts              Cross-origin access for the Android app
lib/native.ts            Capacitor: back button, OAuth deep links, splash
lib/model-controls.ts    Admin overrides read by routing
lib/credits.ts           Credit pricing, spending and rewards
lib/billing.ts           Payment methods for buying credits (manually verified)
lib/rewarded-ads.ts      Server-side verification of an ad network callback
store/chatStore.ts       Zustand: chats, projects, messages, streaming, settings
supabase/schema.sql      Tables, functions, triggers, RLS
android/                 Capacitor Android project (generated, then committed)
scripts/                 Android web export, icon generation, Gradle wrapper
```

## Future features

Planned, not built yet:

- PDF text extraction for Knowledge, and image/vision attachments in chat.
- Billing behind the `/upgrade` tiers, with real per-account limits.
- Team workspaces: shared projects, shared prompts, per-member roles.
- Admin: per-account usage and rate limits, and a full audit log beyond model changes.
- Using the preserved training dataset to fine-tune a model.
- Scheduled workflows, and workflow steps that call tools.
