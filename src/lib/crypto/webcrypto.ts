import { CryptoUnavailableError } from "./errors";

/**
 * Access to WebCrypto, with the secure-context requirement made explicit.
 *
 * Browsers expose crypto.subtle only in a secure context, meaning HTTPS or a localhost origin.
 * Served over plain HTTP on any other hostname, crypto.subtle is simply `undefined` and the
 * failure surfaces as "Cannot read properties of undefined (reading 'encrypt')" somewhere deep in
 * a call stack. Routing every use through here turns that into one actionable message.
 */
export function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CryptoUnavailableError();
  }
  return subtle;
}

/** Cheap check for rendering a blocking banner before the user types anything. */
export function isCryptoAvailable(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}

export function randomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new CryptoUnavailableError();
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
