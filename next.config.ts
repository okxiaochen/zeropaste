import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy.
 *
 * The single most important directive here is `connect-src 'self'`: it means that even if an XSS
 * were found, the injected code could not ship a decryption key to an attacker-controlled origin.
 *
 * `'wasm-unsafe-eval'` is required because Argon2id runs as WebAssembly (hash-wasm). Without it,
 * WebAssembly.instantiate is blocked and password-protected pastes cannot be created or opened.
 *
 * `'unsafe-inline'` in script-src is a known weakness: Next.js injects inline bootstrap scripts.
 * Replacing it with a per-request nonce requires middleware and is tracked as a Phase 3 item.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const baseHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Without this, a user clicking a link inside paste content could leak the full URL —
  // including the decryption key in the fragment — to a third-party site.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// HSTS is deliberately opt-in: enabling it on a host that later loses its certificate makes the
// site unreachable for the max-age duration, and it would break localhost development.
if (process.env.ENABLE_HSTS === "true") {
  baseHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  });
}

const noIndexHeaders = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      // Share links and the API that serves them must never be indexed or cached by proxies.
      { source: "/p/:path*", headers: noIndexHeaders },
      {
        source: "/api/pastes/:path*",
        headers: [
          ...noIndexHeaders,
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
