import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Frame shared by the Help pages (Feedback, FAQ, Release Notes): the back link
 * to the app, the heading block and a readable column. Mirrors the pricing
 * page so every full-page surface reads the same.
 */
export default function HelpPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-[100dvh] bg-ink-950">
      <div className="mx-auto w-full max-w-3xl px-4 pb-safe pt-safe sm:px-6">
        <div className="flex items-center justify-between gap-4 pt-8 sm:pt-10">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {/* The wordmark keeps the display face it has in the sidebar. */}
            Back to <span className="font-display font-semibold tracking-tight">Ugnay</span>
          </Link>
        </div>

        <div className="mt-8">
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-neutral-100 xs:text-3xl sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-500">{description}</p>
        </div>

        <div className="mt-8 pb-16">{children}</div>
      </div>
    </main>
  );
}
