import { describe, expect, it } from "vitest";

import {
  DecryptionFailedError,
  PasswordRequiredError,
  buildShareUrl,
  decryptPaste,
  encryptPaste,
  type EncryptedRecord,
} from "@/lib/crypto";
import { IV_BYTES, KEY_BYTES, SALT_BYTES } from "@/lib/crypto/aes";

const PAYLOAD = {
  content: "const answer = 42;\nconsole.log(answer);\n",
  language: "typescript",
};

/** Strips the fragment off an encryptPaste result, leaving exactly what the server would store. */
function toRecord(result: Awaited<ReturnType<typeof encryptPaste>>): EncryptedRecord {
  return {
    ciphertext: result.ciphertext,
    iv: result.iv,
    salt: result.salt,
    kdf: result.kdf,
  };
}

describe("encryptPaste / decryptPaste", () => {
  it("round-trips content without a password", async () => {
    const result = await encryptPaste(PAYLOAD);
    const decrypted = await decryptPaste(toRecord(result), result.fragment);

    expect(decrypted.content).toBe(PAYLOAD.content);
    expect(decrypted.language).toBe("typescript");
  });

  it("round-trips content with a password", async () => {
    const result = await encryptPaste(PAYLOAD, "correct horse battery staple");
    const decrypted = await decryptPaste(
      toRecord(result),
      result.fragment,
      "correct horse battery staple",
    );

    expect(decrypted.content).toBe(PAYLOAD.content);
  });

  it("round-trips an optional title and omits it when absent", async () => {
    const withTitle = await encryptPaste({ ...PAYLOAD, title: "notes.ts" });
    expect((await decryptPaste(toRecord(withTitle), withTitle.fragment)).title).toBe("notes.ts");

    const without = await encryptPaste(PAYLOAD);
    expect((await decryptPaste(toRecord(without), without.fragment)).title).toBeUndefined();
  });

  it("round-trips multibyte content byte for byte", async () => {
    // Emoji and CJK are where a naive base64 or latin1 conversion would corrupt data.
    const content = "日本語とEmoji 🔐🎉 混在\ttabs\r\nCRLF";
    const result = await encryptPaste({ content, language: "plaintext" });
    expect((await decryptPaste(toRecord(result), result.fragment)).content).toBe(content);
  });

  it("round-trips content larger than a single deflate block", async () => {
    const content = "abcdefghij".repeat(20_000); // 200 KB, highly compressible
    const result = await encryptPaste({ content, language: "plaintext" });
    expect(result.ciphertext.length).toBeLessThan(content.length / 10);
    expect((await decryptPaste(toRecord(result), result.fragment)).content).toBe(content);
  });

  it("emits fields of the exact sizes the database schema expects", async () => {
    const result = await encryptPaste(PAYLOAD);
    expect(result.iv).toHaveLength(IV_BYTES);
    expect(result.salt).toHaveLength(SALT_BYTES);
  });

  it("produces a different ciphertext every time for identical input", async () => {
    // A fresh seed, salt, and nonce per paste. Identical ciphertexts would let the server detect
    // that two users pasted the same thing.
    const a = await encryptPaste(PAYLOAD);
    const b = await encryptPaste(PAYLOAD);

    expect(Buffer.from(a.ciphertext)).not.toEqual(Buffer.from(b.ciphertext));
    expect(Buffer.from(a.iv)).not.toEqual(Buffer.from(b.iv));
    expect(Buffer.from(a.salt)).not.toEqual(Buffer.from(b.salt));
    expect(a.fragment).not.toBe(b.fragment);
  });

  it("never puts the key material in anything the server receives", async () => {
    const result = await encryptPaste(PAYLOAD, "hunter2");
    const stored = JSON.stringify({
      ciphertext: Buffer.from(result.ciphertext).toString("base64"),
      iv: Buffer.from(result.iv).toString("base64"),
      salt: Buffer.from(result.salt).toString("base64"),
      kdf: result.kdf,
    });

    const seedFromFragment = result.fragment.split(".")[2]!;
    expect(stored).not.toContain(seedFromFragment);
    expect(stored).not.toContain("hunter2");
    // The stored KDF blob must not reveal whether a password was used.
    const noPassword = await encryptPaste(PAYLOAD);
    expect(result.kdf).toBe(noPassword.kdf);
  });
});

describe("decryption failure modes", () => {
  it("rejects a wrong password", async () => {
    const result = await encryptPaste(PAYLOAD, "right");
    await expect(decryptPaste(toRecord(result), result.fragment, "wrong")).rejects.toThrow(
      DecryptionFailedError,
    );
  });

  it("demands a password when the fragment says one is required", async () => {
    const result = await encryptPaste(PAYLOAD, "secret");
    await expect(decryptPaste(toRecord(result), result.fragment)).rejects.toThrow(
      PasswordRequiredError,
    );
  });

  it("rejects a single flipped bit in the ciphertext", async () => {
    const result = await encryptPaste(PAYLOAD);
    const record = toRecord(result);
    const tampered = Uint8Array.from(record.ciphertext);
    tampered[0] = tampered[0]! ^ 0b0000_0001;

    await expect(
      decryptPaste({ ...record, ciphertext: tampered }, result.fragment),
    ).rejects.toThrow(DecryptionFailedError);
  });

  it("rejects a flipped bit in the authentication tag", async () => {
    const result = await encryptPaste(PAYLOAD);
    const record = toRecord(result);
    const tampered = Uint8Array.from(record.ciphertext);
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 0b1000_0000;

    await expect(
      decryptPaste({ ...record, ciphertext: tampered }, result.fragment),
    ).rejects.toThrow(DecryptionFailedError);
  });

  it("rejects a substituted nonce", async () => {
    const result = await encryptPaste(PAYLOAD);
    const other = await encryptPaste(PAYLOAD);

    await expect(
      decryptPaste({ ...toRecord(result), iv: other.iv }, result.fragment),
    ).rejects.toThrow(DecryptionFailedError);
  });

  it("rejects a substituted salt", async () => {
    // The salt feeds HKDF, so swapping it yields a different key even with the right fragment.
    const result = await encryptPaste(PAYLOAD);
    const other = await encryptPaste(PAYLOAD);

    await expect(
      decryptPaste({ ...toRecord(result), salt: other.salt }, result.fragment),
    ).rejects.toThrow(DecryptionFailedError);
  });

  it("rejects a fragment from a different paste", async () => {
    const result = await encryptPaste(PAYLOAD);
    const other = await encryptPaste(PAYLOAD);

    await expect(decryptPaste(toRecord(result), other.fragment)).rejects.toThrow(
      DecryptionFailedError,
    );
  });

  it("cannot be decrypted from the stored record alone", async () => {
    // The core promise of the product, stated as a test: everything the operator has access to,
    // combined with every seed they could plausibly try, still fails.
    const result = await encryptPaste(PAYLOAD);
    const record = toRecord(result);

    const allZeroSeed = "v1.n." + Buffer.alloc(KEY_BYTES).toString("base64url");
    await expect(decryptPaste(record, allZeroSeed)).rejects.toThrow(DecryptionFailedError);
  });
});

describe("buildShareUrl", () => {
  it("places the fragment after the id", async () => {
    const url = buildShareUrl("https://paste.example.com", "abc123", "v1.n.KEY");
    expect(url).toBe("https://paste.example.com/p/abc123#v1.n.KEY");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildShareUrl("https://example.com/", "id", "frag")).toBe(
      "https://example.com/p/id#frag",
    );
  });
});
