# syntax=docker/dockerfile:1

# The self-hosted image. Storage is the filesystem backend on a mounted volume, so there is no
# database, no ORM, no migrations, and no query engine to ship.

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
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV STORAGE_DIR=/data/pastes

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Next.js standalone output carries its own minimal node_modules, so the full tree is not copied.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs docker/healthcheck.js ./docker/

# Where pastes live. Mount a volume here or every paste disappears with the container.
RUN mkdir -p /data/pastes && chown -R nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD node docker/healthcheck.js

# No entrypoint script: there are no migrations to apply. The store creates its directories on demand.
CMD ["node", "server.js"]
