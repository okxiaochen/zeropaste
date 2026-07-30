#!/bin/sh
# Container entrypoint: apply migrations for the configured provider, then start the server.
#
# Pass --migrate-only to run migrations without starting the server. docs/AGENT-DEPLOY.md §8 refers
# to that flag as the recovery step for a database whose tables are missing.
set -eu

MIGRATE_ONLY=0
if [ "${1:-}" = "--migrate-only" ]; then
  MIGRATE_ONLY=1
fi

: "${DATABASE_PROVIDER:?DATABASE_PROVIDER must be set to sqlite or postgresql}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

case "$DATABASE_PROVIDER" in
  sqlite)     SCHEMA=prisma/sqlite/schema.prisma ;;
  postgresql) SCHEMA=prisma/postgres/schema.prisma ;;
  *)
    echo "zeropaste: DATABASE_PROVIDER must be sqlite or postgresql, got '$DATABASE_PROVIDER'" >&2
    exit 1
    ;;
esac

echo "zeropaste: provider=$DATABASE_PROVIDER"

if [ "$DATABASE_PROVIDER" = "sqlite" ]; then
  # Prisma will not create a missing parent directory for the database file.
  DB_PATH=$(printf '%s' "$DATABASE_URL" | sed 's|^file:||')
  case "$DB_PATH" in
    /*) mkdir -p "$(dirname "$DB_PATH")" ;;
  esac
fi

echo "zeropaste: applying migrations"
# Only ever `migrate deploy`. `migrate dev` and `db push` can drop tables, and a paste database has
# no recovery path — the operator cannot re-encrypt what they cannot read.
node "${PRISMA_CLI:-/opt/prisma/node_modules/prisma/build/index.js}" migrate deploy --schema="$SCHEMA"

if [ "$MIGRATE_ONLY" = "1" ]; then
  echo "zeropaste: migrations applied, exiting (--migrate-only)"
  exit 0
fi

echo "zeropaste: starting server"
exec node server.js
