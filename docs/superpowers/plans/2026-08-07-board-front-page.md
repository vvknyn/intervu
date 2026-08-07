# Board Front Page (Phase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` serves the job board directly — the instrument deck is retired, `/jobs` inherits the front-door metadata, and the honest-market claim becomes the board's guest promise line.

**Architecture:** `/` becomes a pure server redirect (preserving the external `?signin=1` contract before redirecting to `/jobs`). The deck and its Suspense child are deleted with their now-orphaned lane data; survivors were verified by consumer grep (spec Phase 1b lists them). `/jobs` gains a `layout.tsx` for metadata (its page is a client component) and a guest promise band that keeps `marketingClaim` alive on a real surface.

**Tech Stack:** Next.js 16 App Router (worktree `/Users/vivek/Antigravity/Code/intervu-board-front`, branch `feat/board-front-page` @ origin/main c2a74b5), node:test via `npx tsx --test` (NOT vitest, NOT `npm test`).

**Spec:** `docs/specs/2026-08-07-job-seeker-front-door-design.md`, section "Phase 1b".

## Global Constraints

- Banned vocabulary in guest strings (unchanged class guard): `openclaw`, `mcp`, `agent(s)`, `skill(s)`, `whatsapp`, `connector(s)`, `self-host`, `ai` — `tests/unit/guest-copy-jargon.test.ts` must stay green with entries only pruned for deleted symbols, never for surviving ones.
- Honesty: screening/flagging language only; never "removed". Never claim sign-in is needed to search.
- `?signin=1` contract preserved exactly: `signin=1` (and no other condition) → `/login`, with `next` passed through only when `validateNextParam` accepts it.
- Deletions must be complete: after Task 1, `grep -rn "InstrumentDeck\|LandingSigninRedirect\|LANDING_LANES\|DEFAULT_LANDING_LANE\|signedInCtaLabel\|BOARD_PANE_LINE" src/ tests/` must return zero hits.
- Survivors that must NOT be touched: `HowItWorksFilm`, `OpenclawWaitlistForm`, `INSTRUMENT_META`, `INSTRUMENT_SUPPORT`, `signInCtaLabel`, `nextPathForLandingLane`, `parseConnectClientParam`, `marketingClaim`, `getMarketingStatsAction`, `LANDING_TITLE`, `LANDING_DESCRIPTION`.
- This worktree's node_modules lacks `maxmind`/`mcp-handler` (stale parent clone): Task 3's build requires `npm install` first — expect ZERO lockfile diff; if package-lock.json changes, stop and report.
- Unit tests per-file: `npx tsx --test tests/unit/<file>.test.ts`. Full-suite has pre-existing failures unrelated to this branch.
- Commits on `feat/board-front-page` only; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do NOT merge the PR — open it and stop; Vivek ships.

## File Structure

| File | Action | Responsibility after this plan |
|---|---|---|
| `src/app/page.tsx` | rewrite | Pure server redirect: signin contract → `/login`, else → `/jobs` |
| `src/components/marketing/InstrumentDeck.tsx` | delete | — |
| `src/components/marketing/LandingSigninRedirect.tsx` | delete | — |
| `src/lib/auth/landing-intent.ts` | modify | Loses `LANDING_LANES`, `DEFAULT_LANDING_LANE`, `signedInCtaLabel`; keeps type + surviving helpers |
| `src/components/marketing/openclaw-content.ts` | modify | Loses `BOARD_PANE_LINE` |
| `src/components/layout/should-hide-site-chrome.ts` | modify | Loses the dead `pathname === "/"` case |
| `src/app/jobs/layout.tsx` | create | Front-door metadata for `/jobs` |
| `src/app/jobs/page.tsx` | modify | Guest promise band rendering `marketingClaim(stats)` |
| `tests/unit/landing-intent.test.ts` | modify | Prune deleted-symbol assertions |
| `tests/unit/guest-copy-jargon.test.ts` | modify | Prune `BOARD_PANE_LINE` entry only |

---

### Task 1: `/` redirect + deck deletion cascade

**Files:**
- Rewrite: `src/app/page.tsx`
- Delete: `src/components/marketing/InstrumentDeck.tsx`, `src/components/marketing/LandingSigninRedirect.tsx`
- Modify: `src/lib/auth/landing-intent.ts`, `src/components/marketing/openclaw-content.ts`, `src/components/layout/should-hide-site-chrome.ts`
- Test: `tests/unit/landing-intent.test.ts`, `tests/unit/guest-copy-jargon.test.ts`

