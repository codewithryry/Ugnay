import { RELEASE_NOTES } from "@/lib/help";

/** Renders the ISO dates in the release list as e.g. "20 August 2026". */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ReleaseNotesList() {
  return (
    <ol className="space-y-3">
      {RELEASE_NOTES.map((note) => (
        <li
          key={note.version}
          className="rounded-2xl border border-ink-800 bg-ink-900 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-neutral-300">
              v{note.version}
            </span>
            <time dateTime={note.date} className="text-[11px] text-neutral-600">
              {formatDate(note.date)}
            </time>
          </div>

          <h2 className="mt-2.5 text-sm font-semibold text-neutral-100">{note.title}</h2>

          <ul className="mt-3 space-y-2 border-t border-ink-800 pt-3.5">
            {note.changes.map((change) => (
              <li key={change} className="flex gap-2 text-xs leading-relaxed text-neutral-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-600" aria-hidden />
                {change}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
