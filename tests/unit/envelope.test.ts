import { describe, expect, it } from "vitest";

import type { Bytes } from "@/lib/crypto/encoding";
import {
  MalformedEnvelopeError,
  decodeEnvelope,
  encodeEnvelope,
  peekExpiresAt,
} from "@/lib/store/envelope";

function bytes(...values: number[]): Bytes {
  const out = new Uint8Array(values.length);
  out.set(values);
  return out;
}

const SAMPLE = {
  expiresAt: new Date("2026-10-01T12:34:56.789Z"),
  iv: bytes(...Array.from({ length: 12 }, (_, i) => i)),
  salt: bytes(...Array.from({ length: 16 }, (_, i) => 200 - i)),
  kdf: '{"alg":"argon2id","v":1,"m":65536,"t":3,"p":1}',
  ciphertext: bytes(...Array.from({ length: 64 }, (_, i) => (i * 7) % 256)),
};

describe("envelope round trip", () => {
  it("preserves every field exactly", () => {
    const decoded = decodeEnvelope(encodeEnvelope(SAMPLE));

    expect(decoded.expiresAt.toISOString()).toBe(SAMPLE.expiresAt.toISOString());
    expect(Buffer.from(decoded.iv)).toEqual(Buffer.from(SAMPLE.iv));
    expect(Buffer.from(decoded.salt)).toEqual(Buffer.from(SAMPLE.salt));
    expect(decoded.kdf).toBe(SAMPLE.kdf);
    expect(Buffer.from(decoded.ciphertext)).toEqual(Buffer.from(SAMPLE.ciphertext));
  });

  it("preserves millisecond precision in the expiry", () => {
    // Truncating to seconds would let a paste live up to a second past its expiry, and would make the
    // 10-minute option imprecise in a way users could notice.
    const expiresAt = new Date(1_800_000_000_123);
    const decoded = decodeEnvelope(encodeEnvelope({ ...SAMPLE, expiresAt }));
    expect(decoded.expiresAt.getTime()).toBe(1_800_000_000_123);
  });

  it("handles an empty ciphertext", () => {
    const decoded = decodeEnvelope(encodeEnvelope({ ...SAMPLE, ciphertext: bytes() }));
    expect(decoded.ciphertext).toHaveLength(0);
  });

  it("handles a large ciphertext", () => {
    const big = new Uint8Array(512 * 1024) as Bytes;
    big.fill(0xab);
    const decoded = decodeEnvelope(encodeEnvelope({ ...SAMPLE, ciphertext: big }));
    expect(decoded.ciphertext).toHaveLength(big.length);
    expect(decoded.ciphertext[512 * 1024 - 1]).toBe(0xab);
  });

  it("returns buffers the storage layer will accept", () => {
    // A subarray view would type as ArrayBufferLike and be rejected by the R2 binding, so the decoder
    // copies. This asserts the property rather than the implementation.
    const decoded = decodeEnvelope(encodeEnvelope(SAMPLE));
    expect(decoded.ciphertext.buffer.byteLength).toBe(decoded.ciphertext.byteLength);
    expect(decoded.iv.byteOffset).toBe(0);
  });

  it("stores nothing that reveals the content or whether a password was set", () => {
    // The privacy property, asserted as a test: the encoded bytes contain only what a client needs in
    // order to attempt decryption.
    const encoded = encodeEnvelope(SAMPLE);
    const asText = Buffer.from(encoded).toString("latin1");
    expect(asText).not.toContain("password");
    expect(asText).not.toContain("language");
    // The KDF blob is present, and is identical whether or not a password was used.
    expect(asText).toContain("argon2id");
  });
});

describe("peekExpiresAt", () => {
  it("reads the expiry without decoding the rest", () => {
    expect(peekExpiresAt(encodeEnvelope(SAMPLE)).getTime()).toBe(SAMPLE.expiresAt.getTime());
  });

  it("needs only the header, so the sweep never reads a body", () => {
    const header = encodeEnvelope(SAMPLE).subarray(0, 16);
    expect(peekExpiresAt(header).getTime()).toBe(SAMPLE.expiresAt.getTime());
  });
});

describe("malformed input", () => {
  it("rejects a truncated header", () => {
    expect(() => decodeEnvelope(bytes(1, 2, 3))).toThrow(MalformedEnvelopeError);
  });

  it("rejects wrong magic bytes", () => {
    // Guards against serving something that is not ours — a stray object in the bucket, or a file from
    // an unrelated tool sharing the directory.
    const encoded = encodeEnvelope(SAMPLE);
    encoded[0] = 0x58;
    expect(() => decodeEnvelope(encoded)).toThrow(/magic bytes/);
  });

  it("rejects declared lengths that exceed the object", () => {
    const encoded = encodeEnvelope(SAMPLE);
    // Claim a 65535-byte kdf in a small object.
    new DataView(encoded.buffer).setUint16(14, 0xffff);
    expect(() => decodeEnvelope(encoded)).toThrow(/exceed the object size/);
  });

  it("rejects a zero or negative expiry", () => {
    const encoded = encodeEnvelope(SAMPLE);
    new DataView(encoded.buffer).setBigUint64(4, 0n);
    expect(() => decodeEnvelope(encoded)).toThrow(/out of range/);
  });

  it("rejects an expiry beyond the safe integer range", () => {
    // An unsigned 64-bit field can hold values a Date cannot represent; silently producing an Invalid
    // Date would make the paste immortal.
    const encoded = encodeEnvelope(SAMPLE);
    new DataView(encoded.buffer).setBigUint64(4, 2n ** 60n);
    expect(() => decodeEnvelope(encoded)).toThrow(/out of range/);
  });

  it("refuses to encode an over-long kdf rather than truncating it", () => {
    expect(() => encodeEnvelope({ ...SAMPLE, kdf: "x".repeat(2000) })).toThrow(/too long/);
  });

  it("refuses to encode an over-long iv or salt", () => {
    const long = new Uint8Array(256) as Bytes;
    expect(() => encodeEnvelope({ ...SAMPLE, iv: long })).toThrow(/iv is too long/);
    expect(() => encodeEnvelope({ ...SAMPLE, salt: long })).toThrow(/salt is too long/);
  });
});
