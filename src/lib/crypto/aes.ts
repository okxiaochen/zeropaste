import { DecryptionFailedError } from "./errors";
import { getSubtle, randomBytes } from "./webcrypto";

export const KEY_BYTES = 32; // AES-256
export const IV_BYTES = 12; // GCM standard nonce length
export const SALT_BYTES = 16;

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (rawKey.length !== KEY_BYTES) {
    throw new Error(`AES key must be ${KEY_BYTES} bytes, received ${rawKey.length}`);
  }
  return getSubtle().importKey("raw", rawKey as BufferSource, "AES-GCM", false, [usage]);
}

export interface AesGcmResult {
  iv: Uint8Array;
  /** Ciphertext with the 16-byte authentication tag appended, as WebCrypto returns it. */
  ciphertext: Uint8Array;
}

export async function aesGcmEncrypt(
  rawKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<AesGcmResult> {
  const key = await importAesKey(rawKey, "encrypt");
  // A fresh nonce per encryption. Reusing one under the same key would be catastrophic for GCM,
  // which is why callers never get to supply it.
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await getSubtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function aesGcmDecrypt(
  rawKey: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(rawKey, "decrypt");
  try {
    const plaintext = await getSubtle().decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    // WebCrypto throws a bare OperationError for every failure mode and deliberately reveals
    // nothing more. Normalise it rather than leaking an opaque browser error to the UI.
    throw new DecryptionFailedError();
  }
}
