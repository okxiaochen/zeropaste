# ZeroPaste — Development Plan

A zero-knowledge encrypted pastebin, similar to Ubuntu Paste / PrivateBin.
The server stores ciphertext only. **Neither the developer nor a database administrator can decrypt user content.**

---

## 0. The Core Architectural Decision

The only architecture that actually delivers "the developer cannot read it" is
**client-side encryption with the key carried in the URL fragment** (the part after `#`).

Browsers **never** transmit the fragment to the server — it is absent from the request line and
from the `Referer` header. So a share link looks like this:

```
https://paste.example.com/p/nR7xK2mQ...#v1.n.8fJ2kLmN9pQ...
                            ^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^
                            server sees  server NEVER sees (AES-256 key)
```

Consequences — these are hard constraints, not preferences:

1. **The server cannot do syntax highlighting, formatting, previews, or OG images.** It has no
   plaintext. All of that happens in the browser.
2. **Losing the link means losing the data.** There is no recovery and no password reset.
3. **The server cannot verify a password.** A failed AES-GCM authentication tag *is* the
   "wrong password" signal.
4. Minimum unavoidable metadata: `id`, ciphertext length, creation time, and **expiry time**
   (without it we could not delete on schedule). Language, title, and content all live inside
   the ciphertext.

---

## 1. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript strict | Full stack, Route Handlers as the API, simple to self-host |
| Runtime | Node 22 LTS | Already installed locally (v22.22) |
| Package manager | **pnpm** | Fast, disk-efficient (`npm i -g pnpm` first) |
| UI | **Tailwind CSS v4 + shadcn/ui** (Radix primitives) | The mainstream React combo today; components are copied into the repo as source, so there is no runtime black box |
| Icons | lucide-react | shadcn's default pairing |
| Editor | **CodeMirror 6** (`@uiw/react-codemirror`) | An order of magnitude lighter than Monaco (~100KB vs ~2MB), per-language dynamic imports, usable on mobile |
| Viewer highlighting | **Shiki** | Same TextMate grammars as VS Code, emits static HTML, tiny DOM, dual light/dark themes via CSS variables |
| Formatters | `prettier/standalone`, `sql-formatter`, `xml-formatter` | Run entirely in the browser |
| Compression | **fflate** (deflate) | Compress before encrypting; text typically shrinks to 20–30% |
| Cryptography | **WebCrypto** (AES-256-GCM, HKDF) + **hash-wasm** (Argon2id) | Browser-native primitives; no third-party JS crypto to trust |
| Storage | **Cloudflare R2** (Workers) or **the filesystem** (Docker) — no database | See §3 |
| ORM | None. One opaque envelope per paste; there is nothing relational to model | See §3 |
| Validation | **Zod** | Shared schemas between client and server |
| Rate limiting | In-memory LRU (single container) | Prevents enumeration and spam |
| Forms | react-hook-form + zod resolver | — |
| Testing | **Vitest** (crypto, KDF, expiry logic) + **Playwright** (end-to-end) | Crypto code must be unit-tested |
| Deployment | **Cloudflare Workers + R2** (primary) or **Docker Compose**, a single container with a volume | See docs/AGENT-DEPLOY.md |

All source comments, identifiers, and documentation are written in English.

---

## 2. Cryptography (full spec in `docs/CRYPTO.md`)

### Without a password

```
key      = 32 random bytes            -> encoded into the URL fragment
payload  = deflate(JSON{ content, language, title, ... })
ct, iv   = AES-256-GCM(key, payload)
stored   = { id, ct, iv, salt, kdf, expiresAt, ... }
```

### With a password (two factors, both required)

```
seed     = 32 random bytes             -> encoded into the URL fragment
salt     = 16 random bytes             -> stored server-side (a salt is not a secret)
pwKey    = Argon2id(password, salt, m=64MiB, t=3, p=1) -> 32 bytes
key      = HKDF-SHA256(ikm = seed || pwKey, salt, info = "zeropaste-v1")
```

- Link only -> missing `pwKey` -> cannot decrypt.
- Password only -> missing `seed` -> cannot decrypt.
- Full database dump -> missing `seed` -> cannot decrypt. **This is the mathematical guarantee
  behind "the developer cannot read it."**

### Fragment format

