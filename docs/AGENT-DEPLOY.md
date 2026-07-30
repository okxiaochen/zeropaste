# ZeroPaste — Deployment Runbook for an AI Agent

**Audience: an AI coding agent with shell access on the machine that will host ZeroPaste.**
A human operator has pointed you at this file and asked you to deploy. Follow it top to bottom.
Do not improvise beyond it. Where it says ASK, stop and ask the human.

---

## 0. Non-negotiable rules

Read these before running anything.

1. **HTTPS is mandatory unless the only access is via `localhost`.** ZeroPaste encrypts in the
   browser using WebCrypto (`crypto.subtle`), which browsers expose **only in a secure context**.
   Over plain `http://` on any hostname other than `localhost` / `127.0.0.1`, `crypto.subtle` is
   `undefined` and the app cannot encrypt or decrypt anything. There is no workaround and no
   degraded mode. If the human wants public access and has no TLS termination, resolve that first
   (§5).
2. **Never invent or guess a `DATABASE_URL`.** ASK the human. A wrong URL silently creates an
   empty database, and users will lose pastes.
3. **Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` on a deployment.**
   Only `prisma migrate deploy`. The others can drop tables.
4. **Do not offer to recover a paste, reset a paste password, or read paste content.** It is
   cryptographically impossible; the server holds only ciphertext. If the human asks you to read
   user content, tell them the design forbids it. This is the product's entire point, not a bug.
5. **`SESSION_SECRET`-style values must be generated, never copied from this document or from any
   example file.** Generate with `openssl rand -base64 32`.
6. **Do not commit `.env`.** It is already in `.gitignore`. Verify before any `git add`.

---

## 1. Collect these five facts from the human

Do not proceed until you have all five. ASK for anything missing.

| # | Question | Notes |
|---|---|---|
| 1 | Database: **SQLite** or **PostgreSQL**? | SQLite is correct for a single container and up to a few hundred pastes/day. Recommend it unless they already run Postgres or expect high concurrency. |
| 2 | If PostgreSQL: the full `DATABASE_URL`, and has the database been created? | You may need to create the database; see §3b. |
| 3 | The public URL the site will be served at, e.g. `https://paste.example.com` | Used for `NEXT_PUBLIC_BASE_URL`. If localhost-only, `http://localhost:3000`. |
| 4 | Is TLS already terminated in front of this host? By what — nginx, Caddy, Traefik, Cloudflare Tunnel, Tailscale? | Determines §5. |
| 5 | Which host port should the container bind? Default `3000`. | Must not collide with anything already listening. |

---

## 2. Verify the host

```bash
docker --version          # need Docker 20.10+ with `docker compose` v2
docker compose version
git --version
```

If `docker compose` prints "is not a docker command", the host has the legacy standalone
`docker-compose`. Ask the human to upgrade rather than substituting the v1 binary — the Compose
file uses v2 syntax.

Confirm the chosen port is free:

```bash
# Replace 3000 with the chosen port.
ss -ltnp 2>/dev/null | grep -w 3000 || lsof -iTCP:3000 -sTCP:LISTEN 2>/dev/null || echo "port free"
```

Get the source:

```bash
git clone <repository-url> zeropaste
cd zeropaste
```

---

## 3. Write `.env`

Start from the template, then edit. Never leave a placeholder in place.

```bash
cp .env.example .env
```

### 3a. SQLite

```dotenv
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:/data/zeropaste.db
NEXT_PUBLIC_BASE_URL=https://paste.example.com
CRON_SECRET=<output of: openssl rand -base64 32>
```

