/**
 * Expiry policy.
 *
 * Three months is both the default and the hard ceiling. The clamp is applied server-side on every
 * create, so a modified client cannot store anything for longer.
 *
 * Each option also carries a storage class. Objects are keyed under a per-class prefix so that an R2
 * lifecycle rule can enforce a hard deletion ceiling at the storage layer, independently of anything
 * this application does. That is the point of the class: if our sweep is broken, misconfigured, or
 * never runs, Cloudflare still deletes the object.
 */

export const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ExpiryOption {
  id: string;
  label: string;
  ttlMs: number;
  /**
   * Single character embedded in the paste id, so a reader can rebuild the storage key from the id
   * alone without an index to consult.
   *
   * This reveals the expiry class to anyone holding the link — who can read the paste anyway — and to
   * the server, which stores the exact expiry regardless. No new information is exposed.
   */
  classChar: string;
  /** Lifecycle ceiling in days, always at or above the logical TTL. */
  lifecycleDays: number;
}

export const EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { id: "10m", label: "10 minutes", ttlMs: 10 * 60 * 1000, classChar: "a", lifecycleDays: 1 },
  { id: "1h", label: "1 hour", ttlMs: 60 * 60 * 1000, classChar: "b", lifecycleDays: 1 },
  { id: "1d", label: "1 day", ttlMs: 24 * 60 * 60 * 1000, classChar: "c", lifecycleDays: 2 },
  { id: "1w", label: "1 week", ttlMs: 7 * 24 * 60 * 60 * 1000, classChar: "d", lifecycleDays: 8 },
  { id: "1mo", label: "1 month", ttlMs: 30 * 24 * 60 * 60 * 1000, classChar: "e", lifecycleDays: 31 },
  { id: "3mo", label: "3 months", ttlMs: MAX_TTL_MS, classChar: "f", lifecycleDays: 91 },
] as const;

export const DEFAULT_EXPIRY_ID = "3mo";

export function findExpiryOption(id: string): ExpiryOption | undefined {
  return EXPIRY_OPTIONS.find((option) => option.id === id);
}

export function findExpiryByClassChar(classChar: string): ExpiryOption | undefined {
  return EXPIRY_OPTIONS.find((option) => option.classChar === classChar);
}

/**
 * Maps a requested TTL onto a storage class.
 *
 * The smallest class whose TTL covers the request, so a client asking for an unlisted duration cannot
 * land in a class whose lifecycle rule would delete the object early.
 */
export function classifyTtl(ttlMs: number): ExpiryOption {
  const clamped = Math.min(Math.max(ttlMs, 0), MAX_TTL_MS);
  for (const option of EXPIRY_OPTIONS) {
    if (clamped <= option.ttlMs) return option;
  }
  // Unreachable: the clamp guarantees the last option matches.
  return EXPIRY_OPTIONS[EXPIRY_OPTIONS.length - 1]!;
}

/**
 * Converts a requested TTL into a concrete expiry timestamp, never exceeding MAX_TTL_MS.
 *
 * Takes `now` as a parameter so the clamp is testable without mocking the clock.
 */
export function resolveExpiresAt(requestedTtlMs: number, now: Date = new Date()): Date {
  const ttl = Math.min(Math.max(requestedTtlMs, 0), MAX_TTL_MS);
  return new Date(now.getTime() + ttl);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