```
#v1.<flag>.<base64url(32 bytes)>
       |
       +- n = no password
       +- p = password required
```

The password flag lives in the fragment, not the database — the server does not even know
*whether* a paste is password-protected.

---

## 3. Storage: One Encrypted Object per Paste, No Database

> **Architecture note (2026-07-30).** Phases 1–2 shipped on Prisma with per-provider SQLite and
> PostgreSQL schemas. That was replaced wholesale when Cloudflare became the primary target, for a
> privacy reason: Cloudflare D1 — the SQL option there — keeps a restorable history of the database
> (Time Travel) that cannot be disabled, so an expired-and-deleted paste would remain recoverable
> for weeks. That is incompatible with "expiry deletes the data". Object storage has no such
> mechanism, and once pastes are single opaque objects, the database earns nothing: there is exactly
> one access path (by id) and no relational structure at all.

Each paste is one binary envelope (`src/lib/store/envelope.ts`):

```
"ZP01" | expiresAt (u64 ms) | iv len | salt len | kdf len | iv | salt | kdf JSON | ciphertext
```

Everything a client needs to attempt decryption, nothing an operator could use to read content —
and no "has password" flag anywhere, since that travels in the URL fragment.

Two interchangeable backends implement `PasteStore` (`src/lib/store/`):

| | R2 (`r2.ts`) | Filesystem (`filesystem.ts`) |
|---|---|---|
| Used by | Cloudflare Workers | Docker / self-hosted |
| Key/path | `pastes/<class>/<id>` | `$STORAGE_DIR/pastes/<class>/<id>` |
| Delete semantics | Final (versioning must stay off) | Bytes overwritten with random data, fsync, then unlink |
| Bundle cost | None — the binding is part of the runtime | None — `node:fs`, lazily imported so it never enters the worker |

Ids are one expiry-class character plus 22 base64url characters (128 bits of entropy), so the
storage key derives from the id alone — no index, no lookup table, no second thing to keep in sync.

## 4. Expiry and Deletion — Three Layers

| Option | Value |
|---|---|
| 10 minutes / 1 hour / 1 day / 1 week / 1 month | Selectable |
| **3 months (90 days)** | **Default, and the maximum** |

The server never trusts the client-supplied value: `expiresAt = min(requested, now + 90d)`.

1. **Lazy delete** — a read of an expired paste deletes it inside that request and returns 404.
2. **Scheduled sweep** — every 15 minutes. Self-hosted: an in-process timer registered from
   `instrumentation.ts`. Cloudflare: a Cron Trigger into the `scheduled` handler in `src/worker.ts`
   (OpenNext's generated worker only exports `fetch`, so the wrapper is what makes the cron real —
   and the sweep builds its store from the event's own `env`, because `getCloudflareContext()`
   exists only during `fetch`).
3. **Storage-layer ceiling (Cloudflare)** — per-prefix R2 lifecycle rules delete each class at its
   TTL ceiling even if the application never runs. See docs/AGENT-DEPLOY.md §A5.

Deletion is real deletion. The filesystem backend overwrites file contents before unlinking; R2
deletes are final. `POST /api/cron/purge` (guarded by `CRON_SECRET`) remains as an external trigger
for operators who disable the in-process timer.

## 5. Unguessable Links, Invisible to Search Engines

**Unguessable**: `crypto.randomBytes(16)` -> 22 base64url characters, 128 bits of entropy.
Combined with rate limiting, enumeration is infeasible.

**Not indexable**, defense in depth:

- Response headers on `/p/:path*` via `next.config.ts`:
  `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`
- `generateMetadata` -> `robots: { index: false, follow: false }`
- `src/app/robots.ts` -> `Disallow: /p/`
- **`Referrer-Policy: no-referrer`** — critical. Without it, a user clicking an external link
  inside the content could leak the full URL, including the key, to a third party.
- The viewer is a **client component**. Content is decrypted in the browser and injected into the
  DOM, so the server-rendered HTML contains none of it — a crawler sees an empty page.
- A CSP that forbids `connect-src` to external origins, so an XSS cannot exfiltrate the key.

---

## 6. Pages

### `/` — Create

CodeMirror editor, searchable language picker, Format button, expiry picker, optional password
field, and a Create button. After creation: the full link including the fragment, a copy button,
a QR code, the expiry time, and a warning that **the link is shown only once**.

