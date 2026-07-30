import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { EXPIRY_OPTIONS } from "../expiry";
import { decodeEnvelope, encodeEnvelope, peekExpiresAt, type PasteEnvelope } from "./envelope";
import { classPrefix, storageKey, type PasteStore } from "./index";

/**
 * Filesystem backend, for the self-hosted deployment.
 *
 * This is the stronger of the two backends on erasure, and deliberately so. Deletion overwrites the
 * file with random bytes and flushes to disk before unlinking, so the ciphertext is gone from the
 * device rather than merely unreferenced. SQLite could not offer that — `DELETE` leaves the bytes in
 * free pages until `VACUUM` runs — and Cloudflare D1 is worse still, keeping a restorable history that
 * cannot be switched off.
 *
 * The honest caveat: on a copy-on-write filesystem (APFS, Btrfs, ZFS) or an SSD with wear levelling,
 * an in-place overwrite is not guaranteed to reach the same physical blocks. Full-disk encryption is
 * the real answer to physical recovery; this raises the cost of casual recovery, which is what it is
 * for.
 */
export class FilesystemPasteStore implements PasteStore {
  readonly kind = "filesystem" as const;

  constructor(private readonly root: string) {}

  private pathFor(id: string): string {
    return path.join(this.root, storageKey(id));
  }

  async put(id: string, envelope: PasteEnvelope): Promise<void> {
    const target = this.pathFor(id);
    await mkdir(path.dirname(target), { recursive: true });

    // Write to a temporary name and rename into place, so a crash mid-write cannot leave a truncated
    // object that a reader would treat as corrupt.
    const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, encodeEnvelope(envelope), { mode: 0o600 });
    await rename(temporary, target);
  }

  async get(id: string): Promise<PasteEnvelope | null> {
    try {
      return decodeEnvelope(await readFile(this.pathFor(id)));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await shred(this.pathFor(id));
  }

  async sweepExpired(now: Date): Promise<number> {
    let deleted = 0;

    for (const option of EXPIRY_OPTIONS) {
      const directory = path.join(this.root, classPrefix(option.id));

      let entries: string[];
      try {
        entries = await readdir(directory);
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }

      for (const entry of entries) {
        const target = path.join(directory, entry);

        // Leftover temporaries belong to a crashed write; they are unreachable and safe to remove.
        if (entry.endsWith(".tmp")) {
          await shred(target);
          continue;
        }

        try {
          // Only the 16-byte header is needed to decide, so bodies are never read during a sweep.
          const header = await readHeader(target);
          if (peekExpiresAt(header).getTime() > now.getTime()) continue;
        } catch {
          // Unreadable or malformed: it cannot be served, so it should not be retained.
        }

        await shred(target);
        deleted += 1;
      }
    }

    return deleted;
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

async function readHeader(target: string): Promise<Uint8Array> {
  const handle = await open(target, "r");
  try {
    const buffer = new Uint8Array(16);
    await handle.read(buffer, 0, buffer.length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * Overwrites a file's contents in place with random bytes and flushes to the device.
 *
 * Exported so the property that matters can be tested directly: after this returns, the original bytes
 * are no longer at that offset on disk. Testing it through `delete` is not possible, because the file
 * is gone by the time the assertion could run.
 *
 * One pass, not the several that folklore recommends — multiple passes were aimed at magnetic media
 * that has not been in service for years, and on anything modern the limiting factor is block remapping
 * rather than pass count.
 */
export async function overwriteInPlace(target: string): Promise<void> {
  const { size } = await stat(target);
  if (size === 0) return;

  const handle = await open(target, "r+");
  try {
    await handle.write(randomBytes(size), 0, size, 0);
    // Without the flush the overwrite could sit in the page cache and never reach the device, which
    // would make the whole exercise decorative.
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Overwrites then unlinks. Missing files are not an error. */
async function shred(target: string): Promise<void> {
  try {
    await access(target, constants.F_OK);
  } catch {
    return;
  }

  try {
    await overwriteInPlace(target);
  } catch (error) {
    // An overwrite failure must not prevent the unlink below: a deleted-but-not-overwritten paste is
    // still far better than one that stays readable.
    if (!isMissing(error)) {
      console.warn(`zeropaste: could not overwrite ${target} before deleting it`, error);
    }
  }

  try {
    await unlink(target);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
