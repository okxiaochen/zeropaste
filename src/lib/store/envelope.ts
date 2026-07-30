import { utf8Decode, utf8Encode, type Bytes } from "../crypto/encoding";

/**
 * The stored envelope: one self-contained binary blob per paste.
 *
 * Everything a reader needs lives in the object body rather than being split across a metadata store,
 * which is what allows the R2 and filesystem backends to share a single format and a single set of
 * tests. It also means there is no second place for a stale row to survive a delete.
 *
 * Note what is inside and what that implies. The nonce, salt and KDF parameters are here because a
 * client cannot decrypt without them; they are not secret. The content, language and title are inside
 * the ciphertext, so this format gives an operator no way to learn them. There is deliberately no
 * "has password" field: that flag lives in the URL fragment, which never reaches a server.
 *
 * Layout, big-endian:
 *
 *   offset  size  field
 *   0       4     magic "ZP01"
 *   4       8     expiresAt, unsigned 64-bit milliseconds since the epoch
 *   12      1     iv length
 *   13      1     salt length
 *   14      2     kdf length
 *   16      -     iv, salt, kdf (UTF-8 JSON), then ciphertext to the end
 */

const MAGIC = utf8Encode("ZP01");
const HEADER_BYTES = 16;

/** Bounds so a corrupt or hostile object cannot drive a huge allocation before validation. */
const MAX_IV_BYTES = 255;
const MAX_SALT_BYTES = 255;
const MAX_KDF_BYTES = 1024;

export class MalformedEnvelopeError extends Error {
  constructor(detail: string) {
    super(`Stored object is not a valid ZeroPaste envelope: ${detail}`);
    this.name = "MalformedEnvelopeError";
  }
}

export interface PasteEnvelope {
  expiresAt: Date;
  iv: Bytes;
  salt: Bytes;
  kdf: string;
  ciphertext: Bytes;
}

export function encodeEnvelope(envelope: PasteEnvelope): Bytes {
  const kdf = utf8Encode(envelope.kdf);

  if (envelope.iv.length > MAX_IV_BYTES) throw new Error("iv is too long to encode");
  if (envelope.salt.length > MAX_SALT_BYTES) throw new Error("salt is too long to encode");
  if (kdf.length > MAX_KDF_BYTES) throw new Error("kdf is too long to encode");

  const total =
    HEADER_BYTES + envelope.iv.length + envelope.salt.length + kdf.length + envelope.ciphertext.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out.set(MAGIC, 0);
  view.setBigUint64(4, BigInt(envelope.expiresAt.getTime()));
  view.setUint8(12, envelope.iv.length);
  view.setUint8(13, envelope.salt.length);
  view.setUint16(14, kdf.length);

  let offset = HEADER_BYTES;
  out.set(envelope.iv, offset);
  offset += envelope.iv.length;
  out.set(envelope.salt, offset);
  offset += envelope.salt.length;
  out.set(kdf, offset);
  offset += kdf.length;
  out.set(envelope.ciphertext, offset);

  return out;
}

export function decodeEnvelope(data: Uint8Array): PasteEnvelope {
  if (data.length < HEADER_BYTES) {
    throw new MalformedEnvelopeError(`only ${data.length} bytes, need at least ${HEADER_BYTES}`);
  }

  for (let i = 0; i < MAGIC.length; i += 1) {
    if (data[i] !== MAGIC[i]) {
      throw new MalformedEnvelopeError("magic bytes do not match");
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const expiresAtMs = Number(view.getBigUint64(4));
  const ivLength = view.getUint8(12);
  const saltLength = view.getUint8(13);
  const kdfLength = view.getUint16(14);

  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    throw new MalformedEnvelopeError("expiry timestamp is out of range");
  }

  const end = HEADER_BYTES + ivLength + saltLength + kdfLength;
  if (data.length < end) {
    throw new MalformedEnvelopeError("declared field lengths exceed the object size");
  }
  if (kdfLength > MAX_KDF_BYTES) {
    throw new MalformedEnvelopeError("kdf field is implausibly long");
  }

  // Copies rather than subarray views: a view keeps the whole object alive and, more importantly,
  // widens the type back to ArrayBufferLike, which the crypto layer rejects.
  const slice = (start: number, length: number): Bytes => {
    const out = new Uint8Array(length);
    out.set(data.subarray(start, start + length));
    return out;
  };

  let offset = HEADER_BYTES;
  const iv = slice(offset, ivLength);
  offset += ivLength;
  const salt = slice(offset, saltLength);
  offset += saltLength;
  const kdfBytes = slice(offset, kdfLength);
  offset += kdfLength;
  const ciphertext = slice(offset, data.length - offset);

  return {
    expiresAt: new Date(expiresAtMs),
    iv,
    salt,
    kdf: utf8Decode(kdfBytes),
    ciphertext,
  };
}

/**
 * Reads only the expiry, without copying the ciphertext.
 *
 * Used by the sweep, which has to decide whether to delete an object and does not care what is in it.
 */
export function peekExpiresAt(data: Uint8Array): Date {
  if (data.length < HEADER_BYTES) {
    throw new MalformedEnvelopeError("too short to contain a header");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return new Date(Number(view.getBigUint64(4)));
}
