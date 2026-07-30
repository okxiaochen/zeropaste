# ZeroPaste — Deployment Runbook for an AI Agent

**Audience: an AI coding agent with shell access on the machine that will deploy ZeroPaste.**
A human operator has pointed you at this file and asked you to deploy. Follow it top to bottom.
Do not improvise beyond it. Where it says ASK, stop and ask the human.

There are two supported deployments:

- **§A Cloudflare Workers + R2** — the primary target. Serverless, free-tier friendly.
- **§B Docker, self-hosted** — strongest privacy posture; the operator's machine, the operator's logs.

Sections §0–§1 apply to both.

---

## 0. Non-negotiable rules

1. **HTTPS is mandatory unless the only access is via `localhost`.** ZeroPaste encrypts in the
   browser using WebCrypto (`crypto.subtle`), which browsers expose **only in a secure context**.
   Over plain `http://` on any hostname other than `localhost` / `127.0.0.1`, `crypto.subtle` is
   `undefined` and the app cannot encrypt or decrypt anything. There is no workaround. Cloudflare
   terminates TLS for you; for Docker, see §B4.
2. **Do not offer to recover a paste, reset a paste password, or read paste content.** It is
   cryptographically impossible; servers hold only ciphertext, and the decryption key travels in the
   URL fragment, which browsers never transmit. If the human asks you to read user content, tell
   them the design forbids it. This is the product's entire point, not a bug.
3. **Never enable R2 bucket versioning, and never point this app at D1.** Both keep recoverable
   copies of deleted data. D1's Time Travel retains a restorable database history that cannot be
   switched off, which is why this project stores pastes in R2 in the first place. Versioning would
   reintroduce the same hazard by hand.
4. **Never enable Workers observability or logpush for this worker.** Request logs contain paste
   ids; combined with timestamps and IPs they reconstruct who read what, when. `wrangler.jsonc`
   ships with observability off. Leave it off.
5. **Secrets must be generated, never copied from examples.** Use `openssl rand -base64 32`.
6. **Do not commit `.env`.** It is in `.gitignore`. Verify before any `git add`.

## 1. What either deployment discloses — tell the human this

Content is encrypted client-side; no deployment can read it. What differs is metadata:

| | Cloudflare (§A) | Docker (§B) |
|---|---|---|
| Paste content | Unreadable (E2E encrypted) | Unreadable (E2E encrypted) |
| Who fetched which paste, when | Visible to Cloudflare's edge | Only in logs the operator controls (app logs none) |
| Deleted data remnants | R2 delete is final; no VACUUM equivalent needed | File bytes overwritten before unlink |
| Who serves the crypto JS | Cloudflare | The operator |

If the human's requirement is "no third party sees access patterns", §A is the wrong choice —
recommend §B and stop.

---

# §A — Cloudflare Workers + R2

## A1. Collect from the human

| # | Question |
|---|---|
| 1 | Which Cloudflare account? (`wrangler whoami` / `cf accounts list`) |
| 2 | Custom domain, or the free `*.workers.dev` subdomain? |
| 3 | Is the Workers plan Free or Paid? Affects §A6 checks. |

## A2. Preconditions

```bash
node -v                     # 22+
corepack pnpm install
pnpm wrangler whoami        # must show the right account; else: pnpm wrangler login
```

## A3. Create the bucket

```bash
pnpm wrangler r2 bucket create zeropaste
```

The name must match `r2_buckets[0].bucket_name` in `wrangler.jsonc`. **Do not enable versioning**
(rule 3). Nothing else to configure yet; lifecycle rules come after the first deploy (§A5).

## A4. Deploy

```bash
pnpm cf:deploy              # runs opennextjs-cloudflare build, then wrangler deploy
```

Expected output includes `Total Upload: ... gzip: ~2.7 MiB` and the bindings table showing
`env.PASTES (zeropaste)` and the cron trigger `*/15 * * * *`. On the Free plan the compressed limit
is 3 MiB; if the upload is rejected for size, stop and report — do not start deleting code to make
it fit.

For a custom domain: `wrangler.jsonc` → add a `routes` entry, or attach the domain in the dashboard
(Workers & Pages → zeropaste → Settings → Domains & Routes).

## A5. Storage-layer expiry ceiling (lifecycle rules)

Pastes are keyed `pastes/<class>/<id>` so R2 lifecycle rules can enforce deletion even if the app's
sweep never runs. Create one rule per prefix, ages from `EXPIRY_OPTIONS` in `src/lib/expiry.ts`:

```bash
for rule in "10m 1" "1h 1" "1d 2" "1w 8" "1mo 31" "3mo 91"; do
  set -- $rule
  pnpm wrangler r2 bucket lifecycle add zeropaste \
    --name "expire-$1" --prefix "pastes/$1/" --expire-days "$2"
done
pnpm wrangler r2 bucket lifecycle list zeropaste   # verify all six
```

These are a **ceiling**, not the primary mechanism — lazy delete on read and the 15-minute cron
sweep enforce the exact expiry. The ceiling exists so a broken sweep cannot mean immortal data.

## A6. Rate limiting (WAF)

The in-app limiter counts per isolate and Workers runs many isolates, so it barely limits anything
there. The real limiter is a WAF rule at the edge. The Free plan includes one rate limiting rule;
spend it on paste creation:

Dashboard → the zone (or workers.dev is not eligible — custom domain required for WAF) → Security →
WAF → Rate limiting rules:

- Expression: `(http.request.uri.path eq "/api/pastes" and http.request.method eq "POST")`
- Rate: 20 requests / 1 minute per IP → Block for 1 minute

