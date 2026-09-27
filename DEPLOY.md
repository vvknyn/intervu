# Deployment Guide

Velai ([velai.app](https://velai.app)) is a Next.js app.
Repo: [github.com/vvknyn/intervu](https://github.com/vvknyn/intervu).

**Production host:** Contabo VPS `194.163.147.154` (shared with pipeline workloads).

## Contabo dual-site stack (production)

The live web stack is **not** this repo’s solo `docker-compose.yml`. It is the dual-site compose in the Subspace repo:

- Compose file: `/opt/interview-os/deploy/contabo-web/docker-compose.yml`
- App container: `contabo-web-intervu`
- Shared Caddy (terminates `:80` / `:443` for both sites): `contabo-web-caddy`

**Source tree on the box:** `/opt/intervu` — a plain directory with **no `.git`**. The private repo is not cloned on the box (no credentials there); `git clone` / `git pull` under `/opt/intervu` will fail by design.

**Environment:** canonical production env is `/opt/interview-os/deploy/contabo-web/intervu.env`, copied to `/opt/intervu/.env.production` before build. `NEXT_PUBLIC_WORKOS_REDIRECT_URI` must be `https://velai.app/auth/callback`.

### Deploy procedure (from a machine with repo access)

1. Check out the promoted **`main`** commit locally (see branch flow below).
2. Sync source to the box (example):

   ```bash
   git archive <sha> | ssh root@194.163.147.154 'tar -x -C /opt/intervu'
   ```

3. On the box, record the deployed revision:

   ```bash
   echo '<full-sha>' > /opt/intervu/.deployed-sha
   ```

4. On the box, run the quad deploy script (rebuild/recreate **only** `contabo-web-intervu` in the dual-site compose):

   ```bash
   /opt/deploy-intervu-quad.sh
   ```

### Verification

```bash
docker compose -f /opt/interview-os/deploy/contabo-web/docker-compose.yml ps
cat /opt/intervu/.deployed-sha
```

Then hit [https://velai.app/jobs](https://velai.app/jobs): signed-out Concept A landing renders; auth callback uses `velai.app` redirect URI. If `scripts/verify-contabo-ship.mjs` exists in your checkout, run it against production after deploy.

### WARNING — do not use solo deploy on this host

**Do not run** `./scripts/deploy-contabo.sh` (this repo’s solo compose) on the dual-site Contabo box. It starts a **second** Caddy binding `:80`/`:443` and will fight `contabo-web-caddy`. That script is for a **fresh single-site** box only (see below).

## Solo intervu-only box (fresh install)

For a new host with only Velai (no shared Subspace Caddy):

```bash
git clone https://github.com/vvknyn/intervu.git /opt/intervu
cd /opt/intervu
cp /path/to/.env.production .   # production env; include NEXT_PUBLIC_*
docker compose up -d --build
# DNS: velai.app → host A/AAAA
```

Or: `./scripts/deploy-contabo.sh` **on that solo box only**.

## Branch flow

```
feature → PR to staging → ./scripts/promote-to-prod.sh (on staging) → main → deploy main
```

Never commit directly on `main` or `staging`.

## Environment variables

Firebase, WorkOS, Meilisearch read key, Subspace API, encryption, etc. live in `.env.production` on the host — **not** in git.

`NEXT_PUBLIC_*` are required at **docker build** time (inlined into the client bundle). Server secrets are runtime-only via `env_file`.

## Jobs sync worker

Off-FE (Contabo cron / always-on). The app only reads Meilisearch with the search key.

## CI

`.github/workflows/ci.yml` — lint, typecheck, build. Keep green before promoting.
