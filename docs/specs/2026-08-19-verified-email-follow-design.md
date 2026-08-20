# Verified email follow ("watch a company") — design

**Date:** 2026-08-19 · **Status:** Approved by Vivek (brainstorm session) · **Branch:** `feat/email-follow`

## Decision

Company pages are the SEO front door ("Is {name} hiring?") and they answer the
query so completely that bouncing is rational: nothing on the page converts the
visit into a return path. The one intent-matched commitment device — PR #249's
"Email me when they post" — dead-ends into the full account dialog, whose
username+password path mints synthetic `@intervu.cc` addresses the send layer
itself refuses.

This design finishes that ladder: **"Email me when they post" becomes a
one-field verified-email step.** No password, no username, no account. The
identity lives in **Supabase Postgres**, shaped as the first bricks of
the Firebase exit (Vivek, 2026-08-19: auth should become email+Google,
served by Supabase Auth).

Locked constraints carried in:
- **Success metric: durable contact** — a verified, deliverable email counts;
  an account can come second.
- **Facts only** (2026-08-05 thesis unchanged): emails report events we
  detect — posted, closed, went stale — never conclusions.
- **Cadence: only on activity.** The promise is "when they post"; no activity,
  no email.
- **Contact cookie: included** — the browser remembers the verified identity
  so the second follow is one click. It is NOT an auth session (see Guards).
- No new paid integrations. Resend, Turnstile, Firebase all as-is.

## Ground truth (audited 2026-08-19; origin/main = `7432f9c`, live site point-in-time)

