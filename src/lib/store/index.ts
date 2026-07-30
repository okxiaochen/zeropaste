import { expiryClassOf } from "../ids";
import type { PasteEnvelope } from "./envelope";

export * from "./envelope";

/**
 * The storage interface.
 *
 * Two implementations exist: R2 for Cloudflare, and the filesystem for self-hosting. Both store one
 * opaque envelope per paste under a key derived from the id, and both delete rather than mark.
 *
 * There is no SQL backend, and that is a privacy decision rather than a simplification. Cloudflare D1
 * keeps a restorable history of the database — its Time Travel feature can roll the whole database
 * back to any point inside the retention window, and it cannot be turned off — so a paste deleted at
 * expiry would remain recoverable for weeks. Object storage has no such mechanism: a delete is a
 * delete. SQLite has the milder version of the same problem, since `DELETE` leaves bytes in free pages
 * until `VACUUM` runs, whereas the filesystem backend can overwrite a file before unlinking it.
 *
 * Note what this interface cannot do. There is no list-by-content, no search, and no way to read a
 * paste without its id; and even holding the envelope, nothing here can decrypt it. The key never
 * reaches any server.
 */
export interface PasteStore {
  /**
   * Which backend this is, as data rather than as a class name — `constructor.name` does not survive
   * minification, which made an earlier healthcheck report the wrong backend while R2 was in fact
   * working.
   */
  readonly kind: "r2" | "filesystem";
  put(id: string, envelope: PasteEnvelope): Promise<void>;
  /** Returns null for a missing object. Callers handle expiry; the store does not interpret it. */
  get(id: string): Promise<PasteEnvelope | null>;
  delete(id: string): Promise<void>;
  /** Deletes every expired object, returning how many. */
  sweepExpired(now: Date): Promise<number>;
}

export const KEY_PREFIX = "pastes";

/**
 * Storage key for an id.
 *
 * The per-class prefix is what lets an R2 lifecycle rule bound each class independently, so the
 * storage layer enforces deletion even if this application never runs its sweep.
 */
export function storageKey(id: string): string {
  const expiry = expiryClassOf(id);
  if (!expiry) {
    throw new Error(`Cannot build a storage key for the malformed id ${JSON.stringify(id)}`);
  }
  return `${KEY_PREFIX}/${expiry.id}/${id}`;
}

export function classPrefix(expiryOptionId: string): string {
  return `${KEY_PREFIX}/${expiryOptionId}/`;
}
