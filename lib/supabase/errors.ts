/**
 * Readable Supabase/PostgREST errors.
 *
 * `PostgrestError` extends `Error`, whose properties are not enumerable, so
 * logging one directly prints `{}` and hides the cause. These helpers pull the
 * useful fields out explicitly.
 */

export interface DbError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** Codes meaning the table or function the query asked for does not exist. */
const MISSING_OBJECT_CODES = new Set([
  "PGRST202", // function not found in the schema cache
  "PGRST205", // table not found in the schema cache
  "42883", // undefined_function
  "42P01", // undefined_table
]);

/**
 * True when the failure is "this database object does not exist" — almost
 * always a migration that has not been run yet, rather than a bug in the query.
 */
export function isMissingDbObject(error: DbError | null | undefined) {
  if (!error) return false;
  if (error.code && MISSING_OBJECT_CODES.has(error.code)) return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("could not find the function") ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

/** Everything worth logging about a failed query, as one line. */
export function describeDbError(error: DbError | null | undefined) {
  if (!error) return "unknown error";
  const parts = [
    error.code && `code=${error.code}`,
    error.message && `message=${error.message}`,
    error.details && `details=${error.details}`,
    error.hint && `hint=${error.hint}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "unknown error";
}
