# Job-Seeker Front Door (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip intervu's landing front door to the job board — board-first default lane, jargon-free `/` metadata, outcome-first landing copy, guest-surface jargon sweep, and a server-rendered landing page.

**Architecture:** Copy-and-defaults change routed through the repo's existing single-source-of-truth modules: `landing-intent.ts` gains lane order/default, `seo/constants.ts` becomes the chokepoint for guest metadata strings, `openclaw-content.ts` keeps landing copy, `marketing-stats.ts` owns the corpus claim (its `marketingClaim` gets wired into the board lane). One new class guard: a unit test that bans machinery vocabulary across every guest-surface string export. One small refactor isolates `useSearchParams` so `/` stops bailing out to client-side rendering.

**Tech Stack:** Next.js 16 App Router (worktree `/Users/vivek/Antigravity/Code/intervu-front-door`, branch `feat/job-seeker-front-door` @ origin/main dac1039), React client components, node:test via `npx tsx --test` (NOT vitest, NOT `npm test` — that runs Playwright), Playwright e2e (untouched; no e2e asserts landing lanes today).

**Spec:** `docs/specs/2026-08-07-job-seeker-front-door-design.md` (same repo).

## Global Constraints

- **Class rule (from spec):** copy a logged-out, non-technical visitor can reach must promise an outcome in plain words; technical copy is allowed only behind an explicit AI-lane/Connect opt-in. The landing tab labels "Claude / ChatGPT" and "OpenClaw" are the opt-in doors themselves and STAY.
- **Banned vocabulary in guest strings** (word-boundary, case-insensitive): `openclaw`, `mcp`, `agent(s)`, `skill(s)`, `whatsapp`, `connector(s)`, `self-host`, `ai`. Enforced by `tests/unit/guest-copy-jargon.test.ts` (Task 2 creates it; Tasks 3–4 extend it).
- **Honesty:** never claim ghosts are *removed* — the product *screens/flags* them ("screened for ghost-job risk" is the shipped site language). Never claim sign-in is needed to search — `/jobs` search is public; only opening a role gates.
- **Stealth:** no founder names or personal identity in any copy.
- Run unit tests per-file: `npx tsx --test tests/unit/<file>.test.ts`. The full suite has **10 pre-existing failures at origin/main** in unrelated suites (viewer/geo/mcp-route/jobs-upload — stale node_modules class); judge green only on the files this plan touches.
- All commits on `feat/job-seeker-front-door`; never commit on main. End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT merge the PR — open it and stop; Vivek ships.

## File Structure

| File | Action | Responsibility after this plan |
|---|---|---|
| `src/lib/auth/landing-intent.ts` | modify | Lane type + order + default + CTA labels (all lane data) |
| `src/components/marketing/InstrumentDeck.tsx` | modify | Renders lanes from `landing-intent`; no local lane data; no `useSearchParams` |
| `src/components/marketing/LandingSigninRedirect.tsx` | create | Sole `useSearchParams` consumer on `/`, isolated in Suspense |
| `src/app/page.tsx` | modify | Jargon-free metadata from `seo/constants`; passes `stats` to deck |
| `src/lib/seo/constants.ts` | modify | Chokepoint for guest metadata strings (`LANDING_TITLE`, `LANDING_DESCRIPTION`, `SITE_DESCRIPTION`) |
| `src/app/layout.tsx` | modify | Imports `SITE_DESCRIPTION` instead of declaring it |
| `src/components/marketing/openclaw-content.ts` | modify | `INSTRUMENT_SUPPORT` rewrite + new `BOARD_PANE_LINE` |
| `src/lib/marketing-stats.ts` | modify | Adds `FOOTER_PROVENANCE_LINE` next to `CORPUS_SOURCE_DESCRIPTOR` |
| `src/components/layout/Footer.tsx` | modify | Renders `FOOTER_PROVENANCE_LINE`; MCP sentence gone |
| `src/app/pricing/pricing-tiers.ts` | modify | Connect bullet loses "(MCP)" |
| `tests/unit/landing-intent.test.ts` | modify | + lane order/default contract test |
| `tests/unit/guest-copy-jargon.test.ts` | create | Class guard: bans machinery vocabulary in guest strings |

