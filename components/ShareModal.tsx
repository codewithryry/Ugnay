"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Globe, Link as LinkIcon } from "lucide-react";
import Modal from "./Modal";
import { createClient } from "@/lib/supabase/client";
import { describeDbError, isMissingDbObject } from "@/lib/supabase/errors";
import { useChatStore } from "@/store/chatStore";
import type { SharedChat } from "@/types/db";

/** Shown when a table this feature needs is not in the database yet. */
const MIGRATION_HINT =
  "Sharing needs the latest database migration. Re-run supabase/schema.sql in the Supabase SQL editor.";

/** 32 hex characters, inside the 16–64 the slug constraint allows. */
function newSlug() {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Read-only public link for one conversation.
 *
 * The link exposes a frozen snapshot: `shared_up_to` is stamped when it is
 * created, so anything sent afterwards stays private until the owner reshares.
 * Readers go through the `get_shared_chat` function, which returns only the
 * title and the user/assistant turns — never the system prompt, the workspace,
 * the model, token counts or the owner's identity.
 */
export default function ShareModal({
  open,
  onClose,
  chatId,
  chatTitle,
}: {
  open: boolean;
  onClose: () => void;
  chatId: string;
  chatTitle: string;
}) {
  const sharingAllowed = useChatStore((s) => s.settings?.share_links_enabled ?? true);
  const userId = useChatStore((s) => s.userId);

  const [share, setShare] = useState<SharedChat | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await createClient()
      .from("shared_chats")
      .select("*")
      .eq("chat_id", chatId)
      .eq("revoked", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (loadError) {
      console.error("[ugnay] Could not read the share link:", describeDbError(loadError));
      setError(
        isMissingDbObject(loadError)
          ? MIGRATION_HINT
          : "Could not check this conversation's link. Please try again.",
      );
    } else {
      setShare((data as SharedChat) ?? null);
    }
    setLoading(false);
  }, [chatId]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setError(null);
      return;
    }
    void load();
  }, [open, load]);

  const url = share ? `${window.location.origin}/s/${share.slug}` : null;

  async function createLink() {
    if (!userId || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: createError } = await createClient()
      .from("shared_chats")
      .insert({ chat_id: chatId, user_id: userId, slug: newSlug() })
      .select("*")
      .single();

    if (createError || !data) {
      console.error("[ugnay] Could not create the share link:", describeDbError(createError));
      setError("Could not create a link. Please try again.");
    } else {
      setShare(data as SharedChat);
    }
    setBusy(false);
  }

  async function revoke() {
    if (!share || busy) return;
    setBusy(true);
    setError(null);
    const { error: revokeError } = await createClient()
      .from("shared_chats")
      .update({ revoked: true })
      .eq("id", share.id);

    if (revokeError) {
      console.error("[ugnay] Could not revoke the share link:", describeDbError(revokeError));
      setError("Could not turn off this link. Please try again.");
    } else {
      setShare(null);
    }
    setBusy(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked; the field below is selectable instead.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share conversation"
      description="Anyone with the link can read this conversation. No sign-in required."
      panelClassName="max-w-lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90"
        >
          Done
        </button>
      }
    >
      <p className="truncate text-sm text-neutral-300">{chatTitle}</p>

      {!sharingAllowed ? (
        <p className="mt-4 rounded-xl border border-ink-800 bg-ink-950 p-3.5 text-xs leading-relaxed text-neutral-500">
          Link sharing is turned off for this account. Enable it in Settings → Data Controls →
          “Allow chat link sharing”.
        </p>
      ) : loading ? (
        <p className="py-8 text-center text-sm text-neutral-500">Checking…</p>
      ) : share && url ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5">
            <Globe className="h-4 w-4 shrink-0 text-success" aria-hidden />
            <input
              readOnly
              value={url}
              aria-label="Public link to this conversation"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-200 outline-none"
            />
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={copied ? "Link copied" : "Copy link"}
              className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-600">
            This link shows the conversation as it stood on{" "}
            {new Date(share.shared_up_to).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Later messages stay private. Only the messages are shared — not your instructions,
            workspace, model or account.
          </p>

          <button
            type="button"
            onClick={() => void revoke()}
            disabled={busy}
            className="mt-4 rounded-xl border border-rose-900/70 px-3.5 py-2 text-sm text-rose-300 transition hover:bg-rose-950/40 disabled:opacity-50"
          >
            {busy ? "Turning off…" : "Turn off this link"}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void createLink()}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl border border-ink-700 px-3.5 py-2.5 text-sm text-neutral-200 transition hover:bg-ink-850 disabled:opacity-50"
          >
            <LinkIcon className="h-4 w-4" aria-hidden />
            {busy ? "Creating…" : "Create a public link"}
          </button>
          <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-600">
            A snapshot is taken when the link is created, so messages you send afterwards are not
            included. You can turn the link off at any time.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-400">
          {error}
        </p>
      )}
    </Modal>
  );
}