`/data` is a path **inside the container**, backed by the `zeropaste-data` named volume declared
in `docker-compose.yml`. Do not change it to a host path unless the human asks; if they do, bind
mount it and ensure the directory is writable by UID 1001 (the container's `node` user).

**Always use an absolute path here.** Prisma resolves a relative SQLite path against the directory
holding the schema file, not the working directory, so `file:./zeropaste.db` would put the database
under `prisma/sqlite/` inside the image — on the container filesystem, not the volume — and every
paste would be lost on the next restart. There would be no error to warn you.

### 3b. PostgreSQL

The database is **not** managed by this Compose file. It must already exist and be reachable.

```dotenv
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://zeropaste:<password>@host.docker.internal:5432/zeropaste?schema=public
NEXT_PUBLIC_BASE_URL=https://paste.example.com
CRON_SECRET=<output of: openssl rand -base64 32>
```

Host resolution, in order of preference:

- Postgres on **this same host, outside Docker** -> use `host.docker.internal`. The Compose file
  already maps it via `extra_hosts: host-gateway`, so this works on Linux as well as Docker
  Desktop.
- Postgres in **another Docker container on a shared network** -> use that container's service
  name and add the external network to `docker-compose.yml`.
- **Managed Postgres** (RDS, Neon, Supabase) -> use the provided hostname and append
  `?sslmode=require` (Neon also needs `?sslmode=require`).

If the database or role does not exist yet, create it — ASK before running this, and never reuse
an existing database that holds other data:

```bash
psql "postgresql://<admin>@<host>:5432/postgres" -c "CREATE ROLE zeropaste LOGIN PASSWORD '<password>';"
psql "postgresql://<admin>@<host>:5432/postgres" -c "CREATE DATABASE zeropaste OWNER zeropaste;"
```

Verify connectivity **from inside a container**, not from the host — they resolve names
differently:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway postgres:16-alpine \
  psql "$DATABASE_URL" -c "select 1"
```

### 3c. Optional settings

Leave these at their defaults unless the human asks otherwise.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Host port published by Compose. |
| `MAX_PLAINTEXT_BYTES` | `10485760` | 10MB. `0` disables the limit. See the warning in §7. |
| `HIGHLIGHT_LIMIT_BYTES` | `2097152` | Above this the viewer skips highlighting to stay responsive. |
| `PURGE_IN_PROCESS` | `true` | Runs the expiry purge inside the app container. |
| `PURGE_INTERVAL_MINUTES` | `15` | Purge frequency. |
| `ENABLE_HSTS` | `false` | Set `true` only once HTTPS works, and only if TLS is terminated for this domain permanently. HSTS is hard to undo. |
| `RATE_LIMIT_CREATE_PER_MINUTE` | `20` | Per IP. |
| `RATE_LIMIT_READ_PER_MINUTE` | `120` | Per IP. Protects against link enumeration. |

---

## 4. Build and start

```bash
docker compose build
docker compose up -d
docker compose logs -f app
```

The entrypoint runs `prisma migrate deploy` against the schema matching `DATABASE_PROVIDER`, then
starts the Next.js server. Expected log sequence:

```
zeropaste: provider=sqlite
zeropaste: applying migrations
... N migrations found / applied
zeropaste: starting server
  ▲ Next.js 15.x
  - Local: http://localhost:3000
```

Stop tailing once you see `starting server`. If migrations fail, go to §8 — **do not** retry with
a different migrate subcommand.

---

## 5. TLS

Skip only if access is strictly `http://localhost`.

The container speaks plain HTTP on its port by design. Terminate TLS in front of it.

If the human already runs a reverse proxy, add a vhost pointing at `127.0.0.1:<PORT>` and make
sure it forwards `X-Forwarded-For` (rate limiting depends on it) and does **not** cap request
bodies below `MAX_PLAINTEXT_BYTES` (nginx defaults to 1MB — set `client_max_body_size`).

If they have nothing, Caddy is the shortest path. `Caddyfile`:

```caddyfile
paste.example.com {
	reverse_proxy 127.0.0.1:3000
	header {
		# The app sets its own security headers; do not override them here.
		-Server
	}
}
```

```bash
caddy validate --config Caddyfile
sudo caddy start --config Caddyfile
```

Caddy provisions a Let's Encrypt certificate automatically, which requires ports 80 and 443 open
and the DNS A/AAAA record already pointing here. Verify DNS **before** starting Caddy:

```bash
dig +short paste.example.com
```

---

## 6. Verify the deployment

Run all six. Report each result to the human.

```bash
# 1. Health endpoint reports the provider and a reachable database.
curl -fsS http://127.0.0.1:3000/api/health; echo

# 2. Security headers are present. Expect X-Robots-Tag with noindex,
#    and Referrer-Policy: no-referrer.
curl -sSI http://127.0.0.1:3000/p/test | grep -iE 'x-robots-tag|referrer-policy'

# 3. robots.txt disallows /p/.
curl -fsS http://127.0.0.1:3000/robots.txt; echo

# 4. An unknown id returns 404, not 500.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/pastes/aaaaaaaaaaaaaaaaaaaaaa

# 5. The viewer's server-rendered HTML contains no paste content.
#    This must print nothing.
curl -fsS http://127.0.0.1:3000/p/test | grep -i 'ciphertext' || echo "OK: no content in SSR HTML"

# 6. Purge is scheduled.
docker compose logs app | grep -i purge
```

Then a manual end-to-end check **in a browser** — this cannot be done with `curl`, because
encryption happens in browser JavaScript:

1. Open the public URL. Confirm no "insecure context" banner appears. If it does, TLS is not
   working — return to §5.
2. Paste some text, set an expiry, create the link.
3. Open the link in a private window. Confirm the content renders.
4. Delete everything from `#` onward in the URL and reload. It must **fail to decrypt** — this
   proves the key is not on the server.
5. Confirm the server never saw the plaintext:

```bash
# SQLite
docker compose exec app sh -c 'sqlite3 /data/zeropaste.db "select hex(ciphertext) from Paste limit 1"' | head -c 200
# Postgres
psql "$DATABASE_URL" -c 'select id, length(ciphertext), "expiresAt" from "Paste" limit 5'
```

The content column must be unreadable bytes. Grepping it for a word you pasted must find nothing.

---

## 7. Report back to the human

State plainly:

- The provider and where the data lives (volume name or Postgres host/database).
- The public URL, and whether TLS is active.
- The result of each check in §6, including any that failed.
- **The backup situation.** Nobody set this up for them. SQLite: back up the `zeropaste-data`
  volume. Postgres: their existing backup covers it. Warn them that a backup contains only
  ciphertext — it cannot be used to recover content whose links were lost.
- If `MAX_PLAINTEXT_BYTES=0` was requested: warn that a single very large paste can exhaust
  container memory and that Postgres `bytea` / SQLite `BLOB` still cap a row at 1GB regardless.

---

## 8. Failure modes

Match on the error text. Do not guess past this table — ASK.

| Symptom / error | Cause | Fix |
|---|---|---|
| Browser console: `Cannot read properties of undefined (reading 'encrypt')`, or the app shows an insecure-context banner | Served over `http://` on a non-localhost host | Terminate TLS, §5. Not fixable in app config. |
| `Can't reach database server at host.docker.internal:5432` | Postgres not listening on the host interface, or firewalled | Set `listen_addresses = '*'` in `postgresql.conf`, add a `pg_hba.conf` line for the Docker subnet, restart Postgres. |
| `getaddrinfo ENOTFOUND host.docker.internal` | `extra_hosts` missing (edited Compose file) | Restore `extra_hosts: ["host.docker.internal:host-gateway"]`. |
| `Authentication failed against database server` | Wrong password in `DATABASE_URL`, or special characters unescaped | Percent-encode the password: `@` -> `%40`, `:` -> `%3A`, `/` -> `%2F`. |
| `The table 'main.Paste' does not exist` | Migrations did not run | `docker compose exec app sh docker/entrypoint.sh --migrate-only`. Never `migrate reset`. |
| `SQLITE_BUSY: database is locked` | WAL not enabled, or the volume is on a network filesystem | Confirm the volume is local disk, not NFS/SMB. SQLite over a network mount is unsupported; switch to Postgres. |
| `EACCES: permission denied, open '/data/zeropaste.db'` | Bind-mounted host dir not writable by UID 1001 | `sudo chown -R 1001:1001 <host-dir>`, or use the named volume instead. |
| `413 Request Entity Too Large` | Reverse proxy body cap below `MAX_PLAINTEXT_BYTES` | nginx: `client_max_body_size 20m;`. Caddy has no default cap. |
| Container restart loop, logs show `Environment validation failed` | A required env var is missing or malformed | The message names the variable. Fix `.env`, then `docker compose up -d --force-recreate`. |
| Migrations apply, then every request fails with `Prisma Client could not locate the Query Engine for runtime linux-musl-...` | The generated clients were not copied into the runtime image | A modified Dockerfile is missing `COPY --from=builder /app/src/generated ./src/generated`. Next.js `output: standalone` traces JavaScript but not the native engine binary. |
| Startup fails with `Cannot find module '@prisma/engines'` | The Prisma CLI was copied out of pnpm's `node_modules` | pnpm's tree is symlinks into `.pnpm/`. Restore the `npm install prisma@...` step under `/opt/prisma` in the Dockerfile. |
| SQLite logs `Execute returned results, which is not allowed in SQLite` | A `PRAGMA` was issued through `$executeRawUnsafe` | Assignment-form PRAGMAs echo a row; they must go through `$queryRawUnsafe`. See `src/lib/db.ts`. |
| `The table 'main.Paste' does not exist` even though migrations reported success, **or** pastes disappear after every restart | A relative SQLite path in `DATABASE_URL` | Prisma resolves it against the schema directory, not the working directory, so the running app and the migration can use two different files. Use an absolute path such as `file:/data/zeropaste.db`. |
| Pastes never disappear after expiry | `PURGE_IN_PROCESS=false` with no external scheduler | Either set it back to `true`, or add a host cron calling `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/purge`. |
| A paste's link works but shows "decryption failed" | Wrong password, or a truncated URL fragment (chat apps and email clients often break long URLs) | Ask for the full link. Unrecoverable if the fragment is genuinely lost. |

---

## 9. Upgrading

```bash
cd zeropaste
git pull
docker compose build
docker compose up -d
```

Migrations apply automatically on start. Before upgrading a Postgres deployment, take a dump:

```bash
pg_dump "$DATABASE_URL" > zeropaste-$(date +%F).sql
```

For SQLite, copy the volume:

```bash
docker run --rm -v zeropaste_zeropaste-data:/data -v "$PWD:/backup" alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/zeropaste.db ".backup /backup/zeropaste-backup.db"'
```

Use `.backup`, not `cp` — copying a live WAL-mode database can produce a corrupt file.
