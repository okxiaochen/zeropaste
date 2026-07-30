// @ts-ignore -- a build artefact with no type declarations, produced by `pnpm cf:build`.
import handler from "../.open-next/worker.js";

/**
 * The Worker entry point.
 *
 * `@opennextjs/cloudflare` generates a worker that exports only `fetch`. A Cron Trigger invokes a
 * `scheduled` handler, so without this wrapper the trigger would fire on time, find nothing to call,
 * and expired pastes would quietly stop being swept — with no error anywhere to notice. That silent
 * failure mode is the reason this file exists rather than having the cron call an HTTP route.
 *
 * The fetch path is delegated untouched.
 */
export default {
  fetch: handler.fetch,

  async scheduled(
    _controller: unknown,
    env: Record<string, unknown>,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    const { purgeExpired } = await import("./server/pastes");
    const { R2PasteStore } = await import("./lib/store/r2");

    // The store is built from the event's own env, not from getCloudflareContext(): OpenNext's
    // request context exists only inside `fetch`, so resolving it here throws. This was found the
    // hard way — the sweep failed on every cron tick while reads kept lazily deleting, which made
    // everything look fine.
    const bucket = env["PASTES"];
    if (!bucket) {
      console.error("zeropaste: scheduled sweep found no PASTES binding; check wrangler.jsonc");
      return;
    }

    const run = purgeExpired(new Date(), new R2PasteStore(bucket as never))
      .then(({ deleted }) => {
        if (deleted > 0) {
          // Counts only, never ids. Logging an id here would put it in Cloudflare's logs, which is
          // precisely what `observability.enabled: false` in wrangler.jsonc exists to avoid.
          console.log(`zeropaste: swept ${deleted} expired paste(s)`);
        }
      })
      .catch((error: unknown) => {
        // A failed sweep must not surface as a trigger failure. Reads still delete expired pastes
        // lazily, and the R2 lifecycle rules still bound every object independently of this.
        console.error("zeropaste: sweep failed", error);
      });

    ctx.waitUntil(run);
    await run;
  },
};
