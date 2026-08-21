/**
 * The first message a signed-out visitor typed, held until they come back
 * authenticated.
 *
 * sessionStorage, not the database: nothing is written for a visitor who has
 * no account yet, and the draft disappears with the tab if they never finish
 * signing up.
 */

export const GUEST_DRAFT_KEY = "ugnay-pending-message";

/** Long enough for a real first question, short enough to stay a draft. */
const MAX_DRAFT = 8000;

export function saveGuestDraft(text: string) {
  const draft = text.trim().slice(0, MAX_DRAFT);
  if (!draft) return;
  try {
    sessionStorage.setItem(GUEST_DRAFT_KEY, draft);
  } catch {
    // Storage blocked; the visitor simply retypes after signing in.
  }
}

/** Reads the draft and clears it, so it is only ever restored once. */
export function takeGuestDraft() {
  try {
    const draft = sessionStorage.getItem(GUEST_DRAFT_KEY);
    if (draft) sessionStorage.removeItem(GUEST_DRAFT_KEY);
    return draft?.trim() || null;
  } catch {
    return null;
  }
}