**Interfaces:**
- Consumes: `validateNextParam` from `@/lib/auth/product-routes` (exists; was the deck's import).
- Produces: nothing new — this task only removes surface.

- [ ] **Step 1: Prune the tests first (failing state is expected to be a PASS — deletion TDD inverts: tests must be green BEFORE and AFTER, with deleted-symbol assertions removed)**

In `tests/unit/landing-intent.test.ts`: remove `DEFAULT_LANDING_LANE, LANDING_LANES` from the import and delete the entire `test("landing boots on the job board, with all three lanes present once", ...)` block; remove `signedInCtaLabel` from the import and delete the two `signedInCtaLabel` assertion lines from the CTA-labels test (keep the `signInCtaLabel` assertions — that helper survives).

In `tests/unit/guest-copy-jargon.test.ts`: remove `BOARD_PANE_LINE` from the `openclaw-content` import and its entry from `GUEST_STRINGS`. Touch nothing else — `INSTRUMENT_META`, `INSTRUMENT_SUPPORT`, and both `MARKETING_CLAIM_*` entries stay (their surfaces survive).

Run both: `npx tsx --test tests/unit/landing-intent.test.ts tests/unit/guest-copy-jargon.test.ts` — must PASS (the symbols still exist; assertions merely gone).

- [ ] **Step 2: Rewrite `src/app/page.tsx` in full**

```tsx
import { redirect } from "next/navigation";
import { validateNextParam } from "@/lib/auth/product-routes";

/**
 * The front door IS the job board (spec Phase 1b): `/` redirects to `/jobs`.
 * The `?signin=1` contract (no in-repo producers — external/legacy links)
 * is honored first, exactly as the retired landing deck honored it.
 */
export default async function HomePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    if (params.signin === "1") {
        const raw = typeof params.next === "string" ? params.next : null;
        const next = validateNextParam(raw);
        redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    }
    redirect("/jobs");
}
```

- [ ] **Step 3: Delete the deck and its child; prune orphans**

```bash
git rm src/components/marketing/InstrumentDeck.tsx src/components/marketing/LandingSigninRedirect.tsx
```

`src/lib/auth/landing-intent.ts`: delete the `DEFAULT_LANDING_LANE` and `LANDING_LANES` exports (with their doc comments) and the `signedInCtaLabel` function. Keep `LandingLane`, `nextPathForLandingLane`, `signInCtaLabel`, `parseConnectClientParam`.

`src/components/marketing/openclaw-content.ts`: delete the `BOARD_PANE_LINE` export and its doc comment.

`src/components/layout/should-hide-site-chrome.ts`: remove the `pathname === "/" ||` case (a redirecting route renders no chrome to hide). Do not touch the other cases.

- [ ] **Step 4: Verify deletions are complete and tests green**

```bash
grep -rn "InstrumentDeck\|LandingSigninRedirect\|LANDING_LANES\|DEFAULT_LANDING_LANE\|signedInCtaLabel\|BOARD_PANE_LINE" src/ tests/
```
Expected: zero hits. Then run: `npx tsx --test tests/unit/landing-intent.test.ts tests/unit/guest-copy-jargon.test.ts tests/unit/auth-next-param.test.ts` — all PASS (the last file covers `validateNextParam`, now load-bearing for the redirect).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(landing): / redirects to the job board — instrument deck retired

The board IS the front page (spec Phase 1b). signin=1 contract preserved
server-side; orphaned lane data deleted with the deck.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `/jobs` front-door metadata + guest promise band

**Files:**
- Create: `src/app/jobs/layout.tsx`
- Modify: `src/app/jobs/page.tsx` (promise band near the `GUEST_SERP_TIP` render site, ~line 2929)

**Interfaces:**
- Consumes: `LANDING_TITLE`, `LANDING_DESCRIPTION` from `@/lib/seo/constants`; `marketingClaim` from `@/lib/marketing-stats`; `getMarketingStatsAction` from `@/actions/marketing` (client-invocable server action — same pattern the page already uses for other actions).
- Produces: `data-testid="jobs-market-claim"` band.

- [ ] **Step 1: Create `src/app/jobs/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo/constants";
import { LANDING_DESCRIPTION, LANDING_TITLE } from "@/lib/seo/constants";

/**
 * /jobs is the front door (spec Phase 1b — `/` redirects here), and its page
 * is a client component, so the front-door metadata lives in this layout.
 */
export const metadata: Metadata = {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    alternates: {
        canonical: "/jobs",
    },
    openGraph: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
        url: `${SITE_URL}/jobs`,
    },
    twitter: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
    },
};

export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
```

(Merge the two `@/lib/seo/constants` imports into one line — shown split here only for clarity.)

- [ ] **Step 2: Add the guest promise band to `src/app/jobs/page.tsx`**

Read the `GUEST_SERP_TIP` render site (~line 2929) and its surrounding auth state first. Wire-up:

1. State + fetch (with the page's other state hooks):

```tsx
const [marketClaim, setMarketClaim] = useState<string | null>(null);
```

```tsx
useEffect(() => {
    let cancelled = false;
    getMarketingStatsAction().then(
        (stats) => { if (!cancelled) setMarketClaim(marketingClaim(stats)); },
        () => { if (!cancelled) setMarketClaim(marketingClaim(null)); },
    );
    return () => { cancelled = true; };
}, []);
```

2. Render a slim line immediately above the `GUEST_SERP_TIP` band, same visibility condition as that tip (guest-only if the tip is guest-only — match it exactly), styled to match the tip's quiet register (reuse its classes/tone, not a new design):

```tsx
{marketClaim ? (
    <p data-testid="jobs-market-claim" className={/* match the GUEST_SERP_TIP band's text styling */}>
        {marketClaim}
    </p>
) : null}
```

Imports to add: `marketingClaim` from `@/lib/marketing-stats`, `getMarketingStatsAction` from `@/actions/marketing`. If the tip's visibility condition or styling classes differ from what this plan assumes, match the code, not the plan — and say so in your report.

- [ ] **Step 3: Tests**

`npx tsx --test tests/unit/guest-copy-jargon.test.ts tests/unit/marketing-stats.test.ts` — PASS (the claim strings were already under the ban test; no new strings are introduced by this task).

- [ ] **Step 4: Commit**

```bash
git add src/app/jobs/layout.tsx src/app/jobs/page.tsx
git commit -m "feat(jobs): front-door metadata + honest-market promise band on the board

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Build + artifact verification + PR (open, do not merge)

- [ ] **Step 1: Restore build deps**

```bash
npm install
git status --porcelain   # expect EMPTY (zero lockfile diff) — if package-lock.json changed, STOP and report
```

- [ ] **Step 2: Build + serve + verify the artifact**

```bash
npm run build
npx next start -p 4322 &
sleep 3
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:4322/            # expect 307 http://localhost:4322/jobs
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:4322/?signin=1" # expect 307 http://localhost:4322/login
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:4322/?signin=1&next=/yours"  # expect 307 …/login?next=%2Fyours
curl -s http://localhost:4322/jobs | grep -c "Intervu — live jobs, checked for ghost postings"   # expect ≥ 1
kill %1
```

If `next start` env demands arise, copy `.env.local` from `/Users/vivek/Antigravity/Code/intervu/.env.local`; a dead Meili is fine (claim degrades by design).

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/board-front-page
gh pr create --repo vvknyn/intervu --base main \
  --title "feat(landing): the board IS the front page — / redirects to /jobs, deck retired" \
  --body "$(cat <<'EOF'
Phase 1b of docs/specs/2026-08-07-job-seeker-front-door-design.md (Vivek: "why don't we directly show the job board").

- / server-redirects to /jobs (signin=1 contract preserved via validateNextParam)
- InstrumentDeck + LandingSigninRedirect deleted; orphaned lane data pruned (survivors verified by consumer grep — films, waitlist form, mock-page helpers, connect content all untouched)
- /jobs takes the front-door metadata via new jobs/layout.tsx (page is a client component)
- marketingClaim(stats) becomes the board's guest promise band (kept alive on a real surface)
- shouldHideSiteChrome drops its dead "/" case

Security pass: route redirect + deletions + metadata only; no new endpoints, secrets, deps, or permissions; signin redirect target constrained by existing validateNextParam allowlist; no new output sinks. Remaining checklist items N/A.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Stop here. Vivek merges/ships.
