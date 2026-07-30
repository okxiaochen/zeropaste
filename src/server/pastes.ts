import { getDb, vacuum } from "@/lib/db";
import { isExpired, resolveExpiresAt } from "@/lib/expiry";
import { generatePasteId } from "@/lib/ids";
import type { CreatePasteInput } from "@/lib/validation";

/**
 * Data access layer — the only module that talks to Prisma.
 *
 * Everything here handles ciphertext. There is no function to read paste content, because no such
 * function could exist: the decryption key never reaches this process.
 */

export interface StoredPaste {
  id: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  kdf: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreatedPaste {
  id: string;
  expiresAt: Date;
}

export async function createPaste(
  input: CreatePasteInput,
  now: Date = new Date(),
): Promise<CreatedPaste> {
  const db = await getDb();

  // A collision would need two of the same 128-bit random id, so no retry loop is warranted; if it
  // ever happened the unique constraint would surface it as a 500 rather than silent corruption.
  const paste = await db.paste.create({
    data: {
      id: generatePasteId(),
      ciphertext: input.ciphertext,
      iv: input.iv,
      salt: input.salt,
      kdf: input.kdf,
      sizeBytes: input.ciphertext.length,
      createdAt: now,
      expiresAt: resolveExpiresAt(input.ttlMs, now),
    },
    select: { id: true, expiresAt: true },
  });

  return paste;
}

/**
 * Fetches a paste, deleting it instead if it has expired.
 *
 * This is the first of the two deletion layers: a paste past its expiry is destroyed by the very
 * request that tried to read it, so an expired paste is unreachable even if the scheduled purge is
 * broken or disabled.
 */
export async function readPaste(id: string, now: Date = new Date()): Promise<StoredPaste | null> {
  const db = await getDb();

  const paste = await db.paste.findUnique({ where: { id } });
  if (!paste) return null;

  if (isExpired(paste.expiresAt, now)) {
    // deleteMany rather than delete: two concurrent readers can both reach this branch, and
    // deleteMany treats an already-deleted row as a no-op instead of throwing.
    await db.paste.deleteMany({ where: { id } });
    return null;
  }

  return paste;
}

export interface PurgeResult {
  deleted: number;
}

/**
 * The scheduled deletion layer. Hard-deletes every expired row, then reclaims the disk pages.
 *
 * The VACUUM is the part that makes the guarantee real rather than nominal: without it, SQLite
 * leaves deleted ciphertext sitting in the database file indefinitely.
 */
export async function purgeExpired(now: Date = new Date()): Promise<PurgeResult> {
  const db = await getDb();

  const { count } = await db.paste.deleteMany({ where: { expiresAt: { lte: now } } });
  if (count > 0) {
    await vacuum();
  }

  return { deleted: count };
}
