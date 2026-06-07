# Deployment Guide

Intervu ([intervu.cc](https://intervu.cc)) is a Next.js 16 app deployed on Vercel.
Repo: [github.com/vvknyn/intervu](https://github.com/vvknyn/intervu).

## Branch flow

```
feature → staging → main
```

Never commit directly on `main` or `staging`; never PR a feature branch straight to
`main`. Open a PR into `staging`, then promote `staging → main`.

> **Pushing to `main` does NOT auto-deploy production.** Vercel's Production Branch
> is **not** `main`, so a merge to `main` only triggers a (non-production) build. A
> separate promotion step is what ships to the live domain. Do not assume
> `git push origin main` puts code in front of users.

## Production deploy

Promotion to production is an explicit step, not a side effect of merging:

```bash
npm run promote   # merges staging → main and pushes (see scripts/promote-to-prod.sh)
```

After promoting, confirm the production deployment actually went out (Vercel
Dashboard → the project → Deployments) and then verify the live URL renders the
change — a green build is not proof the user-visible behavior changed.

## Manual deploy (CLI)

You can deploy from your terminal at any time with the Vercel CLI:

```bash
# Preview (a throwaway test URL):
npx vercel

# Production (the live site):
npx vercel --prod
```

## Environment variables

Set these in **Vercel → Project Settings → Environment Variables** (and locally in
`.env.local`, which is gitignored). See the README's *Getting Started* section for
the full list with explanations.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client | Public-by-design (inlined into the bundle) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client | |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Client | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Client | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Client | |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | **Secret** | Or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` |
| `OPENROUTER_API_KEY` | **Secret** | Shared, app-funded model |
| `GROQ_API_KEY` | **Secret** | Audio transcription |
| `ENCRYPTION_KEY` | **Secret** | AES key for BYOK keys at rest (`openssl rand -hex 32`) |
| `ADMIN_EMAILS` | **Secret** | Comma-separated; unlimited shared-key use |
| `MEILISEARCH_HOST` | Server | Jobs corpus host |
| `MEILISEARCH_SEARCH_KEY` | Server | Read-only key used at request time |
| `MEILISEARCH_ADMIN_KEY` / `MEILISEARCH_API_KEY` | Server | Used by the off-Vercel sync worker only |
| `SUBSPACE_API_BASE_URL` / `SUBSPACE_API_KEY` | Server | Jobs source API |

> Never inline real secrets in this repo, in CI YAML, or in client code. The CI
> workflow (`.github/workflows/ci.yml`) references `NEXT_PUBLIC_FIREBASE_*` via
> GitHub Actions secrets — add them under **Settings → Secrets and variables →
> Actions**.

## Jobs sync worker

The Meilisearch jobs index is populated by a long-running sync worker that runs
**off-Vercel** (a cron box / always-on host), not in a serverless function. The app
only reads the index at request time with the read-only `MEILISEARCH_SEARCH_KEY`;
ingestion uses the admin key from the worker host. See `src/lib/jobs/sync.ts`.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main` /
`staging`: `npm ci`, `npm run lint`, `npx tsc --noEmit`, then `npm run build`. Keep
it green before promoting.

## Troubleshooting

- **Build fails:** check the logs in your terminal or the Vercel dashboard, and make
  sure every required environment variable is set for the target environment.
- **App loads but auth/data is broken:** verify the Firebase Admin credentials
  (`FIREBASE_SERVICE_ACCOUNT_KEY` or the client-email/private-key pair) are set on
  the server, and that `firestore.rules` are deployed.
- **Find-jobs tab is empty:** the Meilisearch variables are missing or the sync
  worker hasn't populated the index.
