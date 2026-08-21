"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, X } from "lucide-react";
import CodeBlock from "./CodeBlock";
import {
  artifactExtension,
  artifactKind,
  artifactTitle,
  formatJson,
} from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

type Tab = "preview" | "edit";

/**
 * The canvas: an editable view of one generated block, beside the conversation.
 *
 * Editing is local to the panel — the conversation is a record of what was
 * said, so nothing here rewrites a stored message. Copy and Download take
 * whatever is currently in the editor.
 *
 * HTML previews render in an iframe with an empty `sandbox`, so the document
 * gets no scripts, no forms, no navigation and no same-origin access. Markdown
 * goes through react-markdown without rehype-raw, so embedded HTML stays
 * escaped. Neither path relaxes the app's content security policy.
 */
export default function ArtifactPanel() {
  const artifact = useChatStore((s) => s.artifact);
  const closeArtifact = useChatStore((s) => s.closeArtifact);

  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("preview");
  const [copied, setCopied] = useState(false);

  const kind = artifactKind(artifact?.language);

  // Opening a different block resets the editor and the tab.
  useEffect(() => {
    if (!artifact) return;
    setDraft(artifact.code);
    setTab(artifactKind(artifact.language) === "code" ? "edit" : "preview");
    setCopied(false);
  }, [artifact]);

  const json = useMemo(
    () => (kind === "json" ? formatJson(draft) : null),
    [kind, draft],
  );

  if (!artifact || !kind) return null;

  const title = artifactTitle(artifact.language, artifact.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked; the editor text is selectable instead.
    }
  }

  function download() {
    const blob = new Blob([draft], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "artifact"}.${artifactExtension(artifact!.language)}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside
      aria-label="Canvas"
      className="fixed inset-0 z-40 flex flex-col overflow-hidden border-ink-800 bg-ink-900 pb-safe pt-safe md:static md:z-auto md:w-[26rem] md:shrink-0 md:border-l md:p-0 lg:w-[32rem]"
    >
      <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-100">{title}</p>
          <p className="text-[11px] uppercase tracking-wide text-neutral-600">
            {artifact.language}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
          className="rounded-lg p-2 text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={download}
          aria-label="Download"
          title="Download"
          className="rounded-lg p-2 text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
        >
          <Download className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={closeArtifact}
          aria-label="Close the canvas"
          className="rounded-lg p-2 text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-3 py-2">
        {(["preview", "edit"] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs capitalize transition",
              tab === id
                ? "bg-ink-800 text-neutral-100"
                : "text-neutral-500 hover:bg-ink-850 hover:text-neutral-200",
            )}
          >
            {id}
          </button>
        ))}
        {json?.error && tab === "preview" && (
          <span className="ml-auto truncate text-[11px] text-rose-400">Invalid JSON</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "edit" ? (
          <label className="flex h-full flex-col">
            <span className="sr-only">Edit this artifact</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="h-full min-h-[24rem] w-full resize-none bg-ink-950 p-4 font-mono text-xs leading-relaxed text-neutral-100 outline-none"
            />
          </label>
        ) : kind === "html" ? (
          <iframe
            // Empty sandbox: no scripts, no forms, no navigation, no same-origin.
            sandbox=""
            srcDoc={draft}
            title={`Preview of ${title}`}
            className="h-full min-h-[24rem] w-full border-0 bg-white"
          />
        ) : kind === "markdown" ? (
          <div className="prose-ugnay w-full min-w-0 max-w-none p-4 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        ) : (
          <div className="p-3">
            <CodeBlock
              language={kind === "json" ? "json" : artifact.language}
              code={json ? json.text : draft}
            />
            {json?.error && (
              <p role="alert" className="mt-2 text-[11px] leading-relaxed text-rose-400">
                {json.error}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
