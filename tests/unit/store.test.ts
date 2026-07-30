import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Bytes } from "@/lib/crypto/encoding";
import { EXPIRY_OPTIONS, findExpiryOption } from "@/lib/expiry";
import { generatePasteId, isValidPasteId } from "@/lib/ids";
import { FilesystemPasteStore, overwriteInPlace } from "@/lib/store/filesystem";
import { storageKey, type PasteEnvelope } from "@/lib/store";

function envelope(overrides: Partial<PasteEnvelope> = {}): PasteEnvelope {
  const iv = new Uint8Array(12) as Bytes;
  const salt = new Uint8Array(16) as Bytes;
  const ciphertext = new Uint8Array(48) as Bytes;
  ciphertext.fill(0x5a);

  return {
    expiresAt: new Date(Date.now() + 600_000),
    iv,
    salt,
    kdf: '{"alg":"argon2id","v":1,"m":65536,"t":3,"p":1}',
    ciphertext,
    ...overrides,
  };
}

const THREE_MONTHS = findExpiryOption("3mo")!;
const TEN_MINUTES = findExpiryOption("10m")!;

describe("storageKey", () => {
  it("routes an id to its expiry class prefix", () => {
    const id = generatePasteId(THREE_MONTHS);
    expect(storageKey(id)).toBe(`pastes/3mo/${id}`);
  });

  it("gives each class its own prefix, so lifecycle rules can differ", () => {
    // The prefix is what lets R2 enforce a per-class deletion ceiling at the storage layer.
    const prefixes = EXPIRY_OPTIONS.map((option) => storageKey(generatePasteId(option)));
    for (const option of EXPIRY_OPTIONS) {
      expect(prefixes.some((key) => key.startsWith(`pastes/${option.id}/`))).toBe(true);
    }
  });

  it("refuses a malformed id rather than inventing a key", () => {
    expect(() => storageKey("nope")).toThrow(/malformed id/);
    // A valid shape but an unknown class character must also be rejected.
    expect(() => storageKey("z" + "A".repeat(22))).toThrow(/malformed id/);
  });
});

describe("paste ids", () => {
  it("are 23 characters and carry their expiry class", () => {
    const id = generatePasteId(TEN_MINUTES);
    expect(id).toHaveLength(23);
    expect(id[0]).toBe(TEN_MINUTES.classChar);
    expect(isValidPasteId(id)).toBe(true);
  });

  it("are unique across many draws", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generatePasteId(THREE_MONTHS)));
    expect(ids.size).toBe(2000);
  });

  it("reject shapes that could not have come from this generator", () => {
    expect(isValidPasteId("")).toBe(false);
    expect(isValidPasteId("f" + "A".repeat(21))).toBe(false);
    expect(isValidPasteId("f" + "A".repeat(23))).toBe(false);
    expect(isValidPasteId("f" + "!".repeat(22))).toBe(false);
    expect(isValidPasteId("z" + "A".repeat(22))).toBe(false);
  });
});

