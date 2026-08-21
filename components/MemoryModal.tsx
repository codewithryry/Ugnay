"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import Modal from "./Modal";
import { createClient } from "@/lib/supabase/client";
import { describeDbError } from "@/lib/supabase/errors";
import { useChatStore } from "@/store/chatStore";
import { cn } from "@/lib/utils";
import type { MemoryEntry } from "@/types/db";

/** Newest first; enough to review without loading an unbounded history. */
const PAGE_SIZE = 200;

/** Shape PostgREST returns for the embedded chat title. */
interface MemoryRow {
  message_id: string;
  chat_id: string;
  content: string;
  created_at: string;
  chats: { title: string } | { title: string }[] | null;
}

function chatTitleOf(row: MemoryRow) {
  const chat = Array.isArray(row.chats) ? row.chats[0] : row.chats;
  return chat?.title ?? "Untitled conversation";
}

/**
 * What Ugnay remembers from earlier conversations, and the switches that
 * govern it.
 *
 * Memories are the rows in `message_embeddings` that back Settings → Data
 * Controls → "Personalize AI with your conversation history". The global switch
 * here is that same setting, so the two never disagree; workspaces add their own
 * switch on top of it.
 */
export default function MemoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const projects = useChatStore((s) => s.projects);
  const saveProject = useChatStore((s) => s.saveProject);
  const userId = useChatStore((s) => s.userId);

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const memoryOn = settings?.personalize_with_history ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // RLS scopes this to the caller's own rows.
    const { data, error: loadError } = await createClient()
      .from("message_embeddings")
      .select("message_id, chat_id, content, created_at, chats(title)")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (loadError) {
      console.error("[ugnay] Could not load memories:", describeDbError(loadError));
      setError("Could not load what Ugnay remembers. Please try again.");
    } else {
      setEntries(
        ((data ?? []) as MemoryRow[]).map((row) => ({
          message_id: row.message_id,
          chat_id: row.chat_id,
          chat_title: chatTitleOf(row),
          content: row.content,
          created_at: row.created_at,
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setConfirmClear(false);
      setError(null);
      return;
    }
    void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.content.toLowerCase().includes(q) || e.chat_title.toLowerCase().includes(q),
    );
  }, [entries, query]);

  async function forget(messageId: string) {
    setError(null);
    const { error: deleteError } = await createClient()
      .from("message_embeddings")
      .delete()
      .eq("message_id", messageId);
    if (deleteError) {
      console.error("[ugnay] Could not delete a memory:", describeDbError(deleteError));
      setError("Could not delete that memory. Please try again.");
      return;
    }
    setEntries((all) => all.filter((e) => e.message_id !== messageId));
  }

  async function clearAll() {
    if (!userId) return;
    setClearing(true);
    setError(null);
    // Scoped explicitly as well as by RLS; PostgREST requires a filter here.
    const { error: deleteError } = await createClient()
      .from("message_embeddings")
      .delete()
      .eq("user_id", userId);
    if (deleteError) {
      console.error("[ugnay] Could not clear memories:", describeDbError(deleteError));
      setError("Could not clear your memories. Please try again.");
    } else {
      setEntries([]);
    }
    setClearing(false);
    setConfirmClear(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Memory"
      description="What Ugnay may draw on from your earlier conversations."
      panelClassName="max-w-2xl"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-white"
        >
          Done
        </button>
      }
    >
      {/* ------------------------------------------------------- switches */}
      <div className="rounded-xl border border-ink-800 bg-ink-950 p-3.5">
        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm text-neutral-100">Use conversation history</span>
            <span className="mt-1 block text-xs leading-relaxed text-neutral-500">
              The same switch as Settings → Data Controls. While it is off, nothing below is
              consulted and no new memories are written.
            </span>
          </span>
          <input
            type="checkbox"
            checked={memoryOn}
            onChange={(e) => void saveSettings({ personalize_with_history: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-200"
          />
        </label>

        {projects.length > 0 && (
          <div className="mt-4 border-t border-ink-800 pt-3.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Per workspace
            </p>
            <ul className="space-y-1.5">
              {projects.map((project) => (
                <li key={project.id}>
                  <label
                    className={cn(
                      "flex items-center justify-between gap-4",
                      !memoryOn && "opacity-50",
                    )}
                  >
                    <span className="min-w-0 truncate text-sm text-neutral-300">
                      {project.name}
                    </span>
                    <input
                      type="checkbox"
                      disabled={!memoryOn}
                      checked={project.memory_enabled ?? true}
                      onChange={(e) =>
                        void saveProject(project.id, { memory_enabled: e.target.checked })
                      }
                      className="h-4 w-4 shrink-0 accent-neutral-200"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- memories */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-neutral-100">
            Remembered excerpts{entries.length > 0 && ` (${entries.length})`}
          </p>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => (confirmClear ? void clearAll() : setConfirmClear(true))}
              onBlur={() => setConfirmClear(false)}
              disabled={clearing}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-50",
                confirmClear
                  ? "border-rose-900/70 bg-rose-950/40 text-rose-300"
                  : "border-ink-700 text-neutral-300 hover:bg-ink-800",
              )}
            >
              {clearing ? "Clearing…" : confirmClear ? "Click again to clear all" : "Clear all"}
            </button>
          )}
        </div>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories"
            aria-label="Search memories"
            className="w-full rounded-xl border border-ink-700 bg-ink-950 py-2.5 pl-9 pr-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-rose-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm leading-relaxed text-neutral-500">
            {entries.length === 0
              ? "Nothing is remembered yet. Memories are written as you chat, while the switch above is on."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {filtered.map((entry) => (
              <li
                key={entry.message_id}
                className="flex items-start gap-2 rounded-xl border border-ink-800 bg-ink-950 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-neutral-300">
                    {entry.content.replace(/\s+/g, " ").slice(0, 300)}
                    {entry.content.length > 300 && "…"}
                  </p>
                  <p className="mt-1.5 truncate text-[11px] text-neutral-600">
                    {entry.chat_title} ·{" "}
                    <time dateTime={entry.created_at}>
                      {new Date(entry.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void forget(entry.message_id)}
                  aria-label="Forget this memory"
                  title="Forget this memory"
                  className="shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-ink-800 hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
