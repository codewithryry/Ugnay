"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import Modal from "./Modal";
import { createClient } from "@/lib/supabase/client";

/**
 * The Danger Zone: the only red surface in Settings, and the only place an
 * account can be destroyed. Shared by the desktop Manage view and the compact
 * Account panel so both form factors behave identically.
 *
 * Deletion runs through the `delete_own_account` RPC (security definer, pinned
 * to auth.uid()), which removes the auth user; every public table cascades
 * from it. On success the local session is cleared and the browser is sent to
 * /login for a clean start.
 */

const CONFIRM_PHRASE = "DELETE";

export default function AccountDangerZone() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = phrase.trim() === CONFIRM_PHRASE && !busy;

  function closeConfirm() {
    if (busy) return;
    setConfirmOpen(false);
    setPhrase("");
    setError(null);
  }

  async function deleteAccount() {
    if (phrase.trim() !== CONFIRM_PHRASE || busy) return;
    setBusy(true);
    setError(null);
    const { error: deleteError } = await createClient().rpc("delete_own_account");
    if (deleteError) {
      console.error("[ugnay] Could not delete the account:", deleteError);
      setBusy(false);
      setError("Could not delete your account. Please try again.");
      return;
    }
    // The auth user is gone; drop the local session and land on a clean login.
    await createClient().auth.signOut();
    window.location.assign("/login");
  }

  return (
    <>
      <section aria-labelledby="danger-zone-title" className="mt-8 border-t border-ink-800 pt-5">
        <div className="rounded-xl border border-danger/25 bg-danger-soft p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0">
                <h3 id="danger-zone-title" className="text-sm font-medium text-danger">
                  Danger Zone
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  This permanently removes your account and everything stored with
                  it. This cannot be undone.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-danger/30 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60 sm:w-auto"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Delete All
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="Delete All Data & Account?"
        description="This permanently deletes your account. It cannot be undone."
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirm}
              disabled={busy}
              className="rounded-lg px-3.5 py-2 text-sm text-neutral-400 hover:bg-ink-800 hover:text-neutral-100 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteAccount()}
              disabled={!ready}
              className="flex items-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Delete everything
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-neutral-300">
          Deleting your account removes it forever, along with:
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-neutral-400">
          <li>• All conversations and messages</li>
          <li>• Workspaces and their instructions</li>
          <li>• Custom instructions, presets, and preferences</li>
          <li>• Memory used for personalization, and feedback you sent</li>
          <li>• Share links, saved prompts, and file records</li>
          <li>• Your profile and sign-in — this email can register again, as a new account</li>
        </ul>

        <div className="mt-4">
          <label htmlFor="delete-confirm-phrase" className="mb-1.5 block text-xs text-neutral-400">
            Type{" "}
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-200">
              DELETE
            </span>{" "}
            to confirm
          </label>
          <input
            id="delete-confirm-phrase"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-danger/60 sm:text-sm"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
