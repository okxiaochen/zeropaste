import { classifyTtl, isExpired, resolveExpiresAt } from "@/lib/expiry";
import { generatePasteId } from "@/lib/ids";
import type { PasteEnvelope, PasteStore } from "@/lib/store";
import { getStore } from "@/lib/store/resolve";
import type { CreatePasteInput } from "@/lib/validation";

/**
 * The only module that talks to storage.
 *
 * Everything here handles ciphertext. There is no function to read paste content, because no such
 * function could exist: the decryption key never reaches this process.
 */

export interface CreatedPaste {
  id: string;
  expiresAt: Date;
}

export async function createPaste(
  input: CreatePasteInput,
  now: Date = new Date(),
): Promise<CreatedPaste> {
  const store = await getStore();

  // The class determines the storage prefix and therefore which lifecycle rule bounds the object.
  const expiry = classifyTtl(input.ttlMs);
  const id = generatePasteId(expiry);
  const expiresAt = resolveExpiresAt(input.ttlMs, now);

  await store.put(id, {
    expiresAt,
    iv: input.iv,
    salt: input.salt,
    kdf: input.kdf,
    ciphertext: input.ciphertext,
  });

  return { id, expiresAt };
}

/**
 * Fetches a paste, deleting it instead if it has expired.
 *
 * The first of three deletion layers: a paste past its expiry is destroyed by the very request that
 * tried to read it, so it is unreachable even if the scheduled sweep is broken or disabled. The other
 * two are that sweep and, on Cloudflare, the R2 lifecycle rule enforced by the storage layer itself.
 */
export async function readPaste(
  id: string,
  now: Date = new Date(),
): Promise<PasteEnvelope | null> {
  const store = await getStore();

  let envelope: PasteEnvelope | null;
  try {
    envelope = await store.get(id);
  } catch (error) {
    // A corrupt or foreign object cannot be served. Report it as missing and remove it rather than
    // returning a 500 that would confirm something exists at this id.
    console.warn(`zeropaste: unreadable object for ${id}`, error);
    await store.delete(id).catch(() => undefined);
    return null;
  }

  if (!envelope) return null;

  if (isExpired(envelope.expiresAt, now)) {
    await store.delete(id);
    return null;
  }

  return envelope;
}

export interface PurgeResult {
  deleted: number;
}

/**
 * The scheduled deletion layer.
 *
 * Accepts an explicit store because the Cloudflare `scheduled` event runs outside a request:
 * OpenNext's request context — and with it `getCloudflareContext()` — only exists during `fetch`, so
 * the cron path must hand its R2 binding in directly. Everything request-driven omits the argument.
 */
export async function purgeExpired(
  now: Date = new Date(),
  store?: PasteStore,
): Promise<PurgeResult> {
  const target = store ?? (await getStore());
  return { deleted: await target.sweepExpired(now) };
}
