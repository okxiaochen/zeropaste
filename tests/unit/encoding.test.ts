import { describe, expect, it } from "vitest";

import { base64UrlToBytes, bytesToBase64Url, concatBytes } from "@/lib/crypto/encoding";

describe("base64url", () => {
  it("matches Node's base64url for every length up to 64 bytes", () => {
    // Covers all three padding cases (len % 3 === 0, 1, 2) many times over, against a reference
    // implementation rather than against itself.
    for (let length = 0; length <= 64; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
      expect(bytesToBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });

  it("round-trips every possible byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Buffer.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(Buffer.from(bytes));
  });

  it("decodes what Node encodes", () => {
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    const encoded = Buffer.from(bytes).toString("base64url");
    expect(Buffer.from(base64UrlToBytes(encoded))).toEqual(Buffer.from(bytes));
  });

  it("emits no padding and no URL-unsafe characters", () => {
    for (let length = 1; length <= 32; length += 1) {
      const encoded = bytesToBase64Url(new Uint8Array(length).fill(0xfb));
      expect(encoded).not.toContain("=");
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("handles the empty input", () => {
    expect(bytesToBase64Url(new Uint8Array(0))).toBe("");
    expect(base64UrlToBytes("")).toHaveLength(0);
  });

  it("tolerates padding that some tools add back", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    const padded = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    expect(Buffer.from(base64UrlToBytes(padded))).toEqual(Buffer.from(bytes));
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base64UrlToBytes("abc!def")).toThrow(/Invalid base64url character at index 3/);
    expect(() => base64UrlToBytes("ab+cd")).toThrow(/index 2/);
    expect(() => base64UrlToBytes("ab/cd")).toThrow(/index 2/);
    // Non-ASCII must not index past the lookup table and silently decode.
    expect(() => base64UrlToBytes("ab日cd")).toThrow(/index 2/);
  });
});

describe("concatBytes", () => {
  it("joins in order", () => {
    const joined = concatBytes(Uint8Array.from([1, 2]), new Uint8Array(0), Uint8Array.from([3]));
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });

  it("returns an empty array for no input", () => {
    expect(concatBytes()).toHaveLength(0);
  });
});
