import { isExpired, resolveExpiresAt } from "@/lib/expiry";
import { generatePasteId } from "@/lib/ids";
import type { CreatePasteInput } from "@/lib/validation";

/**
 * SPIKE ONLY — in-memory store, replacing the Prisma data access layer.
 *
 * Prisma cannot run on Workers at all: its client needs a native query engine binary. Stubbing the
 * store keeps this branch focused on the two numbers worth knowing before doing the real port —
 * worker bundle size and CPU time per request — without first migrating the ORM.
 *
 * A D1 implementation via Drizzle would add roughly 50KB to the bundle, so the size measured here is
 * a fair proxy. See docs/CLOUDFLARE-SPIKE.md.
 *
 * The original Prisma implementation is on `main`; do not merge this file.
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

// Per-isolate, so it evaporates constantly on Workers. Fine for a measurement, useless for anything else.
const store = new Map<string, StoredPaste>();

export async function createPaste(
  input: CreatePasteInput,
  now: Date = new Date(),
): Promise<CreatedPaste> {
  const id = generatePasteId();
  const expiresAt = resolveExpiresAt(input.ttlMs, now);

  store.set(id, {
    id,
    ciphertext: input.ciphertext,
    iv: input.iv,
    salt: input.salt,
    kdf: input.kdf,
    createdAt: now,
    expiresAt,
  });

  return { id, expiresAt };
}

export async function readPaste(id: string, now: Date = new Date()): Promise<StoredPaste | null> {
  const paste = store.get(id);
  if (!paste) return null;

  if (isExpired(paste.expiresAt, now)) {
    store.delete(id);
    return null;
  }

  return paste;
}

export interface PurgeResult {
  deleted: number;
}

export async function purgeExpired(now: Date = new Date()): Promise<PurgeResult> {
  let deleted = 0;
  for (const [id, paste] of store) {
    if (isExpired(paste.expiresAt, now)) {
      store.delete(id);
      deleted += 1;
    }
  }
  return { deleted };
}
