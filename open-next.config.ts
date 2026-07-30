import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers build configuration.
 *
 * Deliberately minimal. Incremental cache, tag cache, and queue backends are all left unconfigured
 * because this application has nothing to cache: every route that matters is `force-dynamic`, and the
 * viewer's HTML is an empty shell by design — the content only exists after the browser decrypts it.
 */
export default defineCloudflareConfig();