### `/p/[id]` — View (minimal)

Per the requirement: opening the link shows the content, nothing else.

```
+--------------------------------+
|  1  const foo = "bar"          |   <- code and line numbers only
|  2  ...                        |
+--------------------------------+
```

- A control cluster in the top-right corner, revealed on hover or keyboard focus and faded out
  otherwise: theme, collapse/expand all, and copy. Nothing else, and nothing visible at rest.
- Light and dark are user-selectable, with a third "follow the system" mode that is the default.
  The choice is stored in `localStorage` and never sent anywhere.
- If the fragment carries the `p` flag, a centered password prompt appears first; on success the
  whole page is replaced by the content.
- Virtualized scrolling for very long content.
- Failure state: a one-line 404 page for missing or expired links.

---

## 7. Language, Highlighting, and Formatter Support

`src/lib/languages.ts` is the single registry: one entry per language mapping to its Shiki id,
CodeMirror loader, and formatter.

| Language | Highlight | Formatter |
|---|---|---|
| JS / TS / JSX / TSX | Yes | Prettier |
| JSON / JSONC | Yes | Prettier |
| HTML / CSS / SCSS / LESS | Yes | Prettier |
| Markdown / YAML / GraphQL | Yes | Prettier |
| SQL (multiple dialects) | Yes | sql-formatter |
| XML | Yes | xml-formatter |
| Python / Go / Rust / Java / C / C++ / C# / PHP / Ruby / Shell / Dockerfile / TOML / INI / diff / log / plaintext | Yes | None |

Python, Go, and Rust formatters ship as native binaries and have no browser equivalent. They also
cannot be moved server-side, because the server has no plaintext. Supporting them requires WASM
builds (`@wasm-fmt/ruff_fmt`, `@wasm-fmt/gofmt`, roughly 2–5MB each, dynamically imported) — see
Phase 3.

---

## 8. Size Limits

Unlimited is not achievable; the constraints come from the stack, not from us:

- Postgres `bytea` and SQLite `BLOB` are both capped at 1GB.
- The Next.js standalone server imposes no request body limit of its own, but any reverse proxy
  the operator puts in front of it will (nginx defaults to 1MB) — see `AGENT-DEPLOY.md`.
- In the browser, WebCrypto plus base64 encoding holds roughly 3–4x the plaintext in memory.
- Shiki highlighting multi-megabyte text freezes the tab for minutes.

Therefore:

- `MAX_PLAINTEXT_BYTES` env var, default `10485760` (10MB); `0` disables the check entirely.
- `HIGHLIGHT_LIMIT_BYTES`, default `2097152` (2MB). Above it the viewer renders plain text with
  line numbers and skips highlighting, which keeps the page responsive.
- The editor warns before encrypting rather than failing after upload.

---

## 8a. HTTPS Is Mandatory, Not Optional

`crypto.subtle` — the entire WebCrypto API — is only exposed in a
[secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts). Served over
plain `http://` on any origin other than `localhost` or `127.0.0.1`, `window.crypto.subtle` is
`undefined` and the application cannot encrypt or decrypt at all. This is a browser rule; there is
no workaround and no degraded mode.

Compose therefore does **not** bundle a reverse proxy, but the operator must terminate TLS in
front of the container when exposing it beyond localhost — an existing nginx/Caddy/Traefik, a
Cloudflare Tunnel, or a Tailscale HTTPS endpoint all work.

Mitigations we implement:

- A startup check in the client entrypoint: if `window.isSecureContext` is false, render a clear
  blocking message naming the cause instead of throwing an opaque error.
- `AGENT-DEPLOY.md` leads with this requirement and includes a minimal Caddy example.
- `Strict-Transport-Security` is emitted when `ENABLE_HSTS=true` (off by default so localhost
  development is unaffected).

---

## 9. Directory Structure

