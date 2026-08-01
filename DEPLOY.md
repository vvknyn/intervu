# Deployment Guide

Intervu ([intervu.cc](https://intervu.cc)) is a Next.js 16 app.
Repo: [github.com/vvknyn/intervu](https://github.com/vvknyn/intervu).

**Preferred production host:** Contabo (same box as pipelines), not Vercel.
The FE is lightweight; Meilisearch sync / scrape / discover already run off-Vercel.

## Contabo (Caddy + Docker) — recommended

Shared dual-site stack (intervu.cc **and** thesubspace.io) lives in the subspace
repo: `deploy/contabo-web/`. Use that on Contabo after the box has Docker.

Solo intervu-only (this repo):

```bash
# On Contabo
git clone https://github.com/vvknyn/intervu.git /opt/intervu
cd /opt/intervu
cp /path/to/.env.production .   # Vercel/env export; include NEXT_PUBLIC_*
docker compose up -d --build
# DNS: intervu.cc + www → Contabo A/AAAA
```

Or: `./scripts/deploy-contabo.sh`

## Branch flow

```
feature → staging → main
```

Never commit directly on `main` or `staging`.

## Legacy: Vercel

Still works via `npm run promote` / `npx vercel --prod` until DNS cuts over.
After Contabo is live, point DNS at Contabo and leave Vercel as rollback only.

## Environment variables

Same set as before (Firebase, OpenRouter, Groq, encryption, Meilisearch read key,
Subspace API). Put them in `.env.production` on Contabo — **not** in git.

`NEXT_PUBLIC_*` are required at **docker build** time (inlined into the client
bundle). Server secrets are runtime-only via `env_file`.

## Jobs sync worker

Still off-FE (Contabo cron / always-on). The app only reads Meilisearch with the
search key.

## CI

`.github/workflows/ci.yml` — lint, typecheck, build. Keep green before promoting.
