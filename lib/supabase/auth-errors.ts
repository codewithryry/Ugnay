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