```
zeropaste/
├─ docker-compose.yml           # a single `app` service, see below
├─ Dockerfile                   # multi-stage, Next.js standalone output
├─ docker/
├─ .env.example
├─ next.config.ts               # security headers, noindex
│  └─ migrations/{postgres,sqlite}/
├─ public/
├─ docs/
│  ├─ PLAN.md                   # this file
│  ├─ CRYPTO.md                 # crypto spec, auditable by a third party
│  ├─ THREAT-MODEL.md           # what this defends against, and what it does not
│  └─ AGENT-DEPLOY.md           # deployment runbook, written to be followed by an AI agent
├─ scripts/
│  └─ purge.ts                  # manual purge entrypoint, callable via docker exec
├─ src/
│  ├─ instrumentation.ts        # registers the in-process purge timer on server start
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx               # create page
│  │  ├─ globals.css            # Tailwind v4 + shadcn theme variables
│  │  ├─ robots.ts
│  │  ├─ p/[id]/
│  │  │  ├─ page.tsx            # minimal viewer (client component)
│  │  │  └─ not-found.tsx
│  │  └─ api/
│  │     ├─ pastes/route.ts         # POST create
│  │     ├─ pastes/[id]/route.ts    # GET read, with lazy delete
│  │     ├─ cron/purge/route.ts     # optional external purge trigger
│  │     └─ health/route.ts         # container healthcheck
│  ├─ components/
│  │  ├─ ui/                    # shadcn-generated components
│  │  ├─ editor/                # PasteEditor, LanguageSelect, ExpirySelect,
│  │  │                         # PasswordField, FormatButton, ShareResult
│  │  └─ viewer/                # PasteViewer, PasswordPrompt, HighlightedCode,
│  │                            # CopyButton
│  ├─ lib/
│  │  ├─ crypto/
│  │  │  ├─ aes.ts              # AES-256-GCM wrapper
│  │  │  ├─ kdf.ts              # Argon2id + HKDF
│  │  │  ├─ fragment.ts         # URL fragment encode/decode
│  │  │  ├─ compress.ts         # fflate
│  │  │  └─ index.ts            # encryptPaste / decryptPaste
│  │  ├─ languages.ts           # language registry
│  │  ├─ formatters/            # prettier.ts, sql.ts, xml.ts, index.ts
│  │  ├─ highlight/shiki.ts     # singleton highlighter, lazy language loading
│  │  ├─ ids.ts                 # random id generation
│  │  ├─ expiry.ts              # expiry options, 90-day server clamp
│  │  ├─ ratelimit.ts
│  │  ├─ validation.ts          # shared Zod schemas
│  │  └─ env.ts                 # env var validation via Zod
│  ├─ server/
│  └─ types/
└─ tests/
   ├─ unit/                     # crypto, fragment, expiry
   └─ e2e/                      # includes an assertion that no plaintext
                                # appears in API responses or the database
```

---

## 10. Deployment Shape

One service. No bundled database, no bundled reverse proxy.

```yaml
services:
  app:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    env_file: .env
    volumes:
      # Only used when DATABASE_PROVIDER=sqlite; harmless otherwise.
      - zeropaste-data:/data
    extra_hosts:
      # Lets DATABASE_URL point at a Postgres running on the host, on Linux too.
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "docker/healthcheck.js"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  zeropaste-data:
```

Operator responsibilities, documented in `AGENT-DEPLOY.md`:

- Provide `DATABASE_URL` (and create the Postgres database if using Postgres).
- Terminate TLS in front of the container — see §8a, this is not optional.
- Back up either the named volume (SQLite) or their own Postgres. Note that a backup is
  worthless for reading content: it contains only ciphertext, by design.

---

## 11. Feature Checklist

### Phase 1 — Skeleton, end to end — DONE

- [x] Next.js 15 + TS strict + Tailwind v4. shadcn/ui is **not** initialised yet: Phase 1 needs a
      textarea and three selects, so the components are plain elements over the CSS variables in
      `globals.css`. Run `shadcn init` at the start of Phase 2, when the language combobox and
      dialogs actually need it.
- [x] Both Prisma schemas, both migration sets, `src/lib/db.ts` provider switch.
      Each schema lives in its own directory (`prisma/postgres/`, `prisma/sqlite/`) because Prisma
      resolves the migrations folder relative to the schema file and would otherwise have the two
      providers share one history. The Postgres migration was produced offline with
      `prisma migrate diff`, so generating it needs no running database.
