/**
 * Auth failures that no retry can fix: the session references a user GoTrue
 * cannot resolve ("User not found"), or the refresh token is gone. The only
 * recovery is to drop the stored session and sign in again.
 */
const UNRECOVERABLE_CODES = new Set([
  "user_not_found",
  "session_not_found",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "bad_jwt",
]);

/**
 * "Auth session missing!" — simply nobody is signed in.
 *
 * `getUser()` reports this as an error, but on a page that serves signed-out
 * visitors (the landing New Chat) it is the ordinary state, not a fault, so it
 * must not be logged as one.
 */
export function isMissingSession(
  error: { name?: string; code?: string; message?: string } | null | undefined,
) {
  if (!error) return false;
  if (error.name === "AuthSessionMissingError") return true;
  if (error.code === "session_missing") return true;
  return (error.message?.toLowerCase() ?? "").includes("auth session missing");
}

export function isUnrecoverableAuthError(
  error: { code?: string; message?: string; status?: number } | null | undefined,
) {
  if (!error) return false;
  if (error.code && UNRECOVERABLE_CODES.has(error.code)) return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("user not found") ||
    message.includes("user from sub claim in jwt does not exist") ||
    message.includes("invalid refresh token")
  );
}
