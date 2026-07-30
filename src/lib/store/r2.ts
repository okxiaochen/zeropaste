import { EXPIRY_OPTIONS } from "../expiry";
import { decodeEnvelope, encodeEnvelope, type PasteEnvelope } from "./envelope";
import { classPrefix, storageKey, type PasteStore } from "./index";

/**
 * Cloudflare R2 backend.
 *
 * R2 was chosen over D1 for a specific reason: a delete here is final. D1 keeps a restorable history
 * of the database that cannot be disabled, which would leave expired pastes recoverable for weeks and
 * contradict the whole point of an expiry. R2 has an equivalent hazard in object versioning, but that
 * is opt-in — see docs/AGENT-DEPLOY.md, which instructs operators to leave it off.
 *
 * The R2 binding is part of the Workers runtime, so this backend adds nothing to the worker bundle.
 */

/** The subset of the R2 binding this backend uses, declared locally to avoid a global type dependency. */
export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    include?: ("customMetadata" | "httpMetadata")[];
  }): Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

/**
 * Copied into R2 custom metadata purely so the sweep can decide what to delete from a `list` call,
 * without fetching every body. The envelope inside the object stays authoritative.
 */
const EXPIRES_AT_METADATA = "expires-at";

export class R2PasteStore implements PasteStore {
  readonly kind = "r2" as const;

  constructor(private readonly bucket: R2Bucket) {}

  async put(id: string, envelope: PasteEnvelope): Promise<void> {
    const body = encodeEnvelope(envelope);
    await this.bucket.put(storageKey(id), body, {
      customMetadata: { [EXPIRES_AT_METADATA]: String(envelope.expiresAt.getTime()) },
    });
  }

  async get(id: string): Promise<PasteEnvelope | null> {
    const object = await this.bucket.get(storageKey(id));
    if (!object) return null;

    const buffer = await object.arrayBuffer();
    return decodeEnvelope(new Uint8Array(buffer));
  }

  async delete(id: string): Promise<void> {
    await this.bucket.delete(storageKey(id));
  }

  /**
   * Deletes expired objects, class by class.
   *
   * Reads expiry from the listing's custom metadata rather than from object bodies, which keeps the
   * cost proportional to the number of objects rather than to how much data they hold. An object
   * missing that metadata is treated as expired: it can only be a partial write or something this
   * application did not create, and neither is worth keeping in a store of short-lived data.
   */
  async sweepExpired(now: Date): Promise<number> {
    let deleted = 0;

    for (const option of EXPIRY_OPTIONS) {
      let cursor: string | undefined;

      do {
        const listing = await this.bucket.list({
          prefix: classPrefix(option.id),
          include: ["customMetadata"],
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        });

        const doomed = listing.objects
          .filter((object) => {
            const raw = object.customMetadata?.[EXPIRES_AT_METADATA];
            if (raw === undefined) return true;
            const expiresAt = Number(raw);
            return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
          })
          .map((object) => object.key);

        if (doomed.length > 0) {
          await this.bucket.delete(doomed);
          deleted += doomed.length;
        }

        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
    }

    return deleted;
  }
}