- [x] `src/lib/crypto/*`: AES-GCM, Argon2id, HKDF, fragment codec, deflate
- [x] Crypto unit tests — 37 passing, covering round-trip (including multibyte and 200 KB inputs),
      single-byte tamper, tag tamper, substituted nonce, substituted salt, foreign fragment, wrong
      password, and an assertion that identical input never produces identical ciphertext
- [x] `POST /api/pastes`, `GET /api/pastes/:id` with lazy delete, plus `/api/health` and
      `/api/cron/purge`
- [x] Minimal create page and viewer (plain `<pre>` with line numbers, no highlighting yet)
- [x] In-process purge timer via `instrumentation.ts`
- [x] Dockerfile, docker-compose.yml, entrypoint, healthcheck
- [x] Verified end to end against SQLite: 33 checks covering round-trip with and without a password,
      lazy expiry deletion, the 90-day clamp, malformed ids, input validation, security headers, and
      that the SQLite file and its WAL contain no plaintext
- [x] Verified end to end against a live PostgreSQL 16 as well: same 33 checks pass, and a
      `position('...'::bytea in ciphertext)` scan over the stored rows finds no plaintext

### Phase 2 — Core features — DONE

- [x] shadcn/ui initialised. Note: `shadcn init` cannot finish under corepack — it shells out to a
      `pnpm` binary that is not on PATH — so the token layer in `globals.css` is maintained by hand
      following shadcn's neutral palette and variable names. The components themselves are generated
      normally and sit on Base UI, not Radix, in the current `base-nova` style.
- [x] CodeMirror 6 editor, searchable language picker, per-language dynamic imports.
      `@codemirror/legacy-modes` covers the languages with no Lezer grammar.
- [x] Shiki highlighting in the viewer, dual light/dark themes in one HTML tree via CSS variables,
      line numbers from a CSS counter so copying the code does not pick them up
- [x] Formatters (Prettier / SQL / XML), each dynamically imported, failing without destroying the
      user's text
- [x] Expiry picker, default 3 months, server-side clamp
- [x] Password protection and the viewer password prompt
- [x] Result view: full link, copy, locally generated QR code, shown-only-once warning
- [x] Hover-revealed copy button in the viewer
- [x] All noindex headers, `no-referrer`, `robots.ts`, CSP including `wasm-unsafe-eval` for Argon2id
- [x] `MAX_PLAINTEXT_BYTES` and `HIGHLIGHT_LIMIT_BYTES` handling, with editor-side warning
- [x] 404 and expired pages
- [x] Code folding in both surfaces. The editor folds on the loaded Lezer grammar; the viewer has no
      syntax tree to work from, so it derives ranges from indentation (`src/lib/highlight/folding.ts`),
      which behaves identically for JSON, YAML, Python, and conventionally formatted brace languages.
- [x] JSON formatting always fully expands. Prettier's default keeps a single-line object inline when
      it fits `printWidth`, which is right for source code and wrong for "format this JSON", so the
      JSON parsers run with `printWidth: 1`. Not done with `JSON.stringify(JSON.parse(x))`, which
      silently truncates integers past `Number.MAX_SAFE_INTEGER` and reorders integer-like keys.
- [x] User-selectable theme: light, dark, or follow-the-system (default), cycled from one button and
      stored in `localStorage`. An inline script in `<head>` resolves it before first paint, so there
      is no flash of the wrong theme; that script is the sole reason the CSP still needs
      `'unsafe-inline'` in `script-src`.
- [x] Playwright e2e (pulled forward from Phase 3): 24 tests in real Chromium covering WebCrypto in a
      secure context, CodeMirror input, Shiki output, Prettier over the network, the password path,
      folding in both surfaces, theme selection and persistence, and assertions that no request body or
      URL ever carries the plaintext or the key

**A footgun found while wiring the e2e harness, worth knowing before deploying:** Prisma resolves a
*relative* SQLite path in `DATABASE_URL` against the directory holding the schema file, not the
process working directory. `file:./x.db` with `prisma/sqlite/schema.prisma` means
`prisma/sqlite/x.db`. Two commands pointed at the same-looking relative path can therefore create two
different databases, and the symptom is a table that does not exist. Use absolute paths; the Docker
default (`file:/data/zeropaste.db`) already does.

### Interlude — Cloudflare as primary target, storage rewrite — DONE (2026-07-30)

