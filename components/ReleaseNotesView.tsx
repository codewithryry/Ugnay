"use client";

import Link from "next/link";
import { ArrowLeft, PanelLeft } from "lucide-react";
import { RELEASE_NOTES } from "@/lib/help";
import { useChatStore } from "@/store/chatStore";

/** Renders the ISO dates in the release list as e.g. "20 Aug 2026". */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Release notes as a main-area surface rather than its own page: the sidebar
 * stays where it is and this fills the space beside it, the way /search does.
 * Each release puts its date in a column beside the changes.
 *
 * `standalone` is the signed-out rendering. The notes are static product copy,
 * so a visitor with no session can read them; there is no app shell around it
 * then, so the header becomes the "Back to Ugnay" one the docs pages use.
 */
export default function ReleaseNotesView({ standalone = false }: { standalone?: boolean }) {
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  return (
    <main
      className={
        standalone
          ? "flex min-h-[100dvh] w-full min-w-0 flex-col bg-ink-950"
          : "flex min-w-0 flex-1 flex-col overflow-hidden bg-ink-950"
      }
    >
      {standalone ? (
        <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85">
          {/* Same width and gutters as the notes below, so "Back to Ugnay"
           * lines up with the heading instead of floating out to the edge. */}
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-5 py-3 sm:px-8">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden xs:inline">Back to</span>
              <span className="font-display font-semibold tracking-tight">Ugnay</span>
            </Link>
            <span className="ml-auto truncate text-xs text-neutral-500">Release notes</span>
          </div>
        </header>
      ) : (
        /* Matches the chat header, so the mobile sidebar toggle stays put. */
        <header className="flex min-h-[3.5rem] shrink-0 items-center gap-1 px-2 pt-safe md:h-14 md:gap-2 md:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open the sidebar"
            className="shrink-0 rounded-lg p-2.5 text-neutral-400 hover:bg-ink-850 hover:text-neutral-100 md:hidden"
          >
            <PanelLeft className="h-4 w-4" aria-hidden />
          </button>
        </header>
      )}

      <div className={standalone ? "flex-1" : "min-h-0 flex-1 overflow-y-auto"}>
        <div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-6 sm:px-8 md:pt-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-100 sm:text-4xl">
            Ugnay Release Notes
          </h1>

          <ol className="mt-10 border-t border-ink-800">
            {RELEASE_NOTES.map((note) => (
              <li
                key={note.version}
                className="grid gap-x-10 gap-y-3 border-b border-ink-800 py-10 md:grid-cols-[8.5rem_1fr]"
              >
                <time
                  dateTime={note.date}
                  className="text-sm leading-6 text-neutral-500 md:pt-0.5"
                >
                  {formatDate(note.date)}
                </time>

                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight text-neutral-100">
                    {note.title}
                  </h2>
                  <p className="mt-1 text-xs text-neutral-600">Version {note.version}</p>

                  <ul className="mt-5 space-y-2.5">
                    {note.changes.map((change) => (
                      <li
                        key={change}
                        className="flex gap-3 text-sm leading-relaxed text-neutral-400"
                      >
                        <span
                          className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-neutral-600"
                          aria-hidden
                        />
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}
