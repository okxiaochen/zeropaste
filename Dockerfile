# syntax=docker/dockerfile:1

# Both Prisma clients are generated in the build stage, so one image serves either provider and the
# operator switches with an environment variable rather than a rebuild.

FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

# ---- dependencies ------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build -------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm prisma:generate

# next build needs DATABASE_URL present for module-level validation, but never connects to it.
ENV DATABASE_PROVIDER=sqlite
ENV DATABASE_URL=file:/tmp/build.db
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Next.js standalone output already contains a minimal node_modules, so the full tree is not copied.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migration SQL, applied at start time by `prisma migrate deploy`.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# The generated Prisma clients, including their native query engine binaries.
#
# `output: standalone` traces JavaScript imports but does not carry the .node engine files along, so
# without this the container starts, applies migrations, and then fails every query with
# "Prisma Client could not locate the Query Engine for runtime linux-musl-arm64-openssl-3.0.x".
# The path matters: it is one of the locations Prisma searches. Both providers' clients are copied,
# which is what lets a single image serve either database.
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# The Prisma CLI, installed with npm into its own prefix rather than copied out of the builder.
#
# pnpm's node_modules is a symlink farm pointing into .pnpm/, so copying `node_modules/prisma` on its
# own yields a CLI whose `require('@prisma/engines')` resolves to a dangling link and fails at
# startup with MODULE_NOT_FOUND. npm produces a flat tree that survives being copied, and keeping it
# under /opt leaves the traced node_modules from `output: standalone` untouched.
ARG PRISMA_VERSION=6.19.3
RUN mkdir -p /opt/prisma \
 && cd /opt/prisma \
 && npm install --no-save --no-package-lock --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 && npm cache clean --force
ENV PRISMA_CLI=/opt/prisma/node_modules/prisma/build/index.js

COPY --chown=nextjs:nodejs docker/entrypoint.sh docker/healthcheck.js ./docker/
RUN chmod +x docker/entrypoint.sh

# The SQLite volume mounts here. Pre-create it so the directory is owned by the app user.
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

# Declared here as well as in docker-compose.yml so `docker run` reports health too.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD node docker/healthcheck.js

ENTRYPOINT ["sh", "docker/entrypoint.sh"]
