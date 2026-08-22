"use client";

import Link from "next/link";
import { FolderClosed, History, Layers, Library } from "lucide-react";

/**
 * What an account adds, listed beside the call to action.
 *
 * Each line is something the app does today, and the icons are the ones the
 * sidebar already uses for those surfaces, so the promise and the product
 * match. Nothing pending belongs here.
 */
const FEATURES = [
  { icon: Layers, label: "Multiple AI models" },
  { icon: History, label: "Saved chat history" },
  { icon: FolderClosed, label: "Workspaces" },
  { icon: Library, label: "Chat with your files" },
];

/**
 * Stands in for the assistant's reply on the signed-out landing.
 *
 * A visitor's first message is shown in the transcript exactly as it would be
 * once signed in; this takes the place the answer would occupy, because there
 * is no account to answer against yet. Both actions carry `next`, so the
 * callback returns here and the composer restores the pending message.
 *
 * Source order is the phone/PWA order — text, then the feature list, then the
 * actions last. Desktop keeps the two-column arrangement by placing the cells
 * explicitly, so the actions sit under the text and the list moves to the
 * right without either being duplicated.
 */
export default function SignupPromptCard({ next = "/" }: { next?: string }) {
  const target = encodeURIComponent(next);

  return (
    <div className="animate-fade-in rounded-2xl border border-ink-800 bg-ink-900 p-4 sm:p-5">
      <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:gap-x-8 sm:gap-y-5">
        <div className="min-w-0 sm:col-start-1 sm:row-start-1">
          <h2 className="text-base font-semibold tracking-tight text-neutral-100">
            Continue your conversation
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">
            Sign up to continue seamlessly with Ugnay&rsquo;s full power
          </p>
        </div>

        <ul className="space-y-3 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:w-56">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2.5 text-sm text-neutral-300">
              <Icon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
              {label}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2.5 sm:col-start-1 sm:row-start-2 sm:self-end">
          <Link
            href={`/login?mode=signup&next=${target}`}
            className="rounded-full bg-neutral-100 px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:opacity-90"
          >
            Sign up for free
          </Link>
          <Link
            href={`/login?next=${target}`}
            className="rounded-full border border-ink-700 px-5 py-2.5 text-sm text-neutral-200 transition hover:bg-ink-850 hover:text-neutral-100"
          >
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