- **#249 is LIVE in prod**: both copy strings ("Watching ${c}. Get a weekly
  note when they post." / "Email me when they post") found verbatim in served
  chunk `/_next/static/chunks/0ogqabhmbm4tt.js`. The CTA currently opens the
  account dialog (`src/components/companies/CompanyFollowControl.tsx`,
  `login-form.tsx` via PR #249).
- Guest follows live in localStorage (`FollowButton.tsx:52-60` pattern per
  pre-#249 audit; #249 added merge-on-login). Server-side follows:
  `users/{uid}/followedCompanies/{domain}` (`src/lib/follows/store.ts:13-15`).
- **The weekly digest already leads with a followed-companies section**
  (`src/lib/email/digest/collect.ts:70-95` → `listNewRolesForFollows`);
  sections assembled in `assemble.ts:85-99`; empty sections dropped.
- Recipients today: union of uids with follows / saved searches / applications
  (`src/lib/email/digest/eligible-users.ts:40-66`); address = Firebase Auth
  email; synthetic `@intervu.cc` skipped at `send.ts:41` and again in
  `resolveSendPreflight` (`src/lib/email/send.ts:67`). **Username+password
  accounts are structurally unreachable by email.**
- Suppression store: `email_suppressions/{normalizedEmail}` Firestore doc,
  enforced in the send preflight (`src/lib/email/suppression.ts:38-42`) —
  opt-out model.
- Cron: `deploy/run-weekly-digest.sh` POSTs to `/api/email/digest` with
  `Authorization: Bearer $EMAIL_DIGEST_CRON_SECRET`
  (`src/app/api/email/digest/route.ts:24-33`). The route's header comment
  saying it is not cron-wired is stale (predates PR #215).
- **The web app has zero Postgres connectivity**: no PG client in
  `package.json`; the only `pg` import in the repo is a standalone box script
  (`scripts/simulate-ranking-tiebreaker.mjs:21`).
- DNS (checked at the zone's own NS, liv/louis.ns.cloudflare.com):
  intervuhq.com **can send** — `resend._domainkey` DKIM present, SPF
  `v=spf1 include:amazonses.com ~all` on `send.`; DMARC `p=none`; **no apex
  MX** (cannot receive), no apex SPF. intervu.cc has no email DNS at all.
- Auth methods: Google popup/redirect + username→synthetic-email password
  (`src/lib/firebase/client-auth.ts:75-133`,
  `src/lib/auth/username-email.ts:26-30`). No passwordless flow exists.
- Sitemap lists only companies with ≥3 open roles — 263/442 at last measure
  (`src/lib/companies/indexable.ts:1-30`). Only job-detail pages link into
  `/co` (`EmployerTrackRecord.tsx:30`, `JobDetail.tsx:532,899`).
- Unverified/open: whether PR #250 is deployed (bundle grep indeterminate —
  its copy lives on pages not fetched); PostHog read access still absent, so
  funnel numbers come from the new first-party counters below.

## What ships

1. **Email step on `/co`** — `CompanyFollowControl`'s "Email me when they
   post" opens a one-field email form (standard inline email-capture pattern)
   with a quiet "have an account? sign in" link preserving today's dialog.
   Submit → confirmation state ("Check your inbox — confirm and we'll watch
   {company}."). The form is a **reusable primitive** (no company knowledge
   inside); v1 mounts it only on the company page.
2. **PG seam** — `pg` dependency, one thin pool module, `INTERVU_PG_URL` env
   (box-side, outside the tree), new least-privilege `intervu_web` role (DML
   on the four tables below only). All statements use
   `SET LOCAL statement_timeout` inside transactions (pooler lesson).
3. **DDL** (applied via the Supabase SQL editor as `postgres`):
   - `intervu.identities` — `id` uuid PK, `email` unique (citext if the
     extension is available on the project — **verify during planning**; else
     lowercased text + unique functional index), `email_verified_at`,
     `firebase_uid` NULL unique, `google_sub` NULL unique (reserved for the
     auth exit), `created_at`, `last_seen_at`.
   - `intervu.auth_tokens` — `token_hash` (sha256 of 32 random bytes) PK,
     `identity_id` FK, `purpose` (`'verify_email'` now; `'login'` reserved),
     `redirect_path`, `expires_at` (30 min), `consumed_at`, `created_at`.
   - ~~`intervu.sessions` — created now, written by nothing in this phase;
     reserved for the auth exit.~~ (removed by the 2026-08-19 amendment —
     Supabase Auth owns sessions.)
   - `intervu.email_follows` — `(identity_id, company_domain)` PK,
     `created_at`, `unsubscribed_at`.
4. **API routes** — POST submit (Turnstile-verified, rate-limited, identical
   response for known/unknown addresses, ≤3 verification sends per address
   per day) and GET verify (single-use token → `email_verified_at`, insert
   follow, set contact cookie, redirect to `redirect_path` after
   `validateNextParam`-style validation).
5. **Contact cookie** — signed httpOnly cookie carrying the identity id.
   Authorizes ONLY follow/unfollow for that identity (one-click second
   follow). Grants nothing an anonymous visitor cannot already do.
6. **Digest PG lane** — recipient source #2: verified identities with ≥1
   active `email_follows` row, feeding domains into the existing
   `listNewRolesForFollows` chokepoint. Send only when the section is
   non-empty. **Dedupe rule:** if a Firebase digest-eligible account has the
   same normalized email, the PG lane skips it — no double sends.
   **Suppression stays a single chokepoint:** global unsubscribe writes the
   existing `email_suppressions` store the preflight already enforces;
   per-company unfollow sets `unsubscribed_at` in PG. Every email carries
   List-Unsubscribe plus visible unsubscribe + unfollow links.
7. **Deletion routine** (definition of done, per the #247 lesson): one
   `deleteIdentity` path clearing all four tables, invoked by (a) the
   unsubscribe-and-forget-me link and (b) `deleteAccount` (the `auth.ts` one
   the UI calls) for firebase-linked identities. No PG user data ships
   without its deletion path.
8. **/admin counters** — five first-party events on the existing telemetry
   path (module identified during planning): follow click, CTA click, email
   submitted, email verified, unsubscribe.
9. **Tests** — unit: token store (expiry, single-use, hash-only), recipient
   dedupe, suppression precedence; e2e extends
   `tests/e2e/company-follow.spec.ts`. Per the generic-fix rule, tests cover
   at least one class case beyond the surfaced flow (second follow onto an
   existing identity via the contact cookie).

## Guards

- **No second auth source of truth** (the #2655 incident class): this phase
  mints no login sessions; the contact cookie cannot unlock anything
  account-scoped. Supabase Auth will own sessions when the auth-exit
  project lands; this phase mints no login state.
- **No lying fallbacks:** `INTERVU_PG_URL` absent → the CTA keeps today's
  account-dialog behavior; PG errors surface as honest failure states, never
  fake success.
- **Honesty of the promise:** the CTA copy already says "weekly note when
  they post" — the activity-only cadence plus the existing followed-company
  digest section make that literally true for email-only followers.
- **Enumeration/abuse:** uniform responses, hashed tokens, capped sends,
  Turnstile, per-IP + per-address rate limits (CF edge rule remains as outer
  layer).

## Out of scope

- The Firebase→box auth migration itself (email magic-link login, Google
  OIDC, session minting, MCP OAuth linkage, account migration). This schema
  is its landing pad, not its implementation.
- Saved-search email capture and any non-company-page mount of the primitive.
- Apex DNS fixes (MX, apex SPF, DMARC hardening) — separate small Cloudflare
  task list for Vivek; sending rides the already-working Resend path.
- Prompting username+password accounts for a real email in settings
  (deferred, noted).
- Migrating account follows or suppressions to PG (documented debt for the
  auth exit).
- Match scores / personalization — the 2026-08-05 facts-only line stands.

## Success test

An anonymous visitor lands on `/co/{slug}`, clicks Follow, clicks "Email me
when they post", types one email address, confirms from their inbox, and —
the next week a followed company posts — receives one factual note. The
/admin funnel shows each step's count. Deleting themselves takes one click
from any email.

## Open items carried into planning

- citext / pgcrypto (`gen_random_uuid`) availability on the Supabase
  project — verify before DDL.
- Exact telemetry module for /admin counters.
- Exact Turnstile verification helper reuse (signup path already has one).
- Confirm #250 deploy status (one browser visit to `/yours`).
- Digest preview endpoint coverage for the PG lane (manual live probe with a
  Vivek-controlled mailbox before announcing).

## Amendment (2026-08-19, evening)

Per Vivek: the identity/auth tables live in **Supabase Postgres**, not the
Contabo DB box. The future auth exit lands on **Supabase Auth** (email +
Google via GoTrue) rather than hand-rolled auth on the box, so the reserved
`sessions` table is dropped from the DDL — GoTrue owns session storage, and
this project should not carry a second, unused sessions table alongside it.
DDL now applies via the Supabase SQL editor rather than root SSH to the DB
box. The heavy-table Supabase exit (listings/observations/health_history) is
unaffected by this change — identity tables are small and were never part of
that migration's scope.
