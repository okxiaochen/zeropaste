import { describe, expect, it } from "vitest";

import { KEY_BYTES } from "@/lib/crypto/aes";
import { MalformedLinkError } from "@/lib/crypto/errors";
import { decodeFragment, encodeFragment } from "@/lib/crypto/fragment";

const seed = Uint8Array.from({ length: KEY_BYTES }, (_, i) => i);

describe("fragment codec", () => {
  it("round-trips without a password", () => {
    const decoded = decodeFragment(encodeFragment({ seed, passwordRequired: false }));
    expect(Buffer.from(decoded.seed)).toEqual(Buffer.from(seed));
    expect(decoded.passwordRequired).toBe(false);
  });

  it("round-trips with a password", () => {
    const decoded = decodeFragment(encodeFragment({ seed, passwordRequired: true }));
    expect(decoded.passwordRequired).toBe(true);
  });

  it("accepts the fragment with or without a leading hash", () => {
    const encoded = encodeFragment({ seed, passwordRequired: false });
    expect(decodeFragment(`#${encoded}`).passwordRequired).toBe(false);
    expect(decodeFragment(encoded).passwordRequired).toBe(false);
  });

  it("refuses to encode a seed of the wrong length", () => {
    expect(() => encodeFragment({ seed: new Uint8Array(16), passwordRequired: false })).toThrow(
      /must be 32 bytes/,
    );
  });

  it("reports a missing fragment as the truncation it usually is", () => {
    // The single most common support question: a chat client cut the URL at the '#'.
    expect(() => decodeFragment("")).toThrow(MalformedLinkError);
    expect(() => decodeFragment("#")).toThrow(/the part after # is missing/);
  });

  it("rejects a truncated key", () => {
    const truncated = encodeFragment({ seed, passwordRequired: false }).slice(0, -4);
    expect(() => decodeFragment(truncated)).toThrow(/probably truncated/);
  });

  it("rejects the wrong number of fields", () => {
    expect(() => decodeFragment("v1.n")).toThrow(/three dot-separated fields/);
    expect(() => decodeFragment("v1.n.abc.def")).toThrow(/three dot-separated fields/);
  });

  it("rejects an unknown version", () => {
    expect(() => decodeFragment("v2.n.AAAA")).toThrow(/unsupported link version "v2"/);
  });

  it("rejects an unknown password flag", () => {
    expect(() => decodeFragment("v1.x.AAAA")).toThrow(/unknown password flag "x"/);
  });

  it("rejects a key that is not base64url", () => {
    expect(() => decodeFragment("v1.n.!!!!")).toThrow(/not valid base64url/);
  });
});
