import { bytesToBase64Url } from "./crypto/encoding";
import { randomBytes } from "./crypto/webcrypto";

/**
 * Paste identifiers.
 *
 * 16 random bytes encode to 22 unpadded base64url characters, giving 128 bits of entropy. Combined
 * with per-IP read rate limiting, guessing a live id is not a practical attack: even an adversary
 * who could test a billion ids per second would expect to need longer than the age of the universe.
 *
 * The id is not a secret in the way the fragment key is — knowing it reveals only that a paste
 * exists — but it is the sole thing standing between a crawler and an enumerable index, so it is
 * generated from a CSPRNG rather than a counter or timestamp.
 */

const ID_BYTES = 16;
export const ID_LENGTH = 22;

export function generatePasteId(): string {
  return bytesToBase64Url(randomBytes(ID_BYTES));
}

/** Cheap shape check so obviously-invalid ids never reach the database. */
export function isValidPasteId(value: string): boolean {
  return value.length === ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}
