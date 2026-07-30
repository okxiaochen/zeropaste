# Cloudflare Workers — Spike Findings

**This branch is a measurement, not an implementation.** It exists to answer two questions before
committing to a Cloudflare port: does the worker bundle fit the free plan, and does one request fit
the free plan's CPU ceiling. The data access layer is stubbed with an in-memory `Map`; do not merge.

Measured on `@opennextjs/cloudflare` 1.20.2, `wrangler` 4.115.0, `workerd` 1.20260722.1,
Next.js 15.5.22.

---

## Verdict

It runs, and it fits — with less headroom than is comfortable, and with three pieces of the current
design that have to be rebuilt rather than ported.

| Question | Answer |
|---|---|
| Does it build for Workers? | Yes, unmodified apart from the stubbed store |
| Does it run on workerd? | Yes — the full Playwright suite passes, 24/24 |
| Worker bundle vs the 3 MiB free limit | **2.65 MiB gzipped. Fits, with ~13% headroom** |
| Request CPU vs the free plan's ceiling | Warm requests are 2–5 ms wall-clock; comfortable, but see the caveat |
| Does the free plan suffice? | Probably, and the bundle is the binding constraint, not storage |

---

## 1. Bundle size — the real constraint

```
Total Upload: 13016.19 KiB / gzip: 2718.40 KiB
```

2.65 MiB against the Workers Free limit of 3 MiB compressed. It fits, but:

- This is **with the database layer stubbed out**. A D1 implementation via Drizzle adds roughly 50 KB,
  which is affordable.
- The Prisma D1 adapter is **not** affordable. Its WASM query engine is over 1 MB and would exceed
  the limit outright. If the Cloudflare target is wanted, migrating off Prisma is not a preference,
  it is a requirement on the free plan.
- 13% headroom means an ordinary dependency addition could push it over. That is a maintenance
  liability, not a one-time check.

The client bundles — CodeMirror, Prettier, Shiki, ~13 MB uncompressed across 136 files — are served
as Workers Static Assets. They do **not** count toward the worker limit, and static asset requests do
not count against the Workers request quota. The large client-side dependencies are genuinely free.

## 2. CPU time

Warm request latency on local workerd, 25 samples each, including loopback HTTP overhead:

| Route | p50 | p90 | max |
|---|---|---|---|
| `GET /api/health` | 2.30 ms | 2.64 ms | 3.88 ms |
| `GET /` (SSR) | 4.07 ms | 4.73 ms | 5.23 ms |
| `GET /p/:id` (SSR) | 3.47 ms | 4.18 ms | 15.66 ms |
| `POST /api/pastes` | 2.15 ms | 2.86 ms | 4.22 ms |

These are compute-bound with no I/O — the stub store is in memory — so wall-clock is a reasonable
upper bound on CPU. The architecture helps here: the expensive work is all client-side. Argon2id at a
64 MiB memory cost runs in the visitor's browser, and the viewer's server render emits an empty shell
because the content is decrypted after mount.

**Caveat, stated plainly:** local workerd neither enforces nor reports CPU limits, so these are a
proxy, not the metric. The single 15.66 ms outlier is the kind of thing that matters if the ceiling is
10 ms. Confirming this requires deploying and reading the observability metrics, which was not done
because it would publish a public URL on the account.

## 3. Three things that must be rebuilt, not ported

### Prisma cannot run on Workers at all

Its client requires a native query engine binary. This is why the store is stubbed on this branch.
Options, in order of preference:

1. **Drizzle + D1.** Negligible bundle cost, and one schema definition covers D1, SQLite, and
   Postgres — which would let the two-schema, two-client Prisma arrangement on `main` be deleted
   entirely, along with the two Prisma-specific failure modes documented in `AGENT-DEPLOY.md` §8.
2. **Prisma D1 adapter.** Keeps the ORM, but the WASM engine breaks the free plan's bundle limit.
3. **Hyperdrive to an external Postgres.** Keeps `VACUUM` (see below) at the cost of paying for a
   Postgres somewhere, which undercuts the reason to be on Workers.

### The purge timer has nothing to run in

`src/instrumentation.ts` schedules purging with `setInterval`, which needs a long-running process.
Workers has none. The replacement is a Cron Trigger, already declared in `wrangler.jsonc`.

**But the generated worker only exports `fetch`:**

```
handlers referenced near default export: fetch(
```

A Cron Trigger fires a `scheduled` handler, so as configured the cron would fire into nothing and
expired pastes would only ever be removed by the lazy delete on read. Making this work needs a custom
worker entry that wraps OpenNext's and adds `scheduled`, either calling `purgeExpired` directly or
fetching the existing `/api/cron/purge` route.

This one is easy to get wrong silently — nothing errors, pastes simply stop expiring on schedule.

### In-memory rate limiting stops working

`src/lib/ratelimit.ts` counts requests in a per-process `Map`. Workers runs many short-lived isolates,
so a limit of 20/minute becomes 20 per isolate per minute — effectively no limit.

Incidentally, this is what caused the only two failures in the first workerd test run: the e2e suite
creates pastes in a burst and tripped the limiter, which local dev enforces within its single isolate.
Raising the limit for the spike produced 24/24. Worth noting that the limiter *does* work correctly —
it is the deployment topology that defeats it.

The right replacement on Cloudflare is a WAF Rate Limiting rule, which runs at the edge, requires no
application code, and is included on the free plan (one rule, which is exactly enough for
`POST /api/pastes`).

## 4. The guarantee that gets weaker

D1 does not permit `VACUUM`. On the self-hosted path, expiry is `DELETE` followed by `VACUUM`, so the
ciphertext bytes are actually reclaimed; `src/lib/db.ts` documents this as what makes "the data is
removed from the database" literally true rather than nominally true.

On D1 the strongest available behaviour is `DELETE`. The row becomes unreachable, and the ciphertext
is undecryptable without the key regardless — but "deleted" means "no longer queryable", not
"overwritten". Anyone choosing Cloudflare should know that this is a deliberate downgrade of the
original requirement, not an oversight.

## 5. Trust surface

The zero-knowledge property survives: encryption happens in the browser, so Cloudflare never sees
plaintext. What changes is that Cloudflare now serves the JavaScript that performs the encryption, so
the "a malicious server could ship poisoned JS" caveat in the README extends from the operator to
Cloudflare. That is a real widening of the trust surface, and it is the price of not running the
server yourself.

## Reproducing

```bash
pnpm install
pnpm dlx opennextjs-cloudflare build          # needs pnpm on PATH; it shells out to it
wrangler deploy --dry-run --outdir=/tmp/wr    # prints the gzipped size
wrangler dev --port 8788
E2E_BASE_URL=http://127.0.0.1:8788 pnpm test:e2e
```

## Files on this branch

| File | Status |
|---|---|
| `open-next.config.ts`, `wrangler.jsonc` | New, spike-quality |
| `src/server/pastes.ts` | **Replaced with an in-memory stub** — the real one is on `main` |
| `src/app/api/health/route.ts` | **Stubbed** — no database to check |
