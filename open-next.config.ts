import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers build configuration — SPIKE ONLY.
 *
 * This branch exists to answer two questions before committing to a Cloudflare port:
 * how large is the worker bundle, and how much CPU does one request use. Nothing here is
 * production-ready; see docs/CLOUDFLARE-SPIKE.md for the findings.
 */
export default defineCloudflareConfig();
