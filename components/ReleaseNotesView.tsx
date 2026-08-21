"use client";

import { PanelLeft } from "lucide-react";
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
 */
export default function ReleaseNotesView() {
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ink-950">
      {/* Matches the chat header, so the mobile sidebar toggle stays put. */}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
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
