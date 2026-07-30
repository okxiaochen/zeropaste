import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // The crypto module targets the browser but relies only on WebCrypto and TextEncoder, both of
    // which Node 22 exposes as globals. Running under Node keeps the suite fast and dependency-free.
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
