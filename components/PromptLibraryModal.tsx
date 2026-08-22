"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Modal from "./Modal";
import { createClient } from "@/lib/supabase/client";
import { describeDbError, isMissingDbObject } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";
import type { Prompt } from "@/types/db";

/** Shown when a table this feature needs is not in the database yet. */
const MIGRATION_HINT =
  "The prompt library needs the latest database migration. Re-run supabase/schema.sql in the Supabase SQL editor.";

/** Mirrors the check constraints on public.prompts. */
const TITLE_LIMIT = 120;
const BODY_LIMIT = 8000;
const FOLDER_LIMIT = 60;

/** Rows in the library, grouped by folder. Ungrouped prompts come last. */
function groupByFolder(prompts: Prompt[]) {
  const groups = new Map<string, Prompt[]>();
  for (const prompt of prompts) {
    const key = prompt.folder.trim();
    const bucket = groups.get(key);
    if (bucket) bucket.push(prompt);
    else groups.set(key, [prompt]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });
}

type Draft = { id: string | null; title: string; folder: string; body: string };
const EMPTY_DRAFT: Draft = { id: null, title: "", folder: "", body: "" };

/**
 * Reusable prompts, inserted into the composer. Distinct from Settings →
 * Presets, which set the system prompt: these are message text.
 *
 * Reads and writes `public.prompts` through the browser client, so RLS is what
 * scopes every row to the signed-in account.
 */
