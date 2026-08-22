"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link as LinkIcon, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import ShareModal from "./ShareModal";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

/**
 * Three-dot menu for the active conversation: copy link, rename inline, delete.
 * Every action reuses the store operations the sidebar already calls, so chat
 * history behaviour is unchanged.
 */
export default function ChatHeaderMenu({ chatId, title }: { chatId: string; title: string }) {
  const renameChat = useChatStore((s) => s.renameChat);
  const deleteChat = useChatStore((s) => s.deleteChat);

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(title);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setConfirmDelete(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?chat=${chatId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked; nothing useful to surface here.
    }
    close();
  }

  function commitRename() {
    setRenaming(false);
    const clean = draft.trim();
    if (clean && clean !== title) void renameChat(chatId, clean);
    else setDraft(title);
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-ink-850 px-2 py-1">
        <label htmlFor="header-rename" className="sr-only">
          Chat title
        </label>
        <input
          id="header-rename"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(title);
              setRenaming(false);
            }
          }}
          className="w-32 min-w-0 bg-transparent py-0.5 text-base text-neutral-100 outline-none sm:w-40 sm:text-sm"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commitRename}
          aria-label="Save title"
          className="rounded p-1 text-neutral-400 hover:text-neutral-100"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Chat options"
        className="rounded-lg p-2 text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden onClick={close} />
          <div
            role="menu"
            aria-label="Chat options"
            className="absolute right-0 top-[calc(100%+0.35rem)] z-40 w-[min(13rem,calc(100vw-1.5rem))] rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-2xl animate-fade-in"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close();
                setShareOpen(true);
              }}
              className={itemClass}
            >
              <Share2 className="h-4 w-4 text-neutral-500" aria-hidden />
              Share…
            </button>

            <button role="menuitem" type="button" onClick={() => void copyLink()} className={itemClass}>
              <LinkIcon className="h-4 w-4 text-neutral-500" aria-hidden />
              {copied ? "Link copied" : "Copy link"}
            </button>

            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close();
                setRenaming(true);
              }}
              className={itemClass}
            >
              <Pencil className="h-4 w-4 text-neutral-500" aria-hidden />
              Rename
            </button>

            <div className="my-1 h-px bg-ink-700" role="none" />

            {confirmDelete ? (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  close();
                  void deleteChat(chatId);
                }}
                className={cn(itemClass, "text-danger hover:bg-danger/10")}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete for good?
              </button>
            ) : (
              <button
                role="menuitem"
                type="button"
                onClick={() => setConfirmDelete(true)}
                className={cn(itemClass, "text-danger hover:bg-danger/10")}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </button>
            )}
          </div>
        </>
      )}

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        chatId={chatId}
        chatTitle={title}
      />
    </div>
  );
}

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-200 transition hover:bg-ink-800 focus:bg-ink-800 focus:outline-none";
