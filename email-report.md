# Email foundation on Resend — report

Branch `feat/email-resend`, 4 commits: 297fc73 (E1+E2), 3cf5b5f (E3), 8bd5351 (E4 + /unsubscribe fix), 806d3a3 (E5+E6).

## Status
- **E1 send seam** — done. `src/lib/email/send.ts` (chokepoint), `types.ts` (EmailKind policy table).
- **E2 suppression/unsubscribe** — done. `src/lib/email/suppression.ts`, `unsubscribe-token.ts`, `src/app/unsubscribe/route.ts` (GET+POST/RFC8058), `src/app/api/webhooks/resend/route.ts`.
- **E3 waitlist confirm** — done. `src/lib/email/waitlist-confirmation.ts`; `src/actions/waitlist.ts:52` and `connect-waitlist.ts:30` now upsert+idempotent-send.
- **E4 weekly digest** — done, cron NOT wired. `src/lib/email/digest/{assemble,collect,send}.ts`, `src/app/api/email/digest/route.ts`, `scripts/digest-dry-run.ts --uid=<uid>`.
- **E5 preferences** — done. `src/actions/email-preferences.ts`, `EmailPreferencesSection.tsx` in `/settings?tab=account`.
- **E6 privacy** — done. `src/app/privacy/page.tsx:88` new "Email" section.

## Env vars Vivek must set
`RESEND_API_KEY`, `RESEND_FROM` (e.g. `intervu <hello@intervuhq.com>`), `RESEND_WEBHOOK_SECRET` (from Resend's webhook config, `whsec_...`), `EMAIL_DIGEST_CRON_SECRET` (any random string, bearer-auth for `/api/email/digest`, not wired to a schedule yet). `ENCRYPTION_KEY` already required (API-key-at-rest) — now dual-purpose for unsubscribe-token HMAC, no new secret added. `NEXT_PUBLIC_SITE_URL` already required app-wide; this worktree's `.env.local` was missing it (unrelated pre-existing gap, not from this PR).

## DNS Resend will require (get exact values from Resend's domain dashboard, not invented here)
SPF: TXT record on the sending domain/subdomain. DKIM: TXT record(s) Resend generates per-domain. DMARC: recommended TXT at `_dmarc.<domain>`. Standard Resend domain-verification flow — do this once the account exists.

## Needs the real key to verify
Actual `resend.emails.send()` call (SDK usage verified against installed types + a caught bug where `new Resend()` throws with no key at all — worked around in webhook-verify.ts). Webhook payload shape verified against the SDK's bundled `standardwebhooks` verifier with hand-signed fixtures, not a live Resend payload.

## Tests / build
37 new unit tests (email-*.test.ts), all pass. Full suite 1656/1665 — 9 fail: 3 pre-existing werift + 6 from one pre-existing `seo-jsonld.test.ts` file needing `NEXT_PUBLIC_SITE_URL` (confirmed via stack trace, unrelated to this change). `tsc --noEmit` clean. `next build` clean (Turbopack) — caught 2 real bugs `tsc` missed: a page.tsx/route.ts path conflict at `/unsubscribe`, and sync exports in `"use server"` files (Next requires every export there to be async).

## Concerns
1. Digest "totalNew" can be a floor, not exact, once a section's fetch hits its own cap (10) — template renders "10+" honestly rather than a possibly-wrong exact number; documented in `assemble.ts`.
2. `email_suppressions` doc shape deviates from the brief's flat `{email,reason,kind,at}` example — used a per-scope entries map instead (doc comment explains why: a flat record can't hold two independently-suppressed kinds without one overwriting the other).
3. Digest run endpoint has no rate/cost cap on `listDigestEligibleUids()` — fine at current scale, revisit before real user volume.