---

### Task 1: Board-first lane order + default lane

**Files:**
- Modify: `src/lib/auth/landing-intent.ts` (after the `LandingLane` type, line 4)
- Modify: `src/components/marketing/InstrumentDeck.tsx:28-32` (local `LANES`), `:54` (default lane), `:158` (map)
- Test: `tests/unit/landing-intent.test.ts`

**Interfaces:**
- Consumes: `LandingLane` type (already in `landing-intent.ts`).
- Produces: `DEFAULT_LANDING_LANE: LandingLane` and `LANDING_LANES: readonly { id: LandingLane; label: string }[]` — Task 3 re-reads the deck; nothing else consumes these.

- [ ] **Step 0: One-time worktree setup (node_modules)**

```bash
cd /Users/vivek/Antigravity/Code/intervu-front-door
[ -d node_modules ] || cp -Rc /Users/vivek/Antigravity/Code/intervu/node_modules node_modules
```

APFS copy-on-write clone (~15s). NEVER symlink (Turbopack hard-fails) and never `npm install` (slow, redundant).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/landing-intent.test.ts` (existing imports are from `"../../src/lib/auth/landing-intent"` — add `DEFAULT_LANDING_LANE, LANDING_LANES` to that import):

```ts
test("landing boots on the job board, with all three lanes present once", () => {
  assert.equal(DEFAULT_LANDING_LANE, "board");
  assert.equal(LANDING_LANES[0].id, "board");
  assert.deepEqual(
    [...LANDING_LANES].map((l) => l.id).sort(),
    ["board", "claw", "mcp"],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/landing-intent.test.ts`
Expected: FAIL — `LANDING_LANES`/`DEFAULT_LANDING_LANE` not exported.

- [ ] **Step 3: Implement in `landing-intent.ts`**

Insert after the `LandingLane` type declaration:

```ts
/** First lane a fresh visitor sees. Board first — the front door sells the
 *  job board; the AI lanes are one tab away for people who came for them
 *  (docs/specs/2026-08-07-job-seeker-front-door-design.md). */
export const DEFAULT_LANDING_LANE: LandingLane = "board";

/** Lane order + labels for the landing instrument tabs. */
export const LANDING_LANES: readonly { id: LandingLane; label: string }[] = [
    { id: "board", label: "Job board" },
    { id: "mcp", label: "Claude / ChatGPT" },
    { id: "claw", label: "OpenClaw" },
];
```

In `InstrumentDeck.tsx`: delete the local `LANES` const (lines 28-32); add `DEFAULT_LANDING_LANE, LANDING_LANES` to the existing `@/lib/auth/landing-intent` import; change line 54 to `useState<LandingLane>(DEFAULT_LANDING_LANE)`; change the tablist map (line 158) from `LANES.map` to `LANDING_LANES.map`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/landing-intent.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/landing-intent.ts src/components/marketing/InstrumentDeck.tsx tests/unit/landing-intent.test.ts
git commit -m "feat(landing): job board is the default lane, board-first tab order

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Jargon-free `/` metadata via the seo/constants chokepoint

**Files:**
- Modify: `src/lib/seo/constants.ts` (append), `src/app/page.tsx:1-24`, `src/app/layout.tsx:57` (local `SITE_DESCRIPTION`)
- Test: create `tests/unit/guest-copy-jargon.test.ts`

**Interfaces:**
- Consumes: `CORPUS_SOURCE_DESCRIPTOR` from `@/lib/marketing-stats` (exists, = `"scraped from companies' own career pages, screened for ghost-job risk"`).
- Produces: `LANDING_TITLE: string`, `LANDING_DESCRIPTION: string`, `SITE_DESCRIPTION: string` from `@/lib/seo/constants` — consumed by `page.tsx`, `layout.tsx`, and the jargon test. Tasks 3–4 extend this test's `GUEST_STRINGS` map.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/guest-copy-jargon.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  SITE_DESCRIPTION,
} from "../../src/lib/seo/constants";

/**
 * Class guard for the guest-surface rule
 * (docs/specs/2026-08-07-job-seeker-front-door-design.md): copy a logged-out,
 * non-technical visitor sees must promise outcomes in plain words. Machinery
 * vocabulary lives only behind the explicit opt-in doors — the landing AI
 * tabs, /connect, /openclaw. Every new guest-surface string export gets an
 * entry in GUEST_STRINGS; the ban list is the spec's, verbatim.
 */
const BANNED: readonly RegExp[] = [
  /openclaw/i,
  /\bmcp\b/i,
  /\bagents?\b/i,
  /\bskills?\b/i,
  /whatsapp/i,
  /\bconnectors?\b/i,
  /self-host/i,
  /\bai\b/i,
];

const GUEST_STRINGS: Record<string, string> = {
  LANDING_TITLE,
  LANDING_DESCRIPTION,
  SITE_DESCRIPTION,
};

test("guest-surface strings carry no machinery jargon", () => {
  for (const [name, value] of Object.entries(GUEST_STRINGS)) {
    for (const pattern of BANNED) {
      assert.doesNotMatch(value, pattern, `${name} must not match ${pattern}`);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/guest-copy-jargon.test.ts`
Expected: FAIL — `LANDING_TITLE`/`LANDING_DESCRIPTION`/`SITE_DESCRIPTION` not exported from `seo/constants`.

- [ ] **Step 3: Implement**

Append to `src/lib/seo/constants.ts`:

```ts
import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";

/** Landing (`/`) metadata — what every search result, browser tab, and
 *  shared-link preview shows. Job-seeker language only; the guest-copy
 *  jargon test bans machinery terms here. Agent/OpenClaw copy belongs to
 *  the opted-in surfaces (/connect, /openclaw). */
export const LANDING_TITLE = "Intervu — live jobs, checked for ghost postings";
export const LANDING_DESCRIPTION = `Every listing is ${CORPUS_SOURCE_DESCRIPTOR} — so you stop wasting applications on roles that were never real.`;

/** Site-wide default meta description (root layout). Declared here — not in
 *  layout.tsx — so the jargon test covers every guest meta string in one
 *  place. */
export const SITE_DESCRIPTION =
    "Search live roles — flagged for ghost-job risk before you spend time on them.";
```

(The import goes at the top of the file with the existing imports, not mid-file.)

In `src/app/layout.tsx`: delete the local `const SITE_DESCRIPTION = "Search live roles — flagged for ghost-job risk before you spend time on them.";` (line 57) and add `SITE_DESCRIPTION` to the existing import from `@/lib/seo/constants` (the file already imports `SITE_NAME` from there — see line 52 `const SITE_TITLE = SITE_NAME;`).

In `src/app/page.tsx`: replace lines 9-24 with:

```ts
export const metadata: Metadata = {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        url: SITE_URL,
    },
    twitter: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
    },
};
```

Update `page.tsx` imports: add `LANDING_DESCRIPTION, LANDING_TITLE` to the `@/lib/seo/constants` import; delete the now-unused `OPENCLAW_SUBLINE` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/guest-copy-jargon.test.ts`
Expected: PASS. (Also `npx tsx --test tests/unit/seo-jsonld.test.ts` — it imports `seo/constants`; must still pass.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/constants.ts src/app/page.tsx src/app/layout.tsx tests/unit/guest-copy-jargon.test.ts
git commit -m "feat(seo): landing + site metadata speak job-seeker language

/ title was 'an overnight job-search agent' with an OpenClaw/WhatsApp
description — the version of intervu every search result and link preview
showed. New chokepoint: guest meta strings live in seo/constants under a
jargon ban test.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Outcome-first instrument copy + live claim on the board lane

**Files:**
- Modify: `src/components/marketing/openclaw-content.ts:61-62` (`INSTRUMENT_SUPPORT`), append `BOARD_PANE_LINE`
- Modify: `src/components/marketing/InstrumentDeck.tsx` — delete `BOARD_HINT` (:42-43), props (:51), pane text (:190), hint (:196)
- Modify: `src/app/page.tsx:27-35` (pass `stats`)
- Test: `tests/unit/guest-copy-jargon.test.ts` (extend)

**Interfaces:**
- Consumes: `marketingClaim(stats: MarketingCorpusStats | null): string` and type `MarketingCorpusStats` from `@/lib/marketing-stats`; `formatCorpusCount` from `@/lib/jobs/corpus-count` (moves from page.tsx into the deck); `CorpusCount` sample shape `{ kind: "exact", value: 12345 }`.
- Produces: `BOARD_PANE_LINE: string` from `openclaw-content.ts`; `InstrumentDeck` prop contract changes to `{ stats: MarketingCorpusStats | null }`.

- [ ] **Step 1: Extend the jargon test (failing first)**

In `tests/unit/guest-copy-jargon.test.ts`, add imports:

```ts
import {
  BOARD_PANE_LINE,
  INSTRUMENT_META,
  INSTRUMENT_SUPPORT,
} from "../../src/components/marketing/openclaw-content";
import { marketingClaim } from "../../src/lib/marketing-stats";
```

and extend `GUEST_STRINGS`:

```ts
  INSTRUMENT_META,
  INSTRUMENT_SUPPORT,
  BOARD_PANE_LINE,
  MARKETING_CLAIM_NO_STATS: marketingClaim(null),
  MARKETING_CLAIM_WITH_COUNT: marketingClaim({
    liveJobs: { kind: "exact", value: 12345 },
  }),
```

(`MCP_CONNECTOR_HINT` / `OPENCLAW_INSTALL_HINT` are deliberately NOT here — they render only after clicking an AI tab, which is the opt-in door.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/guest-copy-jargon.test.ts`
Expected: FAIL twice — `BOARD_PANE_LINE` not exported, and current `INSTRUMENT_SUPPORT` ("…or connect your AI.") matches `/\bai\b/i`.

- [ ] **Step 3: Implement copy + wiring**

`openclaw-content.ts` — replace `INSTRUMENT_SUPPORT` (lines 61-62) and add the pane line after it:

```ts
export const INSTRUMENT_SUPPORT =
    "Browse free — sign in only when you open a role.";

/** Board-lane pane — the mono panel when the Job board tab is active.
 *  Replaces "/jobs — verified board" ("verified board" was insider-speak). */
export const BOARD_PANE_LINE = "/jobs — screened for ghost-job risk";
```

(Also update the `INSTRUMENT_SUPPORT` doc comment: the old one described the "detail+AI gate" wording. Note: `/mock/auth-gate` shares this export by design — comment says so; its copy updates with ours, which is correct.)

`InstrumentDeck.tsx`:
1. Delete the `BOARD_HINT` const (lines 42-43).
2. Add `BOARD_PANE_LINE` to the `openclaw-content` import; add `import { marketingClaim, type MarketingCorpusStats } from "@/lib/marketing-stats";` and `import { formatCorpusCount } from "@/lib/jobs/corpus-count";`
3. Change the signature (line 51) and derive `jobCount` inside:

```tsx
export function InstrumentDeck({ stats }: { stats: MarketingCorpusStats | null }) {
    const jobCount = stats ? formatCorpusCount(stats.liveJobs) : null;
```

4. Board pane (line 190): `/jobs — verified board` → `{BOARD_PANE_LINE}`.
5. Hint line (line 196): `{active?.hint ?? BOARD_HINT}` → `{active?.hint ?? marketingClaim(stats)}`.

`page.tsx` (lines 27-35): pass stats through, drop the local formatting:

```tsx
export default async function HomePage() {
    const stats = await getMarketingStatsAction();
    return (
        <Suspense fallback={null}>
            <InstrumentDeck stats={stats} />
        </Suspense>
    );
}
```

Delete `page.tsx`'s now-unused `formatCorpusCount` import. (The Suspense wrapper dies in Task 5, not here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/guest-copy-jargon.test.ts tests/unit/marketing-stats.test.ts`
Expected: PASS both files.

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/openclaw-content.ts src/components/marketing/InstrumentDeck.tsx src/app/page.tsx tests/unit/guest-copy-jargon.test.ts
git commit -m "feat(landing): outcome-first board copy — live corpus claim as the board hint

Support line stops saying 'connect your AI'; board pane stops saying
'verified board'; the board hint becomes marketingClaim(stats) — the
tested honest-market sentence, now actually rendered on the landing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Guest jargon sweep — footer + pricing

**Files:**
- Modify: `src/lib/marketing-stats.ts` (append), `src/components/layout/Footer.tsx:29-32`, `src/app/pricing/pricing-tiers.ts:51`
- Test: `tests/unit/guest-copy-jargon.test.ts` (extend)

**Interfaces:**
- Consumes: `CORPUS_SOURCE_DESCRIPTOR` (same module).
- Produces: `FOOTER_PROVENANCE_LINE: string` from `@/lib/marketing-stats` — consumed by `Footer.tsx` and the jargon test.

- [ ] **Step 1: Extend the jargon test (failing first)**

Add `FOOTER_PROVENANCE_LINE` to the existing `@/lib/marketing-stats` import in `tests/unit/guest-copy-jargon.test.ts` and add `FOOTER_PROVENANCE_LINE,` to `GUEST_STRINGS`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/guest-copy-jargon.test.ts`
Expected: FAIL — `FOOTER_PROVENANCE_LINE` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/marketing-stats.ts`:

```ts
/** Site footer's one-line provenance claim — same fact as the landing claim,
 *  one source. The old footer sentence ended "…Same market your agent sees
 *  via MCP." — machinery language on every guest page; dropped 2026-08-07
 *  (docs/specs/2026-08-07-job-seeker-front-door-design.md). */
export const FOOTER_PROVENANCE_LINE = `Every listing is ${CORPUS_SOURCE_DESCRIPTOR} — never resold, never curated.`;
```

`Footer.tsx`: replace the first `<p>` body (lines 29-32) with `{FOOTER_PROVENANCE_LINE}`; swap the `CORPUS_SOURCE_DESCRIPTOR` import for `FOOTER_PROVENANCE_LINE`.

`pricing-tiers.ts` line 51 — drop the protocol name, keep the honest split (plain words about *your* AI are allowed on pricing, which describes the AI tier; the protocol acronym is not):

```ts
      { text: "Connect your AI — fit, tailoring, prep run in YOUR AI", href: "/connect" },
```

(The pricing bullet is not added to the ban test — it legitimately contains "AI". The per-surface rule, not a per-string exemption list, is the contract; the test file's comment already says so.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/guest-copy-jargon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketing-stats.ts src/components/layout/Footer.tsx src/app/pricing/pricing-tiers.ts tests/unit/guest-copy-jargon.test.ts
git commit -m "fix(copy): guest surfaces drop machinery jargon — footer MCP line, pricing (MCP) tag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Server-render the landing (kill the CSR bailout)

Observed live 2026-08-07: `/` served `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">` — an empty page for crawlers and no-JS link-preview bots. Cause: `useSearchParams()` inside `InstrumentDeck` with the whole deck wrapped in `<Suspense fallback={null}>`.

**Files:**
- Create: `src/components/marketing/LandingSigninRedirect.tsx`
- Modify: `src/components/marketing/InstrumentDeck.tsx` (remove `useSearchParams`; `handleAuthed` reads `window.location`; mount the redirect child), `src/app/page.tsx` (drop outer Suspense)

**Interfaces:**
- Consumes: `getCurrentUser`, `onAuthChange`, `User` from `@/lib/firebase/client-auth`; `validateNextParam` from `@/lib/auth/product-routes` (all already imported by the deck).
- Produces: `LandingSigninRedirect(): null` — mounted only by `InstrumentDeck`.

- [ ] **Step 1: Create `LandingSigninRedirect.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";

/**
 * The landing route's ONLY `useSearchParams` consumer, isolated behind its
 * own Suspense boundary. When this hook lived in `InstrumentDeck` itself,
 * the whole page bailed out to client-side rendering (observed live
 * 2026-08-07: `/` served an empty BAILOUT_TO_CLIENT_SIDE_RENDERING shell),
 * so crawlers and no-JS link previews got a blank page. Renders nothing —
 * it only replays the `?signin=1` redirect contract.
 */
export function LandingSigninRedirect() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(() => getCurrentUser());

    useEffect(() => onAuthChange(setUser), []);

    useEffect(() => {
        if (searchParams.get("signin") !== "1" || user) return;
        const next = searchParams.get("next");
        router.replace(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    }, [searchParams, user, router]);

    return null;
}
```

- [ ] **Step 2: Rewire `InstrumentDeck.tsx`**

1. Remove `useSearchParams` from the `next/navigation` import (keep `useRouter`); delete `const searchParams = useSearchParams();` (line 53) and the `?signin=1` redirect effect (lines 70-74) — both now live in the child.
2. Add `import { Suspense } from "react"` (merge into the existing react import) and `import { LandingSigninRedirect } from "@/components/marketing/LandingSigninRedirect";`
3. `handleAuthed` reads the URL at event time (client-only by definition — no hook needed):

```tsx
    const handleAuthed = () => {
        const urlNext = new URLSearchParams(window.location.search).get("next");
        const next =
            validateNextParam(urlNext) ??
            validateNextParam(pendingNext) ??
            "/jobs";
        setPendingNext(null);
        router.push(next);
    };
```

4. Mount the child next to `AuthPopover` at the bottom of the JSX:

```tsx
            <Suspense fallback={null}>
                <LandingSigninRedirect />
            </Suspense>
```

- [ ] **Step 3: Drop the outer Suspense in `page.tsx`**

```tsx
export default async function HomePage() {
    const stats = await getMarketingStatsAction();
    return <InstrumentDeck stats={stats} />;
}
```

Remove the now-unused `Suspense` import from `page.tsx`.

- [ ] **Step 4: Verify with a real build + rendered HTML (the artifact, not the exit code)**

```bash
npm run build
npx next start -p 4321 &
sleep 3
curl -s http://localhost:4321/ | grep -c "Find the job postings that are hiring"   # expect ≥ 1
curl -s http://localhost:4321/ | grep -c "BAILOUT_TO_CLIENT_SIDE_RENDERING"        # expect 0
kill %1
```

Env caveat: if the build demands env vars, copy `.env.local` from the parent checkout (`/Users/vivek/Antigravity/Code/intervu/.env.local`). A dead/absent Meili host is fine for this check — the landing degrades to `stats = null` by design (no count, claim still renders via `marketingClaim(null)`).

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/LandingSigninRedirect.tsx src/components/marketing/InstrumentDeck.tsx src/app/page.tsx
git commit -m "fix(landing): server-render the deck — isolate useSearchParams in a Suspense child

/ previously bailed to client-side rendering and served a blank shell to
crawlers and link-preview bots.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full check + PR (open, do not merge)

- [ ] **Step 1: Run every touched test file**

```bash
npx tsx --test tests/unit/landing-intent.test.ts tests/unit/guest-copy-jargon.test.ts tests/unit/marketing-stats.test.ts tests/unit/seo-jsonld.test.ts
```

Expected: PASS all. (Full-suite runs will show the 10 pre-existing origin/main failures in unrelated files — not ours to fix here.)

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/job-seeker-front-door
gh pr create --repo vvknyn/intervu --base main \
  --title "feat(landing): job-seeker front door — board-first default, jargon-free metadata, SSR landing" \
  --body "$(cat <<'EOF'
Phase 1 of docs/specs/2026-08-07-job-seeker-front-door-design.md.

- Default landing lane = Job board (was Claude/ChatGPT connector); board-first tab order
- / title/meta/OG rewritten in job-seeker language (was "an overnight job-search agent" + OpenClaw/WhatsApp description — what every search result and link preview showed)
- Board lane renders marketingClaim(stats) — the tested honest-market sentence with the live count
- Guest jargon sweep: footer "Same market your agent sees via MCP" dropped; pricing "(MCP)" tag dropped
- New class guard: tests/unit/guest-copy-jargon.test.ts bans machinery vocabulary across all guest-surface string exports
- / now server-renders (useSearchParams isolated in a Suspense child; page previously served a blank BAILOUT shell to crawlers/preview bots)

Security pass: copy/defaults + client-side refactor only. No new endpoints, secrets, deps, or permissions; auth gates untouched (/jobs was already public; detail gate unchanged); no new output sinks. Remaining checklist items N/A.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Stop here. Vivek merges/ships (`ship` flow); after deploy, the family retest is the real verification.