describe("FilesystemPasteStore", () => {
  let root: string;
  let store: FilesystemPasteStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "zeropaste-test-"));
    store = new FilesystemPasteStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips an envelope", async () => {
    const id = generatePasteId(THREE_MONTHS);
    const original = envelope();
    await store.put(id, original);

    const read = await store.get(id);
    expect(read).not.toBeNull();
    expect(Buffer.from(read!.ciphertext)).toEqual(Buffer.from(original.ciphertext));
    expect(read!.expiresAt.getTime()).toBe(original.expiresAt.getTime());
  });

  it("returns null for a paste that was never written", async () => {
    expect(await store.get(generatePasteId(THREE_MONTHS))).toBeNull();
  });

  it("writes under the class prefix", async () => {
    const id = generatePasteId(TEN_MINUTES);
    await store.put(id, envelope());
    expect(await readdir(path.join(root, "pastes", "10m"))).toContain(id);
  });

  it("erases the ciphertext from disk, not just the reference", async () => {
    // The reason this backend exists rather than a SQLite one. Tested on the overwrite primitive
    // directly, because after `delete` the file is gone and there is nothing left to inspect.
    const id = generatePasteId(THREE_MONTHS);
    await store.put(id, envelope());

    const file = path.join(root, storageKey(id));
    const before = await readFile(file);
    expect(before.includes(Buffer.from([0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a]))).toBe(true);

    await overwriteInPlace(file);

    const after = await readFile(file);
    expect(after.length).toBe(before.length);
    expect(after.equals(before)).toBe(false);
    expect(after.includes(Buffer.from([0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a]))).toBe(false);
  });

  it("removes the file on delete", async () => {
    const id = generatePasteId(THREE_MONTHS);
    await store.put(id, envelope());
    await store.delete(id);

    await expect(readFile(path.join(root, storageKey(id)))).rejects.toThrow(/ENOENT/);
    expect(await store.get(id)).toBeNull();
  });

  it("leaves an empty file alone rather than failing to overwrite it", async () => {
    const directory = path.join(root, "pastes", "3mo");
    await mkdir(directory, { recursive: true });
    const empty = path.join(directory, "empty");
    await writeFile(empty, "");
    await expect(overwriteInPlace(empty)).resolves.toBeUndefined();
  });

  it("treats deleting a missing paste as a no-op", async () => {
    await expect(store.delete(generatePasteId(THREE_MONTHS))).resolves.toBeUndefined();
  });

  it("sweeps expired pastes and keeps live ones", async () => {
    const expired = generatePasteId(THREE_MONTHS);
    const live = generatePasteId(THREE_MONTHS);

    await store.put(expired, envelope({ expiresAt: new Date(Date.now() - 1000) }));
    await store.put(live, envelope({ expiresAt: new Date(Date.now() + 600_000) }));

    expect(await store.sweepExpired(new Date())).toBe(1);
    expect(await store.get(expired)).toBeNull();
    expect(await store.get(live)).not.toBeNull();
  });

  it("sweeps across every expiry class", async () => {
    const ids = EXPIRY_OPTIONS.map((option) => generatePasteId(option));
    for (const id of ids) {
      await store.put(id, envelope({ expiresAt: new Date(Date.now() - 1000) }));
    }

    expect(await store.sweepExpired(new Date())).toBe(ids.length);
    for (const id of ids) {
      expect(await store.get(id)).toBeNull();
    }
  });

  it("removes temporary files left by a crashed write", async () => {
    const directory = path.join(root, "pastes", "3mo");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "abc.deadbeef.tmp"), "partial");

    await store.sweepExpired(new Date());
    expect(await readdir(directory)).toHaveLength(0);
  });

  it("removes an object it cannot parse rather than retaining it", async () => {
    // An unreadable object can never be served, so keeping it would mean storing data with no purpose.
    const directory = path.join(root, "pastes", "3mo");
    await mkdir(directory, { recursive: true });
    const id = generatePasteId(THREE_MONTHS);
    await writeFile(path.join(directory, id), "not an envelope");

    expect(await store.sweepExpired(new Date())).toBe(1);
    expect(await readdir(directory)).toHaveLength(0);
  });

  it("sweeps a store that has never been written to", async () => {
    await expect(store.sweepExpired(new Date())).resolves.toBe(0);
  });

  it("does not expose a way to list or search content", () => {
    // Structural assertion: the store interface must not grow an enumeration method, because one would
    // turn a storage compromise into a content index.
    expect(Object.getOwnPropertyNames(FilesystemPasteStore.prototype).sort()).toEqual([
      "constructor",
      "delete",
      "get",
      "pathFor",
      "put",
      "sweepExpired",
    ]);
    expect(Object.getOwnPropertyNames(FilesystemPasteStore.prototype)).not.toContain("list");
  });
});
