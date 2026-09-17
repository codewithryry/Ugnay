"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Loader2,
  PanelLeft,
  Play,
  Plus,
  Square,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { describeDbError, isMissingDbObject } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import type { Workflow, WorkflowStep } from "@/types/db";
import { apiFetch } from "@/lib/api";

/** Shown when the table this feature needs is not in the database yet. */
const MIGRATION_HINT =
  "Workflows need the latest database migration. Re-run supabase/schema.sql in the Supabase SQL editor.";

/** Matches MAX_STEPS in app/api/workflows/run/route.ts. */
const MAX_STEPS = 8;

const inputClass =
  "w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm";

function emptyStep(index: number): WorkflowStep {
  return { title: `Step ${index + 1}`, prompt: "" };
}

/**
 * Workflows: a saved chain of prompts, run over some input.
 *
 * A main-area surface rather than its own page, like /release-notes: the sidebar
 * stays where it is and this fills the space beside it. The list and the editor
 * write straight to Supabase under RLS, the way the prompt library does; only
 * running a workflow goes through the server, because that needs a provider key.
 */
export default function WorkflowsView() {
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The workflow open in the editor, or null for the list. */
  const [editing, setEditing] = useState<Workflow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await createClient()
      .from("workflows")
      .select("*")
      .order("updated_at", { ascending: false });

    if (loadError) {
      console.error("[ugnay] Could not load workflows:", describeDbError(loadError));
      setError(isMissingDbObject(loadError) ? MIGRATION_HINT : "Could not load your workflows.");
    } else {
      setWorkflows((data ?? []) as Workflow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const userId = useChatStore.getState().userId;
    if (!userId) return;
    const { data, error: createError } = await createClient()
      .from("workflows")
      .insert({
        user_id: userId,
        name: "New workflow",
        description: "",
        steps: [emptyStep(0)],
      })
      .select("*")
      .single();

    if (createError || !data) {
      console.error("[ugnay] Could not create a workflow:", describeDbError(createError));
      setError(isMissingDbObject(createError) ? MIGRATION_HINT : "Could not create a workflow.");
      return;
    }
    const workflow = data as Workflow;
    setWorkflows((all) => [workflow, ...all]);
    setEditing(workflow);
  }

  async function remove(id: string) {
    const previous = workflows;
    setWorkflows((all) => all.filter((w) => w.id !== id));
    if (editing?.id === id) setEditing(null);

    const { error: deleteError } = await createClient().from("workflows").delete().eq("id", id);
    if (deleteError) {
      console.error("[ugnay] Could not delete the workflow:", describeDbError(deleteError));
      setWorkflows(previous);
      setError("Could not delete this workflow.");
    }
  }

  function onSaved(saved: Workflow) {
    setWorkflows((all) => all.map((w) => (w.id === saved.id ? saved : w)));
    setEditing(saved);
  }

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
          {editing ? (
            <WorkflowEditor
              workflow={editing}
              onClose={() => setEditing(null)}
              onSaved={onSaved}
              onDelete={() => void remove(editing.id)}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-100 sm:text-4xl">
                    Workflows
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
                    A saved chain of prompts. Each step works from the previous step&rsquo;s
                    output — summarise, then analyse, then write the report.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void create()}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  New workflow
                </button>
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-6 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs leading-relaxed text-danger"
                >
                  {error}
                </p>
              )}

              {loading ? (
                <div className="mt-10 space-y-2.5" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-ink-900" />
                  ))}
                </div>
              ) : workflows.length === 0 ? (
                <div className="mt-10 rounded-2xl border border-ink-800 bg-ink-900 px-5 py-10 text-center">
                  <WorkflowIcon className="mx-auto h-5 w-5 text-neutral-600" aria-hidden />
                  <p className="mt-3 text-sm text-neutral-400">No workflows yet.</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-neutral-600">
                    Create one to turn a routine you repeat — a summary, then an analysis, then a
                    write-up — into a single run.
                  </p>
                </div>
              ) : (
                <ul className="mt-10 space-y-2.5">
                  {workflows.map((workflow) => (
                    <li key={workflow.id}>
                      <div className="group flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 px-4 py-3.5 transition hover:border-ink-700">
                        <button
                          type="button"
                          onClick={() => setEditing(workflow)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-sm font-medium text-neutral-100">
                            {workflow.name}
                          </span>
                          <span className="mt-1 block truncate text-xs text-neutral-500">
                            {workflow.description ||
                              `${workflow.steps?.length ?? 0} step${
                                (workflow.steps?.length ?? 0) === 1 ? "" : "s"
                              }`}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(workflow)}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100"
                        >
                          Open
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(workflow.id)}
                          aria-label={`Delete ${workflow.name}`}
                          className="shrink-0 rounded-md p-1.5 text-neutral-500 transition hover:bg-ink-800 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** Editor plus runner for one workflow. */
function WorkflowEditor({
  workflow,
  onClose,
  onSaved,
  onDelete,
}: {
  workflow: Workflow;
  onClose: () => void;
  onSaved: (saved: Workflow) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? "");
  const [steps, setSteps] = useState<WorkflowStep[]>(
    workflow.steps?.length ? workflow.steps : [emptyStep(0)],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  /** Output per step index, filled as the run streams. */
  const [outputs, setOutputs] = useState<Record<number, string>>({});
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setName(workflow.name);
    setDescription(workflow.description ?? "");
    setSteps(workflow.steps?.length ? workflow.steps : [emptyStep(0)]);
  }, [workflow.id, workflow.name, workflow.description, workflow.steps]);

  const dirty =
    name !== workflow.name ||
    description !== (workflow.description ?? "") ||
    JSON.stringify(steps) !== JSON.stringify(workflow.steps ?? []);

  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    const cleaned = steps
      .map((step, index) => ({
        title: step.title.trim() || `Step ${index + 1}`,
        prompt: step.prompt.trim(),
      }))
      .filter((step) => step.prompt);

    const { data, error: saveError } = await createClient()
      .from("workflows")
      .update({ name: name.trim(), description: description.trim(), steps: cleaned })
      .eq("id", workflow.id)
      .select("*")
      .single();

    if (saveError || !data) {
      console.error("[ugnay] Could not save the workflow:", describeDbError(saveError));
      setError("Could not save this workflow.");
    } else {
      onSaved(data as Workflow);
    }
    setSaving(false);
  }

  async function run() {
    const usable = steps.filter((s) => s.prompt.trim());
    if (running || usable.length === 0) return;

    // A run reads the saved steps, so unsaved edits are persisted first.
    if (dirty) await save();

    setRunning(true);
    setError(null);
    setOutputs({});
    setActiveStep(null);
    abortRef.current = new AbortController();

    try {
      const res = await apiFetch("/api/workflows/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: workflow.id, input }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let event: {
            type?: string;
            index?: number;
            text?: string;
            error?: string;
          };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "step" && typeof event.index === "number") {
            setActiveStep(event.index);
          } else if (event.type === "delta" && typeof event.index === "number") {
            const at = event.index;
            const text = event.text ?? "";
            setOutputs((all) => ({ ...all, [at]: (all[at] ?? "") + text }));
          } else if (event.type === "error") {
            setError(event.error ?? "This run failed.");
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      abortRef.current = null;
      setRunning(false);
      setActiveStep(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
        >
          ← All workflows
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="rounded-xl border border-danger/30 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/10"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim() || !dirty}
            className="rounded-xl bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs leading-relaxed text-danger"
        >
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        <div>
          <label htmlFor="workflow-name" className="mb-1.5 block text-xs font-medium text-neutral-400">
            Name
          </label>
          <input
            id="workflow-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="workflow-description"
            className="mb-1.5 block text-xs font-medium text-neutral-400"
          >
            Description
          </label>
          <input
            id="workflow-description"
            value={description}
            maxLength={500}
            placeholder="What this workflow is for"
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-100">Steps</h2>
          <button
            type="button"
            onClick={() => setSteps((all) => [...all, emptyStep(all.length)])}
            disabled={steps.length >= MAX_STEPS}
            className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add step
          </button>
        </div>
        <p className="mt-1.5 text-xs text-neutral-600">
          Up to {MAX_STEPS}. Every step after the first is given the previous one&rsquo;s output.
        </p>

        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li
              key={index}
              className={cn(
                "rounded-xl border bg-ink-900 p-3.5 transition",
                activeStep === index ? "border-accent/60" : "border-ink-800",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-medium text-neutral-300">
                  {index + 1}
                </span>
                <input
                  value={step.title}
                  maxLength={80}
                  aria-label={`Step ${index + 1} title`}
                  onChange={(e) =>
                    setSteps((all) =>
                      all.map((s, i) => (i === index ? { ...s, title: e.target.value } : s)),
                    )
                  }
                  className="field-seamless min-w-0 flex-1 text-sm font-medium text-neutral-100"
                />
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSteps((all) => all.filter((_, i) => i !== index))}
                    aria-label={`Remove step ${index + 1}`}
                    className="shrink-0 rounded-md p-1.5 text-neutral-500 transition hover:bg-ink-800 hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>

              <textarea
                rows={3}
                value={step.prompt}
                aria-label={`Step ${index + 1} prompt`}
                placeholder={
                  index === 0
                    ? "Summarise the material below, keeping every figure."
                    : "Analyse the summary above and list the three biggest risks."
                }
                onChange={(e) =>
                  setSteps((all) =>
                    all.map((s, i) => (i === index ? { ...s, prompt: e.target.value } : s)),
                  )
                }
                className={cn(inputClass, "mt-2.5 resize-y")}
              />

              {outputs[index] && (
                <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950 p-3">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
                    Output
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">
                    {outputs[index]}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8 border-t border-ink-800 pt-6">
        <h2 className="text-sm font-semibold text-neutral-100">Run</h2>
        <label htmlFor="workflow-input" className="mb-1.5 mt-3 block text-xs font-medium text-neutral-400">
          Material for the first step
        </label>
        <textarea
          id="workflow-input"
          rows={5}
          value={input}
          placeholder="Paste the text this workflow should work from…"
          onChange={(e) => setInput(e.target.value)}
          className={cn(inputClass, "resize-y")}
        />

        <div className="mt-3 flex items-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex items-center gap-2 rounded-xl border border-ink-700 px-3.5 py-2 text-sm text-neutral-200 transition hover:bg-ink-850"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void run()}
              disabled={steps.every((s) => !s.prompt.trim())}
              className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
              Run workflow
            </button>
          )}
          {running && (
            <span className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {activeStep !== null
                ? `Running step ${activeStep + 1} of ${steps.length}…`
                : "Starting…"}
            </span>
          )}
        </div>
      </section>
    </>
  );
}
