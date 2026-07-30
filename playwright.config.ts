import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build, because that is where the dynamic imports for
 * grammars, themes, and formatters are actually code-split. A dev-server run would pass while
 * hiding a broken chunk boundary.
 *
 * 127.0.0.1 rather than a hostname: WebCrypto needs a secure context, and a loopback address counts
 * as one over plain HTTP. Any other host would require TLS even for tests.
 */
const PORT = 3210;

/**
 * Set E2E_BASE_URL to test an already-running instance instead of launching one — for example the
 * Docker image, which is worth checking directly because its chunk layout comes from a separate
 * build. Must still be a secure context, so use a loopback address or HTTPS.
 */
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;
const BASE_URL = EXTERNAL_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Where the filesystem backend keeps objects during a local e2e run.
 *
 * `__dirname` rather than `import.meta.dirname`: Playwright transpiles this config to CommonJS.
 */
const E2E_STORE = path.resolve(__dirname, "tests/e2e-store");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command: "node .next/standalone/server.js",
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          PORT: String(PORT),
          HOSTNAME: "127.0.0.1",
          STORAGE_DIR: E2E_STORE,
          CRON_SECRET: "playwright-e2e-secret-value",
        },
      },
});
