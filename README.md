# ZeroPaste

An encrypted pastebin. Text is encrypted in the browser before it is uploaded, and the decryption
key travels in the URL fragment — the part after `#`, which browsers never send to a server.

The practical consequence: whoever runs the server, including the person who wrote it, cannot read
what users store. Not "does not", cannot. A full database dump contains ciphertext and nothing that
would decrypt it.

## What it does

- **Zero-knowledge encryption.** AES-256-GCM, key derived with HKDF from a random 32-byte seed that
  exists only in the share link.
- **Optional password.** Argon2id over the password is folded into the key, so both the link and the
  password are required. Neither alone is enough, and the server has neither.
- **Expiry that actually deletes.** 10 minutes to 3 months; 3 months is the default and the hard
  ceiling. There is no database — each paste is one opaque object, deleted by whichever comes first:
  the request that tried to read it, the 15-minute sweep, or (on Cloudflare) the R2 lifecycle rule.
  Self-hosted, the file's bytes are overwritten before it is unlinked. This design rejected
  Cloudflare D1 specifically because its Time Travel keeps deleted data restorable for weeks.
- **Unguessable, unindexed links.** 128-bit random ids, `X-Robots-Tag: noindex`,
  `Referrer-Policy: no-referrer`, and a viewer whose server-rendered HTML contains no content at all.
- **Syntax highlighting and formatting** for the languages listed in `src/lib/languages.ts` — all of
  it in the browser, because the server has no plaintext to work with.
- **A viewer that just shows the content.** No toolbar, no settings. One copy button that appears on
  hover.

## Requirements

- Node 22+ and pnpm (`corepack enable pnpm`)
- No database. Storage is Cloudflare R2 or a local directory, depending on where you deploy.
- **HTTPS in production.** Not a recommendation: `crypto.subtle` does not exist in an insecure
  context, so on plain HTTP outside localhost the app cannot encrypt anything.

## Development

```bash
corepack pnpm install
cp .env.example .env      # set STORAGE_DIR to a local path, e.g. ./local-store
corepack pnpm dev
```

```bash
corepack pnpm test        # crypto, envelope, store, formatters, folding, theme
corepack pnpm test:e2e    # Playwright against a production build
corepack pnpm typecheck
```

## Deployment

See **[docs/AGENT-DEPLOY.md](docs/AGENT-DEPLOY.md)**. It is written as a runbook an AI agent can
follow end to end — hand it to Claude Code or similar with shell access — and it works just as well
read by a person. Two supported targets:

**Cloudflare Workers + R2** (primary):

```bash
pnpm wrangler r2 bucket create zeropaste
pnpm cf:deploy
```

Fits the Workers Free plan (~2.7 MiB of the 3 MiB worker limit; the heavy client bundles are free
static assets). The runbook covers lifecycle rules, the WAF rate limit, and what Cloudflare can and
cannot see.

**Docker, self-hosted** (strongest privacy posture):

```bash
cp .env.example .env
docker compose up -d --build
```

One container, one volume, no database. Terminate TLS in front of it.

## Documentation

| File | Contents |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Architecture, tech stack decisions, and the feature roadmap |
| [docs/AGENT-DEPLOY.md](docs/AGENT-DEPLOY.md) | Deployment runbook, including failure modes |

## What this does not protect against

Stated plainly, because a security tool that oversells itself is worse than none:

- **A malicious or compromised server.** It serves the JavaScript that does the encryption, so it
  could serve JavaScript that leaks the key instead. This is the inherent limit of browser-based
  encryption and applies to every product in this category. Self-hosting is the mitigation: the
  server is you.
- **Anyone who has the link.** The link *is* the key. Treat it like a password.
- **Browser history, proxies that log URLs, and chat clients that preview links.** The fragment is
  not sent over the network, but it is in the URL bar and in history.
- **Access-pattern metadata, on the Cloudflare deployment.** Cloudflare's edge sees each request's
  IP, paste id, and timestamp — never the content or the key, but "who fetched what, when" is
  visible to them. This worker ships with observability logging disabled to avoid adding our own
  copy of that record. If access patterns themselves are sensitive, self-host.
