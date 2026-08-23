# Verified Email Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Email me when they post" on `/co/[slug]` becomes a one-field verified-email step backed by an identity schema in our own Postgres, with the weekly digest gaining an email-only recipient lane.

**Architecture:** A thin PG seam (`pg` pool + injected `Queryable`) feeds an identity store (identities / auth_tokens / sessions / email_follows). Two API routes (submit + verify) drive the flow; the existing digest section builder (`listNewRolesForFollows`) and unsubscribe/suppression chokepoints are reused unchanged. No login sessions are minted — the contact cookie is an opaque DB-checked token that authorizes only follow/unfollow.

**Tech Stack:** Next.js App Router, TypeScript, `pg` (new dep), zod v4, Firebase (untouched), Resend via existing `sendEmail`, Turnstile (existing widget + verifier), `node:test` via `npx tsx --test`, Playwright.

**Spec:** `docs/specs/2026-08-19-verified-email-follow-design.md` (committed on this branch — read it first).

## Global Constraints

- Branch `feat/email-follow` in `/Users/vivek/Antigravity/Code/intervu-email-follow` ONLY. Never touch the primary checkout.
- **Do NOT edit `src/app/jobs/page.tsx` or `src/app/globals.css`** — a parallel session has in-flight work there.
- **Never run DDL against any database, never open a network connection to any DB.** The SQL file is reviewed and applied manually later.
- Never print or commit secret values. Env var NAMES only. New env: `INTERVU_PG_URL` (absent locally — code must behave honestly without it).
- No lying fallbacks: PG unavailable → the feature reports itself unavailable; never fake success.
- Unit tests: `node:test` style, run with `npx tsx --test tests/unit/<file>.test.ts [...]`. Main has pre-existing failures — capture the baseline (Task 0) and compare against it, never against zero.
- Copy rules: plain language, facts only, no "MCP/agent/AI" words on guest surfaces (`tests/unit/guest-copy-jargon.test.ts` enforces this — new copy files must be added to its sweep if it enumerates files).
- Commit after every task with a conventional message; end every commit body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Generic-fix rule: every mechanism is company-agnostic; tests must include at least one case beyond the primary flow.

---

### Task 0: Baseline capture

**Files:** none (read-only)

- [ ] **Step 1:** `cd /Users/vivek/Antigravity/Code/intervu-email-follow && npx tsx --test tests/unit/*.test.ts 2>&1 | tail -5` — record the pass/fail counts verbatim into `docs/superpowers/plans/2026-08-19-baseline.txt`.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | tail -3` and `npm run lint 2>&1 | tail -3` — append to the same file.
- [ ] **Step 3:** Commit `chore: capture test/lint baseline for email-follow work`.

### Task 1: Identity DDL file

**Files:**
- Create: `deploy/db-box/identity-schema.sql`

**Interfaces:** Produces the four tables every later task's SQL assumes. Column names below are load-bearing — later tasks use them verbatim.

- [ ] **Step 1: Write the SQL file** (idempotent; header comment: "Apply manually as postgres on the DB box — see deploy/db-box/load-firestore-export.sh for the lane. Requires PG13+ (gen_random_uuid). NEVER applied by CI or app code."):

```sql
CREATE SCHEMA IF NOT EXISTS intervu;

