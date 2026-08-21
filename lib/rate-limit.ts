import { NextResponse } from "next/server";

/**
 * Fixed-window rate limiting, held in the process's memory.
 *
 * No extra service or dependency: each server instance keeps its own counters,
 * so on a platform that runs several instances the effective ceiling is the
 * limit times the number of live instances. That is enough to stop a single
 * account from hammering a paid provider, which is what these routes need. Move
 * the counters to a shared store if a hard global cap is ever required.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window rolls over. */
  resetAt: number;
}

const windows = new Map<string, Window>();
/** Guards against unbounded growth on a long-lived instance. */
const MAX_TRACKED_KEYS = 10_000;

/** Drops every window that has already expired. */
function prune(now: number) {
  windows.forEach((window, key) => {
    if (window.resetAt <= now) windows.delete(key);
  });
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry. Zero while the request is allowed. */
  retryAfter: number;
}

/**
 * Counts one request against `key`. The key must identify the caller — these
 * routes are authenticated, so they pass the user id and every account gets its
 * own budget.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const window = windows.get(key);

  if (!window || window.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) prune(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  window.count += 1;
  if (window.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
  }

  return { allowed: true, retryAfter: 0 };
}

/** The 429 every rate-limited route answers with. */
export function tooManyRequests(retryAfter: number) {
  return NextResponse.json(
    { error: "You are sending requests too quickly. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
