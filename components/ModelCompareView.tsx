"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Columns3, Loader2, PanelLeft, Square, X } from "lucide-react";
import { useChatStore } from "@/store/chatStore";
import { cn } from "@/lib/utils";

const MIN_MODELS = 2;
const MAX_MODELS = 4;

type Status = "idle" | "streaming" | "done" | "error";

interface Column {
  key: string;
  provider: string;
  model: string;
  label: string;
  text: string;
  status: Status;
  error: string | null;
}

/**
 * Sends one prompt to several models at once and streams each reply beside the
 * others.
 *
 * Every column is an ordinary `/api/chat` request with `temporary: true`, so
 * this reuses the existing provider registry, streaming protocol, auth, rate
 * limits and error sanitising, and writes nothing to a database. The normal
 * single-model path is untouched.
 *
 * A main-area surface rather than a modal: the sidebar stays where it is and
 * this fills the space beside it, the way /search and the release notes do.
 */
export default function ModelCompareView({ onClose }: { onClose: () => void }) {
  const catalog = useChatStore((s) => s.catalog);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const activeProvider = useChatStore((s) => s.provider);
  const activeModel = useChatStore((s) => s.model);

  /** Every model behind a configured provider, flattened for the picker. */
  const options = useMemo(
    () =>
      catalog
        .filter((entry) => entry.configured)
        .flatMap((entry) =>
          entry.models.map((model) => ({
            key: `${entry.id}:${model.id}`,
            provider: entry.id,
            model: model.id,
            label: `${model.label} · ${entry.label}`,
            /** The model on its own; the provider is the group heading. */
            shortLabel: model.label,
            providerLabel: entry.label,
          })),
        ),
    [catalog],
  );

  /**
   * The same options grouped by provider, so the chips read like the model
   * picker does — a provider heading with its models under it — instead of one
   * long row that repeats the provider name on every chip.
   */
  const grouped = useMemo(
    () =>
      catalog
        .filter((entry) => entry.configured)
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
          models: options.filter((option) => option.provider === entry.id),
        }))
        .filter((group) => group.models.length > 0),
    [catalog, options],
  );

  const [selected, setSelected] = useState<string[]>(() => {
    const current = `${activeProvider}:${activeModel}`;
    return [current];
  });
  const [prompt, setPrompt] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : current.length >= MAX_MODELS
          ? current
          : [...current, key],
    );
  }

  /** Streams one model's reply into its own column. */
  async function runOne(column: Column, text: string, signal: AbortSignal) {
    const patch = (update: Partial<Column>) =>
      setColumns((all) => all.map((c) => (c.key === column.key ? { ...c, ...update } : c)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Temporary: nothing is persisted and no chat row is touched.
        body: JSON.stringify({
          temporary: true,
          content: text,
          provider: column.provider,
          model: column.model,
          messages: [],
        }),
        signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        patch({ status: "error", error: detail?.error ?? `Request failed (${res.status}).` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let event: { type?: string; text?: string; error?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          // Reasoning traces are skipped here: the columns compare answers.
          if (event.type === "delta" && event.text) {
            const delta = event.text;
            setColumns((all) =>
              all.map((c) => (c.key === column.key ? { ...c, text: c.text + delta } : c)),
            );
          } else if (event.type === "error") {
            streamError = event.error ?? "This model could not answer.";
          }
        }
      }

      patch(
        streamError
          ? { status: "error", error: streamError }
          : { status: "done", error: null },
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        patch({ status: "done" });
        return;
      }
      patch({ status: "error", error: "Could not reach the server." });
    }
  }

  async function run() {
    const text = prompt.trim();
    if (!text || selected.length < MIN_MODELS || running) return;

    const next: Column[] = selected.map((key) => {
      const option = options.find((o) => o.key === key);
      return {
        key,
        provider: option?.provider ?? key.split(":")[0],
        model: option?.model ?? key.split(":").slice(1).join(":"),
        label: option?.label ?? key,
        text: "",
        status: "streaming" as Status,
        error: null,
      };
    });

    setColumns(next);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Independent streams: one slow or failing model never blocks the others.
    await Promise.all(next.map((column) => runOne(column, text, controller.signal)));

    setRunning(false);
    abortRef.current = null;
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }

  function handleClose() {
    stop();
    onClose();
  }

  const canRun = prompt.trim().length > 0 && selected.length >= MIN_MODELS && !running;

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

        {/* The page names itself in the body, like every other surface, so the
          * bar carries only the controls. */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close compare models"
          className="ml-auto shrink-0 rounded-lg p-2.5 text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-6 sm:px-8 md:pt-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-100 sm:text-4xl">
            Compare models
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Send one prompt to {MIN_MODELS}&ndash;{MAX_MODELS} models at once and read the replies
            side by side. Nothing here is saved to your history.
          </p>

          {options.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-ink-800 bg-ink-900 px-5 py-10 text-center">
              <Columns3 className="mx-auto h-5 w-5 text-neutral-600" aria-hidden />
              <p className="mt-3 text-sm text-neutral-400">No models are available right now.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-neutral-600">
                A provider needs its API key set on the server before it can appear here.
              </p>
            </div>
          ) : (
            <>
              {/* ------------------------------------------------- model chips */}
              <section className="mt-10">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Models
                  </h2>
                  <span className="shrink-0 text-[11px] tabular-nums text-neutral-600">
                    {selected.length} of {MAX_MODELS} selected
                  </span>
                </div>

                <div className="mt-3 space-y-4">
                  {grouped.map((group) => (
                    <div key={group.id}>
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-neutral-600">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.models.map((option) => {
                          const on = selected.includes(option.key);
                          return (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => toggle(option.key)}
                              disabled={running || (!on && selected.length >= MAX_MODELS)}
                              aria-pressed={on}
                              title={option.label}
                              className={cn(
                                // The composer's Thinking / Web search chip, so
                                // a toggle looks like a toggle everywhere.
                                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40",
                                on
                                  ? "border-neutral-400 bg-ink-800 text-neutral-100"
                                  : "border-ink-700 text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
                              )}
                            >
                              {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                              {option.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ------------------------------------------------ prompt shell */}
              <section className="mt-8">
                <label
                  htmlFor="compare-prompt"
                  className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  Prompt
                </label>

                {/* The composer's own shell, so the input this page is built
                  * around is the same object it is in the chat. */}
                <div className="rounded-3xl border border-ink-700 bg-ink-900 p-2 shadow-lg transition focus-within:border-ink-600">
                  <textarea
                    id="compare-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={running}
                    rows={3}
                    placeholder="Ask the same thing of every selected model…"
                    className="field-seamless max-h-[200px] w-full resize-none px-2.5 pb-1 pt-2 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 disabled:opacity-60 sm:text-[15px]"
                  />

                  <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
                    <span className="min-w-0 flex-1 truncate pl-1 text-[11px] text-neutral-600">
                      {selected.length < MIN_MODELS
                        ? `Pick at least ${MIN_MODELS} models to compare.`
                        : `${selected.length} models will answer this.`}
                    </span>

                    {running ? (
                      <button
                        type="button"
                        onClick={stop}
                        className="flex shrink-0 items-center gap-2 rounded-full border border-ink-700 px-3.5 py-2 text-sm text-neutral-200 transition hover:bg-ink-850"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void run()}
                        disabled={!canRun}
                        className="shrink-0 rounded-full bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-neutral-500"
                      >
                        Run comparison
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* ----------------------------------------------------- results */}
              {columns.length > 0 && (
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {columns.map((column) => (
                    <section
                      key={column.key}
                      className="flex min-w-0 flex-col rounded-xl border border-ink-800 bg-ink-900"
                    >
                      <header className="flex items-center gap-2 border-b border-ink-800 px-3.5 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">
                          {column.label}
                        </span>
                        {column.status === "streaming" && (
                          <Loader2
                            className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-500"
                            aria-hidden
                          />
                        )}
                        {column.status === "error" && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-danger">
                            Failed
                          </span>
                        )}
                      </header>

                      <div className="max-h-[60dvh] min-w-0 overflow-y-auto px-3.5 py-3">
                        {column.status === "error" ? (
                          <p role="alert" className="text-xs leading-relaxed text-danger">
                            {column.error}
                          </p>
                        ) : column.text ? (
                          <div className="prose-ugnay w-full min-w-0 max-w-none text-sm">
                            {/* No rehype-raw, so model output cannot inject HTML. */}
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{column.text}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-600">Waiting for the first tokens…</p>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
