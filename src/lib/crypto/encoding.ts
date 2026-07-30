/**
 * base64url (RFC 4648 §5), unpadded, implemented by hand.
 *
 * Written without btoa/atob or Buffer so that the exact same code path runs in the browser, in the
 * Node server, and under Vitest. Encoding bugs in a crypto boundary are expensive to find, so
 * there is deliberately only one implementation to test.
 */

/**
 * A byte array backed by a plain ArrayBuffer.
 *
 * Since TypeScript 5.7 typed arrays are generic over their buffer, and a bare `Uint8Array` means
 * `Uint8Array<ArrayBufferLike>` — which includes SharedArrayBuffer, and is therefore rejected by APIs
 * that need a transferable buffer, including the R2 binding and parts of node:fs. Annotate byte
 * variables with this rather than `Uint8Array` so the narrower type survives to the storage layer.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;

    out += ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;

    out += ALPHABET[b2 & 0b111111];
  }

  return out;
}

/**
 * The return type is intentionally left to inference rather than annotated as `Uint8Array`.
 *
 * Since TypeScript 5.7, typed arrays are generic over their backing buffer, and a bare
 * `Uint8Array` means `Uint8Array<ArrayBufferLike>` — which Prisma's `Bytes` columns reject, as they
 * require `Uint8Array<ArrayBuffer>`. Returning the freshly allocated array keeps the narrower type
 * all the way through to the database layer.
 */
export function base64UrlToBytes(input: string) {
  // A trailing '=' is tolerated because some tools add padding back; the decoder ignores it.
  const source = input.endsWith("=") ? input.replace(/=+$/, "") : input;

  // Exact for unpadded base64url at every input length, so no trimming is needed afterwards —
  // and no `subarray`, which would widen the type back to ArrayBufferLike.
  const out = new Uint8Array(Math.floor((source.length * 3) / 4));
  let value = 0;
  let bits = 0;
  let written = 0;

  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    const digit = code < 128 ? (LOOKUP[code] ?? -1) : -1;
    if (digit < 0) {
      throw new Error(`Invalid base64url character at index ${i}`);
    }

    value = (value << 6) | digit;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out[written] = (value >> bits) & 0xff;
      written += 1;
    }
  }

  if (written !== out.length) {
    // Unreachable for well-formed input; a mismatch would mean the length arithmetic above is
    // wrong, which must not silently produce a short buffer.
    throw new Error(`base64url decode produced ${written} bytes, expected ${out.length}`);
  }

  return out;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
