import { deflateSync, inflateSync } from "fflate";

/**
 * Deflate before encrypting. Source code and logs typically compress to 20–30% of their original
 * size, which directly reduces what has to be stored and transferred.
 *
 * Order matters: compress then encrypt. The reverse would be pointless, since ciphertext is
 * indistinguishable from random and does not compress.
 *
 * Worth being explicit about the trade-off: compressing before encrypting leaks a little
 * information through ciphertext length, since more repetitive content compresses further. That is
 * the same class of side channel as CRIME/BREACH, but those attacks need an adversary who can
 * inject chosen plaintext into the same ciphertext and observe the result repeatedly. A paste is
 * encrypted once, by its author, from content the author already possesses, so there is no such
 * oracle here.
 */

export function compress(data: Uint8Array): Uint8Array {
  return deflateSync(data, { level: 6 });
}

export function decompress(data: Uint8Array): Uint8Array {
  return inflateSync(data);
}
