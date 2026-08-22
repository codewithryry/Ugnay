"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  // ?mode=signup deep-links here from the signed-out landing prompt.
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "That sign-in link is invalid or has expired." : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  // Google returns to the same callback route the email links already use;
  // it exchanges the code for a session and forwards to `next`.
  async function signInWithGoogle() {
    setGooglePending(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (oauthError) {
      console.error("[ugnay] Google sign-in failed:", oauthError);
      setError(oauthError.message || "Could not start Google sign-in. Please try again.");
      setGooglePending(false);
    }
    // On success the browser leaves for Google, so `pending` stays set.
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setNotice("Check your inbox to confirm your email address, then sign in.");
        }
      }
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center sm:mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-100 sm:text-4xl">
          {mode === "signup" ? "Create your account" : "Log into your account"}
        </h1>
      </div>

      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        disabled={pending || googlePending}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-neutral-100 transition hover:bg-ink-800 disabled:opacity-60"
      >
        {googlePending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-ink-800" />
        <span className="text-[11px] uppercase tracking-wide text-neutral-600">or</span>
        <span className="h-px flex-1 bg-ink-800" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-neutral-400">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:py-2.5 sm:text-sm"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-neutral-400">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:py-2.5 sm:text-sm"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-xs text-success">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || googlePending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-neutral-500">
        {mode === "signin" ? "New to Ugnay?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="font-medium text-neutral-300 underline underline-offset-2 hover:text-neutral-100"
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-neutral-600">
        By continuing, you agree to Ugnay&rsquo;s{" "}
        <LegalLink href="/terms">Terms of Service</LegalLink> and{" "}
        <LegalLink href="/privacy">Privacy Policy</LegalLink>.
      </p>
    </div>
  );
}

/** The two legal pages, styled to read as part of the sentence. */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-neutral-500 underline underline-offset-2 transition hover:text-neutral-300"
    >
      {children}
    </Link>
  );
}
