import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-side verification of a rewarded ad.
 *
 * Ad networks (AdMob SSV, Unity, ironSource, AppLovin) all reward the same way:
 * their servers call a callback URL of yours with the user id, a transaction id
 * and a signature. Nothing the browser says is trusted — a client that claims
 * "I watched it" grants nothing.
 *
 * Ugnay accepts that callback at /api/credits/ad-callback and checks an HMAC
 * over the query string using REWARDED_AD_SECRET, the shared key configured
 * with the network. With no secret set the feature is simply off: the callback
 * refuses everything, and the wallet UI does not offer it.
 */

export function rewardedAdsConfigured() {
  // Both are needed: the secret to verify the network's signature, and the
  // service role to grant, since the callback carries no user session and the
  // grant function is deliberately revoked from the anon role.
  return Boolean(process.env.REWARDED_AD_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** How long a callback stays valid, so an intercepted URL cannot be replayed later. */
const MAX_AGE_MS = 10 * 60 * 1000;

export interface AdCallback {
  userId: string;
  transactionId: string;
  timestamp: number;
  signature: string;
}

/**
 * Verifies the network's signature over `userId:transactionId:timestamp`.
 * Compared in constant time; a stale or future timestamp is rejected.
 */
export function verifyAdCallback(callback: AdCallback):
  | { ok: true }
  | { ok: false; reason: string } {
  const secret = process.env.REWARDED_AD_SECRET;
  if (!secret) return { ok: false, reason: "Rewarded ads are not configured." };

  if (!callback.userId || !callback.transactionId || !callback.signature) {
    return { ok: false, reason: "Incomplete callback." };
  }

  const age = Date.now() - callback.timestamp * 1000;
  if (!Number.isFinite(callback.timestamp) || age < -60_000 || age > MAX_AGE_MS) {
    return { ok: false, reason: "Callback expired." };
  }

  const expected = createHmac("sha256", secret)
    .update(`${callback.userId}:${callback.transactionId}:${callback.timestamp}`)
    .digest("hex");

  const given = Buffer.from(callback.signature, "utf8");
  const mine = Buffer.from(expected, "utf8");
  if (given.length !== mine.length || !timingSafeEqual(given, mine)) {
    return { ok: false, reason: "Bad signature." };
  }

  return { ok: true };
}
