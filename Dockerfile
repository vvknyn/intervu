# Next.js standalone — Contabo behind Caddy (no Vercel).
# Build with secret env (see docker-compose.yml) so NEXT_PUBLIC_* inline
# without baking .env into image layers.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN [ -f data/geo/dbip-country-lite.mmdb ] || node scripts/download-mmdb.mjs
# Docker deliberately excludes a build secret's CONTENTS from the layer cache
# key, so editing the env file alone leaves both steps below cached and the
# rebuild is a silent no-op: measured 2026-08-18, `docker compose build intervu`
# after adding two keys reported 13/13 steps CACHED, exit 0, "Image ... Built",
# and produced a byte-identical image with neither key inlined. ENV_DIGEST is a
# hash of that file, supplied by deploy.sh, and is referenced in each command
# purely so the cache key moves when the env does.
ARG ENV_DIGEST=unset
RUN --mount=type=secret,id=env,target=/run/build.env \
    : "env-digest ${ENV_DIGEST}" && sh scripts/lint-env.sh /run/build.env
RUN --mount=type=secret,id=env,target=/run/build.env \
    : "env-digest ${ENV_DIGEST}" && set -a && . /run/build.env && set +a && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Runtime geo data: the mmdb is read from disk via process.cwd() (see
# src/lib/geo/ip-country.ts), so the standalone trace can't discover it.
COPY --from=builder --chown=nextjs:nodejs /app/data/geo ./data/geo

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
