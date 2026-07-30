/**
 * Per-IP fixed-window rate limiting, held in process memory.
 *
 * Scope and limits, stated plainly: this counts requests within a single app process. It is the
 * right tool for the single-container deployment this project targets, and it is not a distributed
 * rate limiter — running several replicas behind a load balancer multiplies the effective limit by
 * the replica count. Swapping in Redis would be the fix, and is deliberately not done here because
 * it would add a mandatory service to a deployment designed to need only one.
 *
 * What this is for, and what it is not for. It exists to bound resource abuse — someone scripting
 * `POST /api/pastes` to fill storage or burn through a quota. It is **not** an enumeration defence:
 * paste ids carry 128 bits of entropy, so guessing one is already infeasible by many orders of
 * magnitude and no rate limit meaningfully improves on that. Do not treat this as a security control.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();

/** Bounds memory use if a large number of distinct addresses appear. */
const MAX_TRACKED_KEYS = 20_000;

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS) prune(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client address.
 *
 * Behind a reverse proxy — which this app requires anyway for TLS — X-Forwarded-For is the only
 * source available, and it is trivially spoofable if the proxy does not overwrite it. Operators are
 * told to forward it correctly in docs/AGENT-DEPLOY.md §5. Requests with no usable address share a
 * single bucket rather than bypassing the limit.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test seam: clears all windows. */
export function resetRateLimits(): void {
  buckets.clear();
}
