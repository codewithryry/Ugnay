"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useChatStore } from "@/store/chatStore";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function CodeBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);
  const wrapLines = useChatStore((s) => s.settings?.wrap_code_lines ?? false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / denied permission) — stay silent.
    }
  }

  return (
    <div className="group relative w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-ink-700 bg-[#0d0d10]">
      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-500">
          {language || "text"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Code copied" : "Copy code"}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        PreTag="div"
        wrapLongLines={wrapLines}
        customStyle={{
          margin: 0,
          background: "transparent",
          padding: "0.9rem 1rem",
          fontSize: "13px",
          lineHeight: 1.6,
          overflowX: wrapLines ? "hidden" : "auto",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
            overflowWrap: wrapLines ? "anywhere" : "normal",
            wordBreak: wrapLines ? "break-word" : "normal",
          },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
