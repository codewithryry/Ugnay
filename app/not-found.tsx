import Link from "next/link";

export const metadata = { title: "Not found" };

/**
 * The 404. Same shell as the maintenance screen: one ink card, the display
 * face for the heading, and a quiet link back to the app.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 px-6">
      <div className="w-full max-w-md rounded-2xl border border-ink-800 bg-ink-900 p-6 text-center">
        <p className="font-display text-3xl font-semibold tracking-tight text-neutral-100">404</p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          This page could not be found.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-xs text-neutral-500 transition hover:text-neutral-300"
        >
          Back to Ugnay
        </Link>
      </div>
    </main>
  );
}