export default function PromptLibraryModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the prompt body; the composer decides where it lands. */
  onInsert: (body: string) => void;
}) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await createClient()
      .from("prompts")
      .select("*")
      .order("updated_at", { ascending: false });

    if (loadError) {
      console.error("[ugnay] Could not load the prompt library:", describeDbError(loadError));
      setError(
        isMissingDbObject(loadError)
          ? MIGRATION_HINT
          : "Could not load your prompts. Please try again.",
      );
    } else {
      setPrompts((data ?? []) as Prompt[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setQuery("");
      setConfirmDelete(null);
      setError(null);
      return;
    }
    void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        p.folder.toLowerCase().includes(q),
    );
  }, [prompts, query]);

  async function save() {
    if (!draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body || saving) return;

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const folder = draft.folder.trim();

    // The insert needs user_id for the RLS check; the update is already scoped
    // to the caller's rows by the same policy.
    if (draft.id) {
      const { data, error: saveError } = await supabase
        .from("prompts")
        .update({ title, body, folder })
        .eq("id", draft.id)
        .select("*")
        .single();
      if (saveError || !data) {
        console.error("[ugnay] Could not update the prompt:", describeDbError(saveError));
        setError("Could not save this prompt. Please try again.");
        setSaving(false);
        return;
      }
      const saved = data as Prompt;
      setPrompts((all) => all.map((p) => (p.id === saved.id ? saved : p)));
    } else {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setError("Your session has expired. Please sign in again.");
        setSaving(false);
        return;
      }
      const { data, error: saveError } = await supabase
        .from("prompts")
        .insert({ user_id: auth.user.id, title, body, folder })
        .select("*")
        .single();
      if (saveError || !data) {
        console.error("[ugnay] Could not create the prompt:", describeDbError(saveError));
        setError("Could not save this prompt. Please try again.");
        setSaving(false);
        return;
      }
      setPrompts((all) => [data as Prompt, ...all]);
    }

    setSaving(false);
    setDraft(null);
  }

  async function remove(id: string) {
    setError(null);
    const { error: deleteError } = await createClient().from("prompts").delete().eq("id", id);
    if (deleteError) {
      console.error("[ugnay] Could not delete the prompt:", describeDbError(deleteError));
      setError("Could not delete this prompt. Please try again.");
      return;
    }
    setPrompts((all) => all.filter((p) => p.id !== id));
    setConfirmDelete(null);
  }

  const editing = draft !== null;
  const footer = editing ? (
    <>
      <button
        type="button"
        onClick={() => setDraft(null)}
        className="rounded-xl border border-ink-700 px-3.5 py-2 text-sm text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving || !draft?.title.trim() || !draft?.body.trim()}
        className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : draft?.id ? "Save changes" : "Add prompt"}
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => setDraft({ ...EMPTY_DRAFT })}
      className="flex items-center gap-1.5 rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      New prompt
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Prompt library"
      description={editing ? undefined : "Saved prompts you can drop into the composer."}
      panelClassName="max-w-2xl"
      footer={footer}
    >
      {editing ? (
        <div>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="mb-4 flex items-center gap-1.5 text-xs text-neutral-400 transition hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to the library
          </button>

          <label htmlFor="prompt-title" className="mb-1.5 block text-xs font-medium text-neutral-400">
            Title
          </label>
          <input
            id="prompt-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value.slice(0, TITLE_LIMIT) })}
            placeholder="Summarise a document"
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
          />

          <label
            htmlFor="prompt-folder"
            className="mb-1.5 mt-4 block text-xs font-medium text-neutral-400"
          >
            Folder <span className="text-neutral-600">(optional)</span>
          </label>
          <input
            id="prompt-folder"
            value={draft.folder}
            onChange={(e) => setDraft({ ...draft, folder: e.target.value.slice(0, FOLDER_LIMIT) })}
            placeholder="Writing"
            list="prompt-folders"
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
          />
          <datalist id="prompt-folders">
            {[...new Set(prompts.map((p) => p.folder).filter(Boolean))].map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>

          <label htmlFor="prompt-body" className="mb-1.5 mt-4 block text-xs font-medium text-neutral-400">
            Prompt
          </label>
          <textarea
            id="prompt-body"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value.slice(0, BODY_LIMIT) })}
            rows={8}
            placeholder="The text inserted into the composer."
            className="w-full resize-y rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
          />
          <p className="mt-1.5 text-right text-[11px] text-neutral-600">
            {draft.body.length} / {BODY_LIMIT}
          </p>

          {error && (
            <p role="alert" className="mt-3 text-xs text-rose-400">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts"
              aria-label="Search prompts"
              className="w-full rounded-xl border border-ink-700 bg-ink-950 py-2.5 pl-9 pr-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
            />
          </div>

          {error && (
            <p role="alert" className="mt-3 text-xs text-rose-400">
              {error}
            </p>
          )}

          {loading ? (
            <p className="py-10 text-center text-sm text-neutral-500">Loading your prompts…</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              {prompts.length === 0
                ? "No saved prompts yet. Add one to reuse it in any conversation."
                : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {groupByFolder(filtered).map(([folder, items]) => (
                <div key={folder || "__ungrouped"}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    {folder || "Ungrouped"}
                  </p>
                  <ul className="space-y-1.5">
                    {items.map((prompt) => (
                      <li
                        key={prompt.id}
                        className="rounded-xl border border-ink-800 bg-ink-950 p-3 transition hover:border-ink-700"
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onInsert(prompt.body);
                              onClose();
                            }}
                            className="min-w-0 flex-1 text-left"
                            title="Insert into the composer"
                          >
                            <span className="block truncate text-sm text-neutral-100">
                              {prompt.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-neutral-500">
                              {prompt.body.replace(/\s+/g, " ")}
                            </span>
                          </button>

                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setDraft({
                                  id: prompt.id,
                                  title: prompt.title,
                                  folder: prompt.folder,
                                  body: prompt.body,
                                })
                              }
                              aria-label={`Edit ${prompt.title}`}
                              className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-ink-800 hover:text-neutral-200"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                confirmDelete === prompt.id
                                  ? void remove(prompt.id)
                                  : setConfirmDelete(prompt.id)
                              }
                              onBlur={() =>
                                setConfirmDelete((id) => (id === prompt.id ? null : id))
                              }
                              aria-label={
                                confirmDelete === prompt.id
                                  ? `Confirm deleting ${prompt.title}`
                                  : `Delete ${prompt.title}`
                              }
                              className={cn(
                                "rounded-lg p-1.5 transition",
                                confirmDelete === prompt.id
                                  ? "bg-rose-950/50 text-rose-300"
                                  : "text-neutral-500 hover:bg-ink-800 hover:text-rose-300",
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </div>
                        </div>
                        {confirmDelete === prompt.id && (
                          <p className="mt-2 text-[11px] text-rose-300">
                            Press delete again to remove this prompt.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
