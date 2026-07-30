/**
 * Expiry policy.
 *
 * Three months is both the default and the hard ceiling. The clamp is applied server-side on every
 * create, so a modified client cannot store anything for longer.
 */

export const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ExpiryOption {
  id: string;
  label: string;
  ttlMs: number;
}

export const EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { id: "10m", label: "10 minutes", ttlMs: 10 * 60 * 1000 },
  { id: "1h", label: "1 hour", ttlMs: 60 * 60 * 1000 },
  { id: "1d", label: "1 day", ttlMs: 24 * 60 * 60 * 1000 },
  { id: "1w", label: "1 week", ttlMs: 7 * 24 * 60 * 60 * 1000 },
  { id: "1mo", label: "1 month", ttlMs: 30 * 24 * 60 * 60 * 1000 },
  { id: "3mo", label: "3 months", ttlMs: MAX_TTL_MS },
] as const;

export const DEFAULT_EXPIRY_ID = "3mo";

export function findExpiryOption(id: string): ExpiryOption | undefined {
  return EXPIRY_OPTIONS.find((option) => option.id === id);
}

/**
 * Converts a requested TTL into a concrete expiry timestamp, never exceeding MAX_TTL_MS.
 *
 * Deliberately takes `now` as a parameter so the clamp is testable without mocking the clock.
 */
export function resolveExpiresAt(requestedTtlMs: number, now: Date = new Date()): Date {
  const ttl = Math.min(Math.max(requestedTtlMs, 0), MAX_TTL_MS);
  return new Date(now.getTime() + ttl);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