If the site runs on `*.workers.dev` (no zone), WAF is unavailable; note that to the human as a known
gap and rely on the generous in-app limits in `wrangler.jsonc` until a domain is attached.

## A7. Verify

```bash
BASE=https://<the-deployed-host>

# 1. Health names the backend — must be "r2", NOT "filesystem" (which on Workers means the R2
#    binding failed to resolve and writes are going to an ephemeral virtual disk).
curl -fsS $BASE/api/health          # {"status":"ok","backend":"r2","storage":"reachable"}

# 2. Headers.
curl -sSI $BASE/p/test | grep -iE 'x-robots-tag|referrer-policy'

# 3. The cron sweep is registered (deploy output listed the trigger). To watch one run:
pnpm wrangler tail --format pretty  # then wait for a */15 tick: "zeropaste: swept N ..."
#    Stop tailing afterwards; rule 4 is about persistent logs, and a live tail is fine for a check.
```

Then the browser checks: create a paste, open it in a private window, strip the `#fragment` and
confirm decryption fails, and confirm the R2 objects are opaque:

```bash
pnpm wrangler r2 object get zeropaste pastes/3mo/<id> --pipe | head -c 64 | xxd | head -4
# expect: "ZP01" then binary; grep for pasted words must find nothing
```

## A8. Cloudflare failure modes

| Symptom | Cause | Fix |
|---|---|---|
| health says `"backend":"filesystem"` on Workers | R2 binding missing or renamed | `r2_buckets` in `wrangler.jsonc` must bind `PASTES` to an existing bucket; redeploy. Reads/writes meanwhile went to an isolate-local virtual fs and are lost. |
| `Error: ... exceeded the upload limit` on deploy | Worker bundle over the plan's compressed cap | Report the size to the human; options are Workers Paid or trimming server-side dependencies. Never move crypto out of the client to save bytes. |
| Cron never logs `swept` | `scheduled` handler missing — someone pointed `main` back at OpenNext's worker | `wrangler.jsonc` `main` must be `src/worker.ts`, which wraps OpenNext and adds `scheduled`. This failure is silent: reads still lazy-delete, so nothing looks wrong. |
| Pastes recoverable after delete | Bucket versioning was enabled | Disable versioning; existing noncurrent versions must be removed with a lifecycle rule on noncurrent versions. Tell the human the retention window that existed. |
| `getCloudflareContext` errors in cron logs | Someone made the sweep resolve the store from request context | The `scheduled` event has no request context; the store must be built from the event's `env` — see `src/worker.ts`. |

---

# §B — Docker, self-hosted

## B1. Collect from the human

The public URL, the host port (default 3000), and how TLS will be terminated (existing proxy /
Caddy / Tunnel). That is all — there is no database to provision.

## B2. Configure and start

```bash
git clone <repository-url> zeropaste && cd zeropaste
cp .env.example .env        # defaults are fine; set CRON_SECRET if the purge route will be used
docker compose up -d --build
docker compose logs -f app  # expect: "filesystem store at /data/pastes", "purge scheduled every 15 minute(s)"
```

Pastes are single files on the `zeropaste-data` volume, one per paste, encrypted envelopes with no
database. Deletion overwrites the bytes before unlinking. Two things follow:

- The volume should be **local disk**, not NFS/SMB — an overwrite over a network mount says nothing
  about physical storage.
- Backups of the volume contain ciphertext only, and restoring a backup resurrects pastes deleted
  since the backup was taken. If the human wants scheduled backups, warn them about that trade-off.

## B3. Verify

```bash
curl -fsS http://127.0.0.1:3000/api/health   # {"status":"ok","backend":"filesystem","storage":"reachable"}
curl -sSI http://127.0.0.1:3000/p/test | grep -iE 'x-robots-tag|referrer-policy'
# after creating a paste in a browser:
docker compose exec app sh -c 'find /data/pastes -type f | head -3'
docker compose exec app sh -c 'head -c 4 "$(find /data/pastes -type f | head -1)"'   # "ZP01"
```

Plus the browser checks from §A7 (create, open, strip fragment, confirm failure).

## B4. TLS

The container speaks plain HTTP. Terminate TLS in front (rule 1). Minimal Caddy:

```caddyfile
paste.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Ensure the proxy forwards `X-Forwarded-For` (the in-app rate limiter keys on it) and does not cap
request bodies below `MAX_PLAINTEXT_BYTES` (nginx defaults to 1MB: set `client_max_body_size`).

## B5. Docker failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Browser: `Cannot read properties of undefined (reading 'encrypt')` or a secure-context banner | Served over plain HTTP on a non-localhost host | Terminate TLS (§B4). Not fixable in app config. |
| `EACCES ... /data/pastes` | Bind-mounted host dir not writable by UID 1001 | `chown -R 1001:1001 <dir>`, or use the named volume. |
| Pastes vanish on restart | No volume mounted at `/data` | The compose file mounts `zeropaste-data`; a hand-rolled `docker run` must include `-v`. |
| `413 Request Entity Too Large` | Proxy body cap below `MAX_PLAINTEXT_BYTES` | nginx: `client_max_body_size 20m;`. Caddy has no default cap. |
| Pastes never disappear after expiry | `PURGE_IN_PROCESS=false` with no external scheduler | Set it back to `true`, or cron `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/purge`. Reads still lazy-delete either way. |
| A link works but shows "decryption failed" | Wrong password, or a chat client truncated the URL at `#` | Ask for the full link. Unrecoverable if the fragment is lost. |

## B6. Upgrading

```bash
git pull && docker compose up -d --build
```

No migrations exist. The envelope format is versioned (`ZP01`); a future format change will read old
envelopes rather than requiring a data migration.
