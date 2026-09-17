# Ugnay

AI-powered workspace for chat, productivity, and knowledge management.

[![Latest release](https://img.shields.io/github/v/release/codewithryry/Ugnay?label=release)](https://github.com/codewithryry/Ugnay/releases/latest)
[![Download APK](https://img.shields.io/badge/download-Android%20APK-success)](https://github.com/codewithryry/Ugnay/releases/latest)

Ugnay puts several AI models behind one interface, keeps your conversations in
workspaces, and answers questions about the documents you upload. It runs on the
web and as an Android app, both talking to the same account and the same data.

## Features

- Streaming AI chat, with per-message Thinking and Web search toggles
- Multiple providers behind one interface — OpenRouter, Groq, Gemini, Cohere, Puter
- Knowledge (file RAG): uploaded documents are indexed and recalled per answer
- Workspaces, prompts, branching, sharing, model compare and export
- Supabase auth with Row Level Security on every table
- Android APK, plus an installable PWA on the web

## Download

Get the latest Android APK from
[**Releases**](https://github.com/codewithryry/Ugnay/releases/latest).

### Install on Android

1. Download `Ugnay-AI-v<version>.apk` from Releases.
2. Open it on your device.
3. Allow installation from your browser or file manager if prompted.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires Node 22 or newer.

Copy `.env.example` to `.env.local` and fill in your own values — a Supabase URL
and publishable key, plus at least one AI provider key. Provider keys are
server-only; never prefix them with `NEXT_PUBLIC_`.

Then run [`supabase/schema.sql`](supabase/schema.sql) in your Supabase SQL
editor. It is idempotent and creates every table, trigger, function and RLS
policy.

## Build

```bash
npm run build                # web
npm run android:apk          # release APK
```

The Android build needs the Android SDK and JDK 21, and
`NEXT_PUBLIC_API_ORIGIN` set to the deployed site the app should call:

```bash
NEXT_PUBLIC_API_ORIGIN=https://ugnayai.vercel.app npm run android:sync
```

Releases are built by [`.github/workflows/android.yml`](.github/workflows/android.yml),
which signs the APK and attaches it to the GitHub release.

## Disclaimer

Ugnay is an independent project. It is not affiliated with, endorsed by, or
sponsored by OpenAI, Google, Supabase, or any other provider it integrates with.

## License

No license has been declared for this project, so default copyright applies and
all rights are reserved. Open an issue if you want to use the code.