CREATE TABLE IF NOT EXISTS intervu.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_verified_at timestamptz,
  contact_token uuid NOT NULL DEFAULT gen_random_uuid(),
  firebase_uid text,
  google_sub text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_email_lower_key ON intervu.identities (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS identities_contact_token_key ON intervu.identities (contact_token);
CREATE UNIQUE INDEX IF NOT EXISTS identities_firebase_uid_key ON intervu.identities (firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS identities_google_sub_key ON intervu.identities (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS intervu.auth_tokens (
  token_hash bytea PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','login')),
  redirect_path text NOT NULL DEFAULT '/',
  request_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_tokens_identity_created_idx ON intervu.auth_tokens (identity_id, created_at DESC);

-- Reserved for the auth-exit project. Nothing in this phase writes it.
CREATE TABLE IF NOT EXISTS intervu.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS intervu.email_follows (
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  company_domain text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  PRIMARY KEY (identity_id, company_domain)
);

-- ROLE SETUP — run manually as postgres, password set interactively, never committed:
--   CREATE ROLE intervu_web LOGIN PASSWORD '<set interactively>';
--   GRANT USAGE ON SCHEMA intervu TO intervu_web;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON intervu.identities, intervu.auth_tokens,
--     intervu.sessions, intervu.email_follows TO intervu_web;
```

- [ ] **Step 2:** Commit `feat(db): identity schema DDL for verified email follow`.

### Task 2: PG pool seam

**Files:**
- Create: `src/lib/pg/pool.ts`
- Test: `tests/unit/pg-pool.test.ts`
- Modify: `package.json` (add `pg` + `@types/pg`)

**Interfaces — Produces:**
```ts
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}
export function getIntervuPg(): Queryable | null;   // null when INTERVU_PG_URL unset
export function isIdentityStoreEnabled(): boolean;  // = getIntervuPg() !== null
```

- [ ] **Step 1:** Write failing test `tests/unit/pg-pool.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("getIntervuPg returns null without INTERVU_PG_URL", async () => {
  delete process.env.INTERVU_PG_URL;
  const { getIntervuPg, isIdentityStoreEnabled } = await import("../../src/lib/pg/pool");
  assert.equal(getIntervuPg(), null);
  assert.equal(isIdentityStoreEnabled(), false);
});
```

- [ ] **Step 2:** Run `npx tsx --test tests/unit/pg-pool.test.ts` — expect FAIL (module not found).
- [ ] **Step 3:** `npm install pg && npm install -D @types/pg` (check the lockfile diff is additive — if npm reformats thousands of lines, stop and rebuild the diff minimally).
- [ ] **Step 4:** Implement `src/lib/pg/pool.ts`: lazy singleton `pg.Pool` (`max: 5`, `connectionTimeoutMillis: 5000`); every `query` runs inside a transaction that first issues `SET LOCAL statement_timeout = '15s'` (bare SET binds to one pooled backend — the SET LOCAL discipline is mandatory). Return null (never throw) when env is absent.
- [ ] **Step 5:** Run the test — expect PASS. Run `npx tsc --noEmit` — no NEW errors vs baseline.
- [ ] **Step 6:** Commit `feat(pg): intervu PG pool seam behind INTERVU_PG_URL`.

### Task 3: Identity store

**Files:**
- Create: `src/lib/identity/store.ts`
- Test: `tests/unit/identity-store.test.ts`

**Interfaces — Consumes:** `Queryable` from Task 2. **Produces:**
```ts
export function normalizeEmail(email: string): string;           // trim + lowercase
export interface IdentityRow { id: string; email: string; emailVerifiedAt: string | null; contactToken: string; }
export async function upsertIdentityForEmail(q: Queryable, email: string): Promise<IdentityRow>;
export async function countRecentVerifyTokens(q: Queryable, email: string, sinceHours: number): Promise<number>;
export async function createVerifyToken(q: Queryable, input: { identityId: string; redirectPath: string; requestIp?: string }): Promise<string>; // returns RAW 64-char hex token; stores sha256 only
export async function consumeVerifyToken(q: Queryable, rawToken: string): Promise<{ identityId: string; email: string; redirectPath: string; contactToken: string } | null>;
export async function addEmailFollow(q: Queryable, input: { identityId: string; companyDomain: string; displayName: string }): Promise<void>;
export async function removeEmailFollow(q: Queryable, identityId: string, companyDomain: string): Promise<void>;
export async function getIdentityByContactToken(q: Queryable, contactToken: string): Promise<IdentityRow | null>;
export async function listEmailFollowRecipients(q: Queryable): Promise<Array<{ identityId: string; email: string; follows: Array<{ domain: string; displayName: string }> }>>;
export async function deleteIdentityByEmail(q: Queryable, email: string): Promise<boolean>;
```

Implementation requirements (each is a test):
- `upsertIdentityForEmail`: `INSERT ... ON CONFLICT` is unavailable on an expression index — use `INSERT ... SELECT WHERE NOT EXISTS` + re-select by `lower(email)` in one transaction, or `ON CONFLICT ((lower(email)))` if supported; either way idempotent per normalized email.
- `createVerifyToken`: 32 random bytes via `node:crypto randomBytes`, raw hex returned, `sha256` digest stored; `expires_at = now() + interval '30 minutes'`; purpose `'verify_email'`.
- `consumeVerifyToken` single-use semantics live IN the SQL: `UPDATE intervu.auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND purpose = 'verify_email' RETURNING ...` joined/followed by marking `email_verified_at = COALESCE(email_verified_at, now())`.
- `addEmailFollow`: upsert; re-following clears `unsubscribed_at`.
- `listEmailFollowRecipients`: only identities with `email_verified_at IS NOT NULL`, only follows with `unsubscribed_at IS NULL`, grouped per identity.

- [ ] **Step 1:** Write failing tests using a fake `Queryable` that records `(text, params)` and returns scripted rows. Minimum cases: raw token never appears in any recorded param (only its sha256); consume SQL contains `consumed_at IS NULL` and `expires_at > now()`; `normalizeEmail("  A@B.co ")` → `"a@b.co"`; re-follow clears `unsubscribed_at` (param or SQL assertion); recipients query filters unverified identities; `deleteIdentityByEmail` deletes by normalized email and returns false when nothing matched (the beyond-primary-flow case).
- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(identity): PG identity store (identities, tokens, follows)`.

### Task 4: verify_follow email kind + template

**Files:**
- Modify: the `EmailKind` union (find it: `grep -rn "EmailKind" src/lib/email/types.ts` — verify exact file) and `resolveSendPreflight` in `src/lib/email/send.ts:53-59`
- Create: `src/lib/email/verify-follow.ts`
- Test: `tests/unit/verify-follow-email.test.ts`

**Interfaces — Produces:**
```ts
export function verifyFollowEmailContent(input: { companyName: string; verifyUrl: string }): { subject: string; text: string; html: string };
export async function sendVerifyFollowEmail(input: { email: string; companyName: string; verifyUrl: string }): Promise<void>; // wraps sendEmail with kind "verify_follow"
```

- [ ] **Step 1:** Write failing tests: subject/text mention the company name and contain the verifyUrl exactly once each; text contains no word from the jargon list ("MCP", "agent", "AI"); `resolveSendPreflight` does NOT skip a `verify_follow` send for a missing `unsubscribeUrl` (transactional email — read the current preflight logic first and preserve every existing rule; add a case asserting `digest` behavior is unchanged).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. Copy (exact): subject `Confirm: watch {companyName} for new roles`; body promise line `One click and we'll email you when {companyName} posts or closes roles. Nothing else.` plus the link and `If you didn't ask for this, ignore this email.`
- [ ] **Step 4:** Run — PASS, plus `npx tsx --test tests/unit/guest-copy-jargon.test.ts` still passes.
- [ ] **Step 5:** Commit `feat(email): verify_follow kind and verification email`.

### Task 5: Submit endpoint

**Files:**
- Create: `src/lib/identity/submit-follow.ts`, `src/app/api/follow-email/route.ts`
- Test: `tests/unit/submit-follow.test.ts`

**Interfaces — Consumes:** Task 3 store, Task 4 sender, `verifyTurnstile` (`src/lib/shield/turnstile.ts:65`), `getSiteUrl` (grep its module — used in `digest/send.ts:43-45`). **Produces:**
```ts
export interface SubmitFollowDeps {
  q: Queryable | null;
  verifyTurnstile(token: string | null | undefined, remoteIp?: string): Promise<{ success: boolean }>;
  sendVerifyEmail(input: { email: string; companyName: string; verifyUrl: string }): Promise<void>;
  baseUrl: string;
}
export async function submitFollowEmail(deps: SubmitFollowDeps, input: {
  email: string; companyDomain: string; displayName: string; redirectPath: string;
  turnstileToken: string | null; requestIp?: string;
}): Promise<{ status: "accepted" } | { status: "unavailable" } | { status: "rejected" }>;
```

Rules (each a test): zod-validate email; `q === null` → `"unavailable"` (honest absence, no fake accept); failed Turnstile → `"rejected"`; `countRecentVerifyTokens(email, 24) >= 3` → return `"accepted"` **without sending** (uniform response, capped); happy path → upsert identity, create token, send email with `verifyUrl = `${baseUrl}/api/follow-email/verify?token=${raw}``; response NEVER differs between new and existing addresses (enumeration).
- [ ] **Step 1:** failing tests with fakes for all deps (assert send called 0 times at cap; identical response shapes for new vs existing identity — the beyond-primary case). **Step 2:** FAIL. **Step 3:** implement lib + thin route (POST, zod body, IP from `x-forwarded-for` first value, wires real deps, maps statuses to 200/`{status}` — 200 even for rejected? No: Turnstile reject → 400; `unavailable` → 503). **Step 4:** PASS + tsc clean vs baseline. **Step 5:** Commit `feat(identity): follow-email submit endpoint with turnstile and caps`.

### Task 6: Verify endpoint + contact cookie

**Files:**
- Create: `src/lib/identity/contact-cookie.ts`, `src/app/api/follow-email/verify/route.ts`
- Test: `tests/unit/verify-follow-consume.test.ts`

**Interfaces — Consumes:** Task 3 `consumeVerifyToken`/`addEmailFollow`; the `next`-path validator from PR #249 (`grep -rn "validateNextParam\|isSafeNext" src/lib/auth/product-routes.ts` — reuse it, do not write a new one). **Produces:**
```ts
export const CONTACT_COOKIE_NAME = "intervu_contact";
export async function setContactCookie(contactToken: string): Promise<void>;   // cookies().set, httpOnly, secure in prod, sameSite lax, path "/", maxAge 180 days — mirror src/lib/firebase/auth-session.ts:53-62
export async function getContactTokenFromCookies(): Promise<string | null>;
export async function consumeAndFollow(q: Queryable, rawToken: string, follow: { companyDomain: string; displayName: string } | null): Promise<{ redirectPath: string; contactToken: string } | null>;
```

Flow: GET `?token=...&domain=...&name=...` → `consumeAndFollow` → on success set cookie, redirect to `validated(redirectPath) + (includes "?" ? "&" : "?") + "followed=1"`; on failure redirect to `/jobs?followed=0` (no token detail leaked).
- [ ] **Step 1:** failing tests: invalid/expired token → null (fake store returns null) and route redirects to the failure path; success adds the follow AND a second success WITHOUT a follow payload still returns redirectPath (the primitive is not company-bound — beyond-primary case). **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(identity): verify endpoint, contact cookie`.

### Task 7: One-click follow action

**Files:**
- Create: `src/actions/email-follow.ts`
- Test: `tests/unit/email-follow-action.test.ts`

**Interfaces — Consumes:** Tasks 2/3/6. **Produces:**
```ts
export async function followByContactCookieAction(input: { companyDomain: string; displayName: string }): Promise<{ status: "followed" | "no-contact" | "unavailable" }>;
export async function unfollowByContactCookieAction(input: { companyDomain: string }): Promise<{ status: "unfollowed" | "no-contact" | "unavailable" }>;
```
Core logic in a deps-injected helper (same pattern as Task 5) so unit tests need no Next runtime: cookie token → `getIdentityByContactToken` → add/remove follow. Unknown token → `"no-contact"` (cookie may be stale after deletion — never an error page).
- [ ] Steps: failing tests (stale-token case included) → FAIL → implement → PASS → Commit `feat(identity): one-click follow via contact cookie`.

### Task 8: Email step UI

**Files:**
- Modify: `src/components/companies/CompanyFollowControl.tsx` (78 lines, pasted in full in the interface notes of the spec commit), `src/lib/follows/persist-copy.ts`
- Create: `src/components/companies/FollowEmailStep.tsx`
- Test: extend `tests/unit/follows-persist-copy.test.ts`; extend `tests/e2e/company-follow.spec.ts`

New copy functions in `persist-copy.ts` (exact strings — tests assert verbatim):
```ts
export function followEmailPrompt(displayName: string): string {
  return `Get an email when ${displayName} posts or closes roles. Nothing else.`;
}
export function followEmailSentLine(): string {
  return "Check your inbox — click the link to confirm.";
}
export function followEmailVerifiedLine(displayName: string): string {
  return `You're watching ${displayName}. We'll email you when something changes.`;
}
```

`FollowEmailStep` ("use client"): props `{ companyDomain: string; displayName: string; onSignInInstead(): void }`. States: `idle` (email input + `TurnstileWidget onVerify` + submit posting JSON to `/api/follow-email` with `redirectPath: window.location.pathname`) → `sent` (`followEmailSentLine()`) → error state shows an honest retry line. Quiet link "Have an account? Sign in" → `onSignInInstead()`.

`CompanyFollowControl` changes only: add `emailStepOpen` state; the persist CTA's `onClick` becomes `setEmailStepOpen(true)`; render `<FollowEmailStep ... onSignInInstead={() => { setEmailStepOpen(false); setAuthOpen(true); }} />` when open; when the page URL has `followed=1` OR `followByContactCookieAction` already applies, show `followEmailVerifiedLine(displayName)` instead of the prompt. AuthPopover fallback stays fully intact.

- [ ] **Step 1:** extend the copy unit test with the three new functions (verbatim assertions, follow the existing file's style) — FAIL → implement copy → PASS.
- [ ] **Step 2:** build the component + wiring; `npx tsc --noEmit` no new errors; `npx tsx --test tests/unit/guest-copy-jargon.test.ts` passes.
- [ ] **Step 3:** extend e2e `company-follow.spec.ts` (same describe block, same `ELITE_COMPANY_SLUG` helper): new test "persist CTA opens email step, sign-in link falls back to auth dialog" — click follow, click `follow-persist-cta`, expect `getByTestId('follow-email-step')` visible and `getByTestId('follow-email-input')` focusable; click the sign-in link, expect the auth dialog testid used by existing tests. Do NOT submit the form in e2e (live Turnstile).
- [ ] **Step 4:** Run the e2e file if a dev server is available (`npm run dev` + `npx playwright test tests/e2e/company-follow.spec.ts`); if the environment can't run it, run unit + tsc + lint and state that e2e was not executed.
- [ ] **Step 5:** Commit `feat(companies): one-field email step behind the follow CTA`.

### Task 9: Digest PG lane

**Files:**
- Create: `src/lib/email/digest/pg-lane.ts`
- Modify: `src/app/api/email/digest/route.ts`
- Test: `tests/unit/digest-pg-lane.test.ts`

**Interfaces — Consumes:** `listEmailFollowRecipients` (Task 3), `listNewRolesForFollows(sinceIso, follows, search?)` (`src/lib/email/digest/list-new-roles.ts:30-34`, `FollowTarget = Pick<FollowedCompany, "domain" | "displayName">`), assemble types (`assemble.ts:27-61`), `sendEmail`, `isSuppressed(email, "digest")`, `signUnsubscribeToken(email, "digest")` (as used at `digest/send.ts:43-45`). **Produces:**
```ts
export async function sendEmailFollowDigests(input: {
  q: Queryable; sinceIso: string; excludeEmails: Set<string>;   // normalized
}): Promise<Array<{ email: string; result: "sent" | "skipped-excluded" | "skipped-suppressed" | "skipped-empty" | "error" }>>;
```
Rules (each a test, fakes for store/search/send): recipient in `excludeEmails` → skipped, send not called; suppressed → skipped; `listNewRolesForFollows` returns no groups → `skipped-empty` (activity-only cadence); happy path sends ONE email with a single `followed-company` section and an unsubscribeUrl; a recipient following two companies gets one email covering both (beyond-primary case).
Route change: after the existing uid loop, when `isIdentityStoreEnabled()`, build `excludeEmails` from the account-lane recipients' emails — extract the per-uid email the same way `previewDigestForUser` does (`digest/send.ts:30-33`); factor that lookup into a shared helper rather than duplicating it — then call `sendEmailFollowDigests` and merge results into the JSON response under `pgLane`.
- [ ] Steps: failing tests → FAIL → implement → PASS → Commit `feat(digest): email-only follower lane with dedupe and activity-only sends`.

### Task 10: Forget-me + account-deletion wiring

**Files:**
- Modify: `src/app/unsubscribe/route.ts` (GET/POST at L30/L55), the UI-called `deleteAccount` (find it: `grep -rn "deleteAccount" src/lib/firebase/auth.ts src/actions` — the auth.ts one is the one the UI calls; confirm by import trace before editing)
- Create: `src/lib/identity/forget.ts`
- Test: `tests/unit/identity-forget.test.ts`

**Produces:** `export async function forgetIdentity(q: Queryable | null, email: string): Promise<void>` — deletes the PG identity (cascades wipe tokens/follows/sessions) after `suppress(email, "all"...)`-equivalent global suppression via the EXISTING `suppress` helper (`suppression.ts` — reuse its scope vocabulary; read `UnsubscribeScope` first and use its global scope value, do not invent one). `q === null` → suppression still runs (never let a PG outage block an unsubscribe).
Wiring: unsubscribe route gains a `forget=1` variant on the existing token flow (same signed token, no new auth surface) that calls `forgetIdentity`; `deleteAccount` calls `forgetIdentity(getIntervuPg(), user.email)` when the account email is real (`!isMintedLoginEmail(email)`).
- [ ] Steps: failing tests (PG-null still suppresses; deletion of nonexistent identity is a no-op success — beyond-primary case) → FAIL → implement → PASS → Commit `feat(identity): forget-me path and account-deletion sweep`.

### Task 11: Funnel telemetry + admin counters

**Files:**
- Create: `src/lib/follows/funnel-log.ts`, `src/actions/follow-funnel.ts`
- Modify: `src/lib/admin/metrics.ts`, plus call sites: `FollowEmailStep` (cta/submit), verify route (verified), unsubscribe route (unsubscribed), `FollowButton` or `CompanyFollowControl` (follow_click)
- Test: `tests/unit/follow-funnel-log.test.ts`

**Produces:**
```ts
export type FollowFunnelStep = "follow_click" | "cta_click" | "email_submitted" | "email_verified" | "unsubscribed";
export async function recordFollowFunnelStep(entry: { step: FollowFunnelStep; companyDomain?: string }): Promise<void>; // writes { ...entry, createdAt } to Firestore collection "follow_funnel_events" via the src/lib/jobs/search-log.ts write() pattern (getAdminDb().collection(...).add)
export async function recordFollowFunnelAction(step: FollowFunnelStep, companyDomain?: string): Promise<void>; // server action, fire-and-forget wrapper for client call sites; never throws to the caller
```
Admin: register one metric per step in `metrics.ts` following the `timedCount` registry pattern (`metrics.ts:224-228`). `timedCount`'s spec takes `{ collection }` — read the registry helpers first; if it cannot express a `where("step","==",...)` filter, extend the registry with a generic filter-capable variant alongside `timedCount` (same shape, plus `filter: [field, value]`) rather than five bespoke reads. Note in code why: top-level collection single-field filters are covered by Firestore auto-indexes; collectionGroup filters are NOT (do not use a group query).
- [ ] Steps: failing unit test (entry shape includes createdAt; unknown step rejected by type — compile-time — plus runtime guard test; action never throws when write rejects — beyond-primary case) → FAIL → implement + wire call sites (server routes call `recordFollowFunnelStep` directly via `after(...)` like `src/actions/jobs.ts:125`; client components call the action) → PASS + tsc → Commit `feat(admin): follow funnel counters`.

### Task 12: Integration pass

**Files:** none new

- [ ] **Step 1:** `npm run lint && npx tsc --noEmit && npx tsx --test tests/unit/*.test.ts` — compare against `2026-08-19-baseline.txt`: NEW failures = fix before proceeding; pre-existing = report, don't touch.
- [ ] **Step 2:** `npm run build` — must complete.
- [ ] **Step 3:** With `.env.local` present, `npm run dev` and drive `/co/anthropic--com` manually via Playwright spec run: `npx playwright test tests/e2e/company-follow.spec.ts`. Report pass/fail verbatim.
- [ ] **Step 4:** Grep sanity: `grep -rn "INTERVU_PG_URL" src | wc -l` ≥ 1; `grep -rn "sessions" src/lib/identity src/actions/email-follow.ts | grep -iv reserved | wc -l` = 0 (nothing writes sessions).
- [ ] **Step 5:** Commit any fixes; `git push -u origin feat/email-follow`.

---

## Self-review notes (author)

- Spec coverage: ships items 1-9 of the spec's "What ships" (UI=T8, seam=T2, DDL=T1, routes=T5/6, cookie=T6/7, digest lane=T9, deletion=T10, counters=T11, tests=throughout+T12). Out-of-scope items remain out.
- DDL application, box env (`INTERVU_PG_URL`), and role creation are deliberately NOT tasks — they run through the root-SSH lane with Vivek's explicit go after code review.
- Type consistency: `Queryable` (T2) is the only DB handle every later task consumes; `FollowTarget` field names (`domain`, `displayName`) match `email_follows.display_name` mapping in T3's recipient query.
