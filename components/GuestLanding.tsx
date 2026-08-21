"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUp } from "lucide-react";
import SignupPromptCard from "./SignupPromptCard";
import { saveGuestDraft } from "@/lib/guest-draft";
import { useIsCompact } from "./useIsCompact";

const MAX_HEIGHT = 200;

/**
 * Terms / Privacy have no pages yet, so these read as emphasis rather than
 * links — a dead link is worse than plain text. Swap the spans for <Link>
 * once /terms and /privacy exist.
 */
function LegalTerm({ children }: { children: React.ReactNode }) {
  return <span className="text-neutral-500 underline underline-offset-2">{children}</span>;
}

/**
 * The signed-out landing: a New Chat a visitor can type into before they have
 * an account.
 *
 * Deliberately does not mount ChatApp. There is no session to initialise the
 * store with, so this surface talks to nothing — no Supabase call, no chat row,
 * no message. A sent message is shown in the transcript exactly as it would be
 * once signed in, and the sign-up card takes the place of the reply. Everything
 * lives in component state and is gone on reload; only the pending text is kept,
 * in the tab, so it can be restored after authenticating.
 */
export default function GuestLanding() {
  const [value, setValue] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const compact = useIsCompact();

  // Grow with the content, up to a cap, then scroll — same as the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (sent.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sent]);

  function submit() {
    const text = value.trim();
    if (!text) return;
    // The newest message is the one restored after signing in.
    saveGuestDraft(text);
    setSent((all) => [...all, text]);
    setValue("");
  }

  const started = sent.length > 0;

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-3xl"
    >
      <div className="rounded-3xl border border-ink-700 bg-ink-900 p-2 shadow-lg transition focus-within:border-ink-600">
        <label htmlFor="guest-composer" className="sr-only">
          Message Ugnay
        </label>
        <textarea
          id="guest-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={started ? "Message Ugnay…" : "Ask Ugnay anything…"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            if (e.shiftKey || e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            submit();
          }}
          className="field-seamless max-h-[200px] w-full resize-none bg-transparent px-2.5 pb-1 pt-2 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-0 sm:text-[15px]"
        />

        <div className="flex items-center justify-end pt-1">
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-neutral-500"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-2.5 text-center text-[11px] leading-relaxed text-neutral-600">
        <p>
          By messaging Ugnay, you agree to our <LegalTerm>Terms</LegalTerm> and{" "}
          <LegalTerm>Privacy Policy</LegalTerm>.
        </p>
        <p className="mt-0.5">
          <LegalTerm>Your privacy choices</LegalTerm>
        </p>
      </div>
    </form>
  );

  const dockedComposer = (
    <div className="w-full shrink-0 px-4 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-5">
      {composer}
    </div>
  );

  const heading = (
    <div className="text-center">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-neutral-100 sm:text-3xl">
        Ask Ugnay anything
      </h1>
      <p className="mt-2 text-sm text-neutral-500">Talk to several AI models in one place.</p>
    </div>
  );

  return (
    <main className="flex min-h-[100dvh] flex-col overflow-hidden bg-ink-950">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-safe sm:px-6">
        <Link href="/" className="flex items-center gap-2 py-3.5">
          <Image
            src="/logo/logo-256.png"
            alt=""
            width={24}
            height={24}
            priority
            className="h-6 w-6 rounded-md"
          />
          <span className="font-display text-sm font-semibold tracking-tight text-neutral-100">
            Ugnay
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-full border border-ink-700 px-3.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-850 hover:text-neutral-100 sm:text-sm"
          >
            Log in
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-full bg-neutral-100 px-3.5 py-1.5 text-xs font-medium text-ink-950 transition hover:bg-white sm:text-sm"
          >
            Sign up
          </Link>
        </div>
      </header>

      {started ? (
        // Same shape as a real conversation: transcript above, composer docked.
        <>
          <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-6 sm:px-4 sm:py-7">
            <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-7 sm:gap-6">
              {sent.map((message, index) => (
                <div key={`${index}-${message}`} className="flex flex-col items-end">
                  <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ink-800 px-3.5 py-2.5 text-[15px] leading-7 text-neutral-100 [overflow-wrap:anywhere] sm:max-w-[75%] sm:px-4">
                    {message}
                  </div>
                </div>
              ))}

              {/* Where the reply would be. */}
              <SignupPromptCard next="/" />

              <div ref={bottomRef} className="h-px" />
            </div>
          </div>

          {dockedComposer}
        </>
      ) : compact ? (
        // PWA / phone: the heading sits alone in the middle and the composer
        // stays docked at the bottom, exactly as the signed-in chat does.
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center px-4">{heading}</div>
          {dockedComposer}
        </>
      ) : (
        // Desktop: heading and composer centred together as one block.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <div className="w-full max-w-3xl">
            <div className="mb-6">{heading}</div>
            {composer}
          </div>
        </div>
      )}
    </main>
  );
}
