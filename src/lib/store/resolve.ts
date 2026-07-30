import { getEnv } from "../env";
import type { PasteStore } from "./index";
import { R2PasteStore, type R2Bucket } from "./r2";

/**
 * Picks the storage backend for the current deployment.
 *
 * On Cloudflare the R2 bucket arrives as a runtime binding rather than a connection string, so it is
 * read from the request context that `@opennextjs/cloudflare` exposes. On a self-hosted server there
 * is no such context and the filesystem backend is used instead.
 *
 * The filesystem backend is imported lazily. It pulls in `node:fs`, which must not be bundled into the
 * worker — the branch below is never taken there, but a static import would still be traced.
 */

let cached: PasteStore | null = null;

export async function getStore(): Promise<PasteStore> {
  if (cached) return cached;

  const bucket = await getR2Binding();
  if (bucket) {
    cached = new R2PasteStore(bucket);
    return cached;
  }

  const { FilesystemPasteStore } = await import("./filesystem");
  cached = new FilesystemPasteStore(getEnv().STORAGE_DIR);
  return cached;
}

/**
 * The R2 binding, if this process is a Worker.
 *
 * `getCloudflareContext` throws outside a Cloudflare runtime, and the module itself is only resolvable
 * once the adapter is installed, so both failures are treated the same way: not on Cloudflare.
 */
async function getR2Binding(): Promise<R2Bucket | null> {
  // Cheap gate first: outside a Worker there is no context to look for, and the import below would
  // drag the adapter into the self-hosted server's module graph for nothing.
  if (process.env.CLOUDFLARE_WORKER !== "1") return null;

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = getCloudflareContext();
    const bucket = (context.env as Record<string, unknown> | undefined)?.["PASTES"];
    if (!bucket) {
      // Fail loudly rather than falling back: on workerd the filesystem backend writes into a
      // virtual fs that evaporates with the isolate, which would silently lose every paste.
      throw new Error(
        "Running as a Cloudflare Worker but the PASTES R2 binding is missing. " +
          "Check r2_buckets in wrangler.jsonc.",
      );
    }
    return bucket as R2Bucket;
  } catch (error) {
    console.error("zeropaste: failed to resolve the R2 binding", error);
    throw error;
  }
}

/** Test seam: drops the memoised backend. */
export function resetStore(): void {
  cached = null;
}
