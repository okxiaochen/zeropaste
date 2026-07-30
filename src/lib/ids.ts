import { bytesToBase64Url } from "./crypto/encoding";
import { randomBytes } from "./crypto/webcrypto";
import { findExpiryByClassChar, type ExpiryOption } from "./expiry";

/**
 * Paste identifiers.
 *
 * An id is one storage-class character followed by 22 base64url characters — 16 random bytes, so 128
 * bits of entropy. Combined with edge rate limiting, guessing a live id is not a practical attack:
 * an adversary testing a billion ids per second would expect to need longer than the age of the
 * universe.
 *
 * The class character exists so a reader can rebuild the storage key from the id alone, with no index
 * to consult and therefore no second copy of anything to keep in sync. See src/lib/expiry.ts for why
 * that costs nothing in terms of disclosure.
 *
 * The id is not a secret in the way the fragment key is — knowing it reveals only that a paste exists
 * — but it is the only thing standing between a crawler and an enumerable index, so it comes from a
 * CSPRNG rather than a counter or a timestamp.
 */

const RANDOM_BYTES = 16;
const RANDOM_LENGTH = 22;
export const ID_LENGTH = RANDOM_LENGTH + 1;

export function generatePasteId(expiry: ExpiryOption): string {
  return expiry.classChar + bytesToBase64Url(randomBytes(RANDOM_BYTES));
}

/** Cheap shape check, so obviously-invalid ids never reach storage. */
export function isValidPasteId(value: string): boolean {
  if (value.length !== ID_LENGTH) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return findExpiryByClassChar(value[0]!) !== undefined;
}

/** The expiry class an id belongs to, or undefined if the id is malformed. */
export function expiryClassOf(id: string): ExpiryOption | undefined {
  if (!isValidPasteId(id)) return undefined;
  return findExpiryByClassChar(id[0]!);
}
