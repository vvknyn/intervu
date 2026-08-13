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
RUN --mount=type=secret,id=env,target=/run/build.env \
    sh scripts/lint-env.sh /run/build.env
RUN --mount=type=secret,id=env,target=/run/build.env \
    set -a && . /run/build.env && set +a && npm run build

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