- [x] Spike measured first (branch `spike/cloudflare`): worker fits the free plan at ~2.7 MiB gzip,
      warm SSR 2–5 ms; full findings in the spike branch's docs/CLOUDFLARE-SPIKE.md
- [x] Prisma and both SQL providers removed — see the architecture note in §3 (D1 Time Travel is
      the reason SQL on Cloudflare was rejected outright)
- [x] `PasteStore` with R2 and filesystem backends over one versioned binary envelope (`ZP01`),
      16 new unit tests for the codec and 19 for the stores/ids
- [x] Custom worker entry (`src/worker.ts`) adding the `scheduled` handler OpenNext omits; sweep
      verified by log line (`swept 2 expired paste(s)`) with no reads involved, because a 404 after
      a read proves only the lazy-delete layer
- [x] Two real bugs found by verification and fixed: `constructor.name` backend detection broken by
      minification (now an explicit `kind` field), and `getCloudflareContext()` throwing inside
      `scheduled` (store now built from the event's own `env`)
- [x] Privacy hardening: Workers observability off (request logs would record paste ids), sweep logs
      counts only, WAF rate limiting rule documented as the real limiter at the edge
- [x] e2e suite green on both targets: 24/24 against workerd + Miniflare R2, 24/24 against the
      standalone filesystem build; stored objects verified opaque on both

### Deployed to Cloudflare — 2026-07-30

Live at `https://zeropaste.okxiaochen.workers.dev`, Workers Free plan, R2 bucket `zeropaste` with six
per-class lifecycle rules. All 24 e2e tests pass against production.

**Measured CPU time, and a correction.** The spike estimated CPU from local wall-clock at 2–5 ms.
That was wrong by more than an order of magnitude — local workerd does not reproduce isolate startup
and module initialisation. Real figures from `wrangler tail`:

| Route | p50 | max |
|---|---|---|
| `/` (SSR) | 237 ms | 295 ms |
| `POST /api/pastes` | 110 ms | 147 ms |
| `/p/:id` (SSR) | 13 ms | 163 ms |
| `GET /api/pastes/:id` | 10 ms | 109 ms |
| `/api/health` | 8 ms | 8 ms |
| cron sweep | 10 ms | 10 ms |

Warm requests land at 8–13 ms; the large numbers are cold starts. **Every request returned
`outcome: "ok"`** — nothing was terminated for exceeding CPU, including a 295 ms one — so the free
plan accommodates this in practice. Do not restate a specific free-tier CPU ceiling from memory;
Cloudflare has changed it, and `wrangler tail` is the way to know.

Also found: with no icon file, every `/favicon.ico` request reached the worker and rendered a
Next.js 404 at **285 ms of CPU** — the most expensive request measured. The icons live in `public/`,
not as `app/icon.svg`: that Next.js convention serves through a route handler at `/icon.svg?<hash>`,
which still costs a worker invocation. From `public/` they are static assets — verified with
`wrangler tail`, 10 icon requests producing zero worker invocations.

Verified in production: `backend: r2` (not the filesystem fallback), noindex and `no-referrer`
headers, empty viewer SSR HTML, opaque `ZP01` envelopes in R2, and a real cron tick logging
`swept 3 expired paste(s)` with no reads involved — the last point matters because a 404 after a read
would only have proved the lazy-delete layer.

### Phase 3 — Hardening and operations

- [ ] In-process purge timer via `instrumentation.ts`, plus the `CRON_SECRET`-guarded route as an
      alternative, with `VACUUM` on both providers
- [ ] Secure-context startup check with a clear blocking message
- [ ] IP rate limiting, separate budgets for create and read
- [ ] Playwright e2e asserting plaintext keywords appear in neither API responses nor the database
- [ ] `THREAT-MODEL.md`: documents what is *not* defended — a malicious server serving poisoned
      JS (the inherent weakness of all browser-based encryption), anyone holding the link, and
      browser history
- [ ] Accessibility (keyboard navigation, screen readers) and mobile layout
- [ ] Dockerfile standalone build, `docker/healthcheck.js`, `/api/health`, `AGENT-DEPLOY.md` with a
      Caddy TLS example
- [ ] Optional: WASM formatters for Python / Go / Rust
- [ ] Optional: drag-and-drop file upload; custom slugs (weakens unguessability, needs a warning)
