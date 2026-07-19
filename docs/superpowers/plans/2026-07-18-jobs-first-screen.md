# Jobs First-Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/jobs` first screen per `docs/superpowers/specs/2026-07-17-jobs-landing-redesign-design.md` — gate removed, URL-as-state, trust-forward toolbar/rail/rows, mobile chip/sheet parity.

**Architecture:** The URL becomes the single source of truth for query/filters/sort/selected-job; component state mirrors it (one-way URL → state for the selected job). A new pure `url-state` module serializes both ways. The entry-gate mode machine collapses into one board. Trust surfaces (freshness stamp, ghost-hide default, live badges) read real data — a new freshness fetch, a `hideGhosts` search param, and `updated_at` per row.

**Tech Stack:** Next.js App Router (client page + server actions), Meilisearch via raw fetch, `node:test`/`assert/strict` unit tests run with `npx tsx`, Playwright e2e. No new dependencies.

## Global Constraints

- Branch: `feat/jobs-portal-redesign-phase1`. Never commit to `main` (auto-deploys prod).
- No new npm dependencies of any kind (no component-test libs — parity is enforced via shared-model unit tests + e2e).
- Unit tests: `node:test` + `node:assert/strict`, file per module in `tests/unit/`, run `npx tsx tests/unit/<file>.test.ts` (mirror `tests/unit/jobs-sort.test.ts`).
- E2E: Playwright, `tests/e2e/`, run `npx playwright test tests/e2e/<file>.spec.ts`; mirror the backend/mocking setup of `tests/e2e/jobs-search-polish.spec.ts` (read it before writing e2e).
- URL defaults are omitted: a pristine board is `/jobs` with zero params.
- Copy (verbatim): search placeholder `Search {N} live-checked roles…`; ghost toggle `Hide likely-ghost`; upsell `Upload your résumé to rank all {N} roles by fit — free`; tombstone `This role is no longer available.`; empty-state ghost line `{n} roles hidden as likely-ghost — show them`.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Ship gate (outside this repo):** jobs-sync reliability on the box must be repaired before this phase ships to prod. Not a task here; do not silently drop it from the PR description.
- Logged-in e2e variants (fit sort end-to-end, upload replay): reuse the auth pattern found in existing e2e specs if one exists (read `tests/e2e/*.spec.ts` first); if none exists, those flows are verified manually in Task 12 Step 4 — do NOT invent a new auth-mocking layer or create accounts for this phase.
- All line numbers below were verified on `b22d826`; re-locate by the quoted code if drift occurs.

---

### Task 1: URL-state module

**Files:**
- Create: `src/lib/jobs/url-state.ts`
- Test: `tests/unit/jobs-url-state.test.ts`

**Interfaces:**
- Consumes: `FACETABLE_KEYS`, `FacetKey`, `JobSortMode`, `PostedBucket` from `src/lib/jobs/types.ts` (verbatim: `JobSortMode = "newest" | "relevance" | "salary_desc"` at types.ts:82; `PostedBucket = "1d" | "3d" | "7d" | "30d" | "older"` at types.ts:85).
- Produces (later tasks rely on these exact names):
  - `interface JobsUrlState { q: string; facets: Partial<Record<FacetKey, string[]>>; salaryMin: number; visaOnly: boolean; postedBucket: PostedBucket | undefined; hideGhosts: boolean; sort: UrlSort | null; jobId: string | null }`
  - `type UrlSort = "newest" | "relevance" | "salary" | "fit"`
  - `const DEFAULT_URL_STATE: JobsUrlState` (hideGhosts **true**, everything else empty/null/0)
  - `parseJobsUrl(sp: URLSearchParams): JobsUrlState`
  - `serializeJobsUrl(s: JobsUrlState): string` — returns `""` for all-defaults, else `"?..."` in stable order `q, work, exp, emp, country, src, posted, salary, visa, ghosts, sort, job`
  - `urlSortToMode(s: UrlSort): JobSortMode | "fit"` — `salary → "salary_desc"`, others pass through

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/jobs-url-state.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseJobsUrl, serializeJobsUrl, DEFAULT_URL_STATE, urlSortToMode,
} from "../../src/lib/jobs/url-state";

test("all-defaults serializes to empty string", () => {
    assert.equal(serializeJobsUrl(DEFAULT_URL_STATE), "");
});

test("round-trip identity for a loaded state", () => {
    const s = {
        ...DEFAULT_URL_STATE,
        q: "backend engineer",
        facets: { work_type: ["remote", "hybrid"], location_country: ["US"] },
        salaryMin: 150_000,
        visaOnly: true,
        postedBucket: "7d" as const,
        hideGhosts: false,
        sort: "salary" as const,
        jobId: "dd-4821",
    };
    const url = serializeJobsUrl(s);
    assert.deepEqual(parseJobsUrl(new URLSearchParams(url.slice(1))), s);
});

test("defaults stay out of the URL", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, q: "sre" });
    assert.equal(url, "?q=sre");
});

test("junk params and junk values are dropped", () => {
    const s = parseJobsUrl(new URLSearchParams("bogus=1&sort=zzz&posted=99d&salary=7&work=remote"));
    assert.deepEqual(s, { ...DEFAULT_URL_STATE, facets: { work_type: ["remote"] } });
});

test("ghosts=show flips the hide default", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("ghosts=show")).hideGhosts, false);
    assert.equal(parseJobsUrl(new URLSearchParams("")).hideGhosts, true);
});

test("urlSortToMode maps salary to salary_desc and passes fit through", () => {
    assert.equal(urlSortToMode("salary"), "salary_desc");
    assert.equal(urlSortToMode("fit"), "fit");
    assert.equal(urlSortToMode("newest"), "newest");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/jobs-url-state.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/jobs/url-state'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/jobs/url-state.ts
import type { FacetKey, JobSortMode, PostedBucket } from "./types";

/** Sort values as they appear in the URL. `fit` = résumé rank (resolved page-side). */
export type UrlSort = "newest" | "relevance" | "salary" | "fit";

/** Full client state that round-trips through the /jobs URL. Defaults are omitted on serialize. */
export interface JobsUrlState {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    salaryMin: number;
    visaOnly: boolean;
    postedBucket: PostedBucket | undefined;
    hideGhosts: boolean;
    sort: UrlSort | null;
    jobId: string | null;
}

export const DEFAULT_URL_STATE: JobsUrlState = {
    q: "",
    facets: {},
    salaryMin: 0,
    visaOnly: false,
    postedBucket: undefined,
    hideGhosts: true,
    sort: null,
    jobId: null,
};

const FACET_PARAMS: Record<string, FacetKey> = {
    work: "work_type",
    exp: "experience_level",
    emp: "employment_type",
    country: "location_country",
    src: "source",
};
const PARAM_FOR_FACET = Object.fromEntries(
    Object.entries(FACET_PARAMS).map(([p, k]) => [k, p]),
) as Record<FacetKey, string>;

const SALARY_TIERS: Record<string, number> = {
    "50k": 50_000, "100k": 100_000, "150k": 150_000, "200k": 200_000,
};
const TIER_FOR_SALARY = Object.fromEntries(
    Object.entries(SALARY_TIERS).map(([label, n]) => [n, label]),
) as Record<number, string>;

const POSTED_VALUES: readonly PostedBucket[] = ["1d", "3d", "7d", "30d", "older"];
const SORT_VALUES: readonly UrlSort[] = ["newest", "relevance", "salary", "fit"];

export function urlSortToMode(s: UrlSort): JobSortMode | "fit" {
    return s === "salary" ? "salary_desc" : s;
}

export function parseJobsUrl(sp: URLSearchParams): JobsUrlState {
    const s: JobsUrlState = { ...DEFAULT_URL_STATE, facets: {} };
    const q = sp.get("q");
    if (q) s.q = q;
    for (const [param, key] of Object.entries(FACET_PARAMS)) {
        const raw = sp.get(param);
        if (!raw) continue;
        const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
        if (values.length) s.facets[key] = values;
    }
    const posted = sp.get("posted");
    if (posted && (POSTED_VALUES as readonly string[]).includes(posted)) {
        s.postedBucket = posted as PostedBucket;
    }
    const salary = sp.get("salary");
    if (salary && salary in SALARY_TIERS) s.salaryMin = SALARY_TIERS[salary];
    if (sp.get("visa") === "1") s.visaOnly = true;
    if (sp.get("ghosts") === "show") s.hideGhosts = false;
    const sort = sp.get("sort");
    if (sort && (SORT_VALUES as readonly string[]).includes(sort)) s.sort = sort as UrlSort;
    const job = sp.get("job");
    if (job) s.jobId = job;
    return s;
}

export function serializeJobsUrl(s: JobsUrlState): string {
    const sp = new URLSearchParams();
    if (s.q) sp.set("q", s.q);
    for (const [key, param] of Object.entries(PARAM_FOR_FACET) as [FacetKey, string][]) {
        const values = s.facets[key];
        if (values?.length) sp.set(param, values.join(","));
    }
    if (s.postedBucket) sp.set("posted", s.postedBucket);
    if (s.salaryMin > 0 && TIER_FOR_SALARY[s.salaryMin]) sp.set("salary", TIER_FOR_SALARY[s.salaryMin]);
    if (s.visaOnly) sp.set("visa", "1");
    if (!s.hideGhosts) sp.set("ghosts", "show");
    if (s.sort) sp.set("sort", s.sort);
    if (s.jobId) sp.set("job", s.jobId);
    const out = sp.toString();
    return out ? `?${out}` : "";
}
```

Note: `serializeJobsUrl` iterates `PARAM_FOR_FACET` (insertion order of `FACET_PARAMS`), giving the stable param order `q, work, exp, emp, country, src, posted, salary, visa, ghosts, sort, job`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/jobs-url-state.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/url-state.ts tests/unit/jobs-url-state.test.ts
git commit -m "feat(jobs): URL-state module — parse/serialize the /jobs screen state"
```

---

### Task 2: Ghost-hide search param

**Files:**
- Modify: `src/lib/jobs/types.ts` (`JobSearchParams`, lines 88-104)
- Modify: `src/lib/jobs/meilisearch.ts` (`buildFilter`, lines 80-103)
- Test: `tests/unit/jobs-filter.test.ts`

**Interfaces:**
- Produces: `JobSearchParams.hideGhosts?: boolean` — when true, `buildFilter` adds a `ghost_badge != "likely_ghost"` clause (quote style: match whatever quoting the existing facet clauses in `buildFilter` use — read meilisearch.ts:80-103 first).
- Callers that don't pass it get today's behavior (no clause). The page passes `hideGhosts: true` by default from Task 5 on.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/jobs-filter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilter } from "../../src/lib/jobs/meilisearch";

test("hideGhosts adds the ghost exclusion clause", () => {
    const f = buildFilter({ hideGhosts: true });
    assert.ok(f.some((c) => c.includes("ghost_badge !=") && c.includes("likely_ghost")), JSON.stringify(f));
});

test("hideGhosts absent/false adds no ghost clause", () => {
    for (const p of [{}, { hideGhosts: false }]) {
        const f = buildFilter(p);
        assert.ok(!f.some((c) => c.includes("ghost_badge !=")), JSON.stringify(f));
    }
});

test("hideGhosts composes with an explicit ghost_badge facet", () => {
    const f = buildFilter({ hideGhosts: true, facets: { ghost_badge: ["clear"] } });
    assert.ok(f.some((c) => c.includes("ghost_badge !=")));
    assert.ok(f.some((c) => c.includes('"clear"') || c.includes("'clear'") || c.includes("= clear")), JSON.stringify(f));
});
```

(If `buildFilter` is not exported today, export it — it's a pure function.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/jobs-filter.test.ts`
Expected: FAIL — either missing export or first assertion fails (no ghost clause exists yet)

- [ ] **Step 3: Implement**

In `src/lib/jobs/types.ts`, add to `JobSearchParams` (after `visaOnly`):

```ts
  /** When true, exclude jobs scored likely_ghost. The first-screen default. */
  hideGhosts?: boolean;
```

In `src/lib/jobs/meilisearch.ts` `buildFilter` (lines 80-103), after the existing facet/salary/visa clauses:

```ts
    if (p.hideGhosts) f.push('ghost_badge != "likely_ghost"');
```

(Adjust the quoting to match the file's existing facet-clause style exactly.)

- [ ] **Step 4: Run tests to verify pass, and confirm no regression**

Run: `npx tsx tests/unit/jobs-filter.test.ts && npx tsx tests/unit/jobs-sort.test.ts`
Expected: PASS both

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/types.ts src/lib/jobs/meilisearch.ts tests/unit/jobs-filter.test.ts
git commit -m "feat(jobs): hideGhosts search param excludes likely_ghost at the filter layer"
```

---

### Task 3: Freshness — data plumbing + pure helpers

**Files:**
- Create: `src/lib/jobs/freshness.ts`
- Modify: `src/lib/jobs/meilisearch.ts` (new fetch), `src/lib/jobs/search.ts` (dispatcher), `src/actions/jobs.ts` (new action)
- Test: `tests/unit/jobs-freshness.test.ts`

**Interfaces:**
- Produces:
  - `freshness.ts`: `STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000` (24h — conservative until sync cadence is repaired; single tuning point), `formatRelativeAge(iso: string, nowMs: number): string` (`"just now"` <60s, `"{n} min ago"` <1h, `"{n}h ago"` <24h, `"{n}d ago"` after), `isStale(iso: string | null, nowMs: number, thresholdMs?: number): boolean` (null → true)
  - `meilisearch.ts`: `fetchJobsLastUpdated(): Promise<string | null>` — POST `/indexes/jobs/search` with `{ limit: 1, sort: ["updated_at:desc"], attributesToRetrieve: ["updated_at"] }` (reuse the host/key/fetch pattern of `searchMeili` at meilisearch.ts:118-168; `updated_at` is already a sortable attribute per the settings block around meilisearch.ts:35). Returns the hit's `updated_at` or null on any failure.
  - `search.ts`: `getJobsLastUpdated(): Promise<string | null>` — returns `fetchJobsLastUpdated()` when `activeBackend()` is `"meilisearch"`, else null.
  - `actions/jobs.ts`: `export async function getJobsFreshnessAction(): Promise<string | null>` (thin wrapper, same style as `searchJobsAction` at actions/jobs.ts:10-12).

- [ ] **Step 1: Write the failing test (pure helpers only — network code is exercised by e2e later)**

```ts
// tests/unit/jobs-freshness.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeAge, isStale, STALE_THRESHOLD_MS } from "../../src/lib/jobs/freshness";

const NOW = Date.parse("2026-07-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("formatRelativeAge buckets", () => {
    assert.equal(formatRelativeAge(ago(30_000), NOW), "just now");
    assert.equal(formatRelativeAge(ago(6 * 60_000), NOW), "6 min ago");
    assert.equal(formatRelativeAge(ago(2 * 3_600_000), NOW), "2h ago");
    assert.equal(formatRelativeAge(ago(3 * 86_400_000), NOW), "3d ago");
});

test("isStale honors threshold and treats null as stale", () => {
    assert.equal(isStale(ago(STALE_THRESHOLD_MS + 1), NOW), true);
    assert.equal(isStale(ago(3_600_000), NOW), false);
    assert.equal(isStale(null, NOW), true);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx tsx tests/unit/jobs-freshness.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/jobs/freshness.ts
/** Amber threshold for the "updated X ago" stamp. 24h is conservative until the
 * box sync cadence is repaired — retune here, nowhere else. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function formatRelativeAge(iso: string, nowMs: number): string {
    const ms = Math.max(0, nowMs - Date.parse(iso));
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function isStale(iso: string | null, nowMs: number, thresholdMs = STALE_THRESHOLD_MS): boolean {
    if (!iso) return true;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return true;
    return nowMs - t > thresholdMs;
}
```

Then add `fetchJobsLastUpdated` (meilisearch.ts), `getJobsLastUpdated` (search.ts), `getJobsFreshnessAction` (actions/jobs.ts) per the Interfaces block above — mirror each file's existing patterns.

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx tsx tests/unit/jobs-freshness.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/freshness.ts src/lib/jobs/meilisearch.ts src/lib/jobs/search.ts src/actions/jobs.ts tests/unit/jobs-freshness.test.ts
git commit -m "feat(jobs): freshness plumbing — last-updated fetch + relative-age helpers"
```

---

### Task 4: Remove the entry gate; collapse the mode machine

**Files:**
- Modify: `src/app/jobs/page.tsx` (gate branch 1174-1191; `Mode` type 476-477; `ENTRY_KEY` block 486-513; `resolveEntry` 983-996; mount effect 999-1009; state init 624)
- Delete: `src/components/jobs/JobsEntryGate.tsx`
- Delete: `tests/e2e/jobs-entry-gate.spec.ts`
- Test: `tests/e2e/jobs-first-screen.spec.ts` (new — grows across later tasks)

**Interfaces:**
- Produces: `type Mode = "browse" | "search" | "match" | "explore"` (drop `"loading" | "ask" | "choose"`); initial mode `"browse"`. The results UI (previously the `else` branch at 1192-1453) becomes the only render path. One-time migration effect removes the dead localStorage key.
- Explore/Match *triggers* survive untouched at their existing call sites (they stop being entry forks in Task 6); the pending-actions auth gating (`"apply" | "tailor" | "upload" | "explore"` kinds) is not modified.

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/jobs-first-screen.spec.ts
import { test, expect } from "@playwright/test";
// Mirror the setup/mocking pattern of tests/e2e/jobs-search-polish.spec.ts (read it first).

test("anonymous first paint shows job rows — no gate", async ({ page }) => {
    await page.goto("/jobs");
    // No full-screen entry gate:
    await expect(page.getByText("Upload résumé", { exact: false })).not.toBeVisible();
    // Rows render without any interaction (selector per JobRow markup — adjust after reading the component):
    await expect(page.locator("[data-testid=job-row], [class*=jobRow], main li").first()).toBeVisible({ timeout: 10_000 });
});

test("legacy entry key is cleaned up", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("intervu.jobs.entry", JSON.stringify({ mode: "browse" })));
    await page.goto("/jobs");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => localStorage.getItem("intervu.jobs.entry"))).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx playwright test tests/e2e/jobs-first-screen.spec.ts`
Expected: FAIL — gate renders instead of rows

- [ ] **Step 3: Implement the collapse**

In `src/app/jobs/page.tsx`:
1. Line 476-477: `type Mode = "browse" | "search" | "match" | "explore";` (delete `ResultMode`, use `Mode` where it was used).
2. Line 624: `useState<Mode>("browse")`.
3. Delete the gate render branch (1174-1191) and the `mode === "loading"` branch (1174); the results UI renders unconditionally.
4. Delete `resolveEntry` (983-996) and the gate paths in the mount effect (999-1009). Keep the résumé fetch itself if other features use its result (check references to its state before deleting).
5. Replace the `ENTRY_KEY` persist block (486-513) with a one-time migration inside the mount effect:

```ts
useEffect(() => {
    try { localStorage.removeItem("intervu.jobs.entry"); } catch { /* private mode */ }
}, []);
```

6. Delete `src/components/jobs/JobsEntryGate.tsx` and its import (and now-unused `GateStep` references).
7. Delete `tests/e2e/jobs-entry-gate.spec.ts`. Grep `tests/e2e/jobs-search-polish.spec.ts` for gate navigation (searches for `ENTRY_KEY`, "browse all", gate button text) and update it to the gate-free entry.

- [ ] **Step 4: Run to verify pass + no regressions**

Run: `npx playwright test tests/e2e/jobs-first-screen.spec.ts tests/e2e/jobs-search-polish.spec.ts && npx tsc --noEmit`
Expected: PASS / clean

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(jobs): remove entry gate — jobs render on first paint for everyone"
```

---

### Task 5: Wire the URL as the single source of state

**Files:**
- Modify: `src/app/jobs/page.tsx` (state hooks 578-590; `selectJob`/selected handling around 598 and 1399-1404; first-page effect 678; `loadMore` 780)
- Test: extend `tests/e2e/jobs-first-screen.spec.ts`; unit tests already exist (Task 1)

**Interfaces:**
- Consumes: `parseJobsUrl`, `serializeJobsUrl`, `DEFAULT_URL_STATE`, `urlSortToMode` (Task 1); `hideGhosts` param (Task 2).
- Produces: page navigation contract used by Tasks 6-11 — `applyUrlState(next: JobsUrlState, history: "replace" | "push"): void` (serializes and calls `router.replace`/`router.push` with the pathname + query, `{ scroll: false }`). Rules: filter/sort/ghost changes → `replace`; search submit and job open → `push`. Selected job is **derived from the URL** (`useSearchParams()` → `jobId`) — row click pushes `?job=<id>`, detail close calls `router.back()`, popstate needs no bespoke handling.
- Refetch rule: re-run the search only when the search-affecting subset changes (`q, facets, salaryMin, visaOnly, postedBucket, hideGhosts, sort`) — compare serialized forms minus `job`; a `job`-only change never refetches (keeps list scroll intact).

- [ ] **Step 1: Write the failing e2e tests**

```ts
// append to tests/e2e/jobs-first-screen.spec.ts
test("deep link reconstructs the exact screen", async ({ page }) => {
    await page.goto("/jobs?q=engineer&work=remote&posted=7d&salary=150k");
    await expect(page.getByRole("textbox").first()).toHaveValue("engineer");
    // Active filter chips reflect the URL (chip text per existing chips loop at page.tsx:1254-1263):
    await expect(page.getByText("Remote", { exact: false }).first()).toBeVisible();
});

test("opening a job pushes a URL; back closes the detail", async ({ page }) => {
    await page.goto("/jobs");
    const firstRow = page.locator("[data-testid=job-row], main li").first();
    await firstRow.click();
    await expect(page).toHaveURL(/job=/);
    await page.goBack();
    await expect(page).not.toHaveURL(/job=/);
});

test("refresh reproduces the same results state", async ({ page }) => {
    await page.goto("/jobs?posted=7d");
    const countBefore = await page.getByText(/roles|results/i).first().textContent();
    await page.reload();
    await expect(page.getByText(/roles|results/i).first()).toHaveText(countBefore ?? "");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx playwright test tests/e2e/jobs-first-screen.spec.ts`
Expected: new tests FAIL (URL never carries state today)

- [ ] **Step 3: Implement**

In `page.tsx`:
1. Import `useSearchParams, usePathname` from `next/navigation` (router already at line 4/577).
2. Initialize the state hooks (578-590) from `parseJobsUrl(useSearchParams())` — do the parse in a `useMemo` on first render; add `const [hideGhosts, setHideGhosts] = useState(initial.hideGhosts)`.
3. Add `applyUrlState` (contract above). Route every state mutation through it: facet toggles / salary / visa / posted / ghost / sort → `"replace"`; search submit → `"push"`; row click → `"push"` with `jobId`.
4. Derive `selected` from the `job` search param: an effect watches `useSearchParams()`, finds the job among loaded hits, and sets the existing `selected` state. Detail close → `router.back()`.
5. Pass `hideGhosts` into every `searchJobsAction` call (first-page effect at 678 and `loadMore` at 780).
6. Apply the refetch rule from the Interfaces block (serialized-minus-`job` comparison in the fetch effect's dependency).
7. `sort=fit` in the URL: for now resolve as `relevance` (the fit pipeline arrives in Task 6 — leave a single `urlSortToMode(...)` call site so Task 6 changes one branch).

- [ ] **Step 4: Run to verify pass**

Run: `npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsx tests/unit/jobs-url-state.test.ts && npx tsc --noEmit`
Expected: PASS all

- [ ] **Step 5: Commit**

```bash
git add src/app/jobs/page.tsx tests/e2e/jobs-first-screen.spec.ts
git commit -m "feat(jobs): URL is the state — shareable, refreshable, back-button-correct"
```

---

### Task 6: Toolbar — placeholder count, freshness stamp, sort menu, Explore relocation

**Files:**
- Modify: `src/app/jobs/page.tsx` (toolbar region 1239-1304; search input region 1205-1213; sort Select 1270-1291)
- Test: extend `tests/e2e/jobs-first-screen.spec.ts`

**Interfaces:**
- Consumes: `getJobsFreshnessAction` (Task 3), `formatRelativeAge`/`isStale` (Task 3), `applyUrlState` (Task 5), `buildMatchQuery` + `resumeIsUsable` (existing: page.tsx:62, page.tsx:520-524).
- Produces: `corpusTotal: number | null` state — captured from `result.total` (`JobSearchResult.total`, types.ts:108+) the first time a zero-param search resolves; used by the placeholder and Task 8's upsell copy.
- Sort menu contract: options Newest / Best match (disabled without query — keep existing logic at 1270-1291) / Salary / **Rank by fit**. Choosing Rank by fit: if `resumeIsUsable(...)` → set `sort: "fit"` via `applyUrlState` and run the match pipeline (`buildMatchQuery(resume)` feeds the search exactly as the old match mode did — trace the old `mode === "match"` data path before writing); else queue the existing `"upload"` pending action, and on completion apply fit. When fit is active, show a dismissible chip `Ranked by your résumé ✕` (clear → `sort: null`).
- Explore: the existing explore trigger moves to a compact button beside the search input; its credit/auth gating logic is reused verbatim.

- [ ] **Step 1: Write the failing e2e tests**

```ts
// append to tests/e2e/jobs-first-screen.spec.ts
test("placeholder carries the live corpus count", async ({ page }) => {
    await page.goto("/jobs");
    const ph = await page.getByRole("textbox").first().getAttribute("placeholder");
    expect(ph).toMatch(/Search [\d,]+ live-checked roles/);
});

test("freshness stamp renders relative age", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByText(/updated (just now|\d+ (min|h|d)? ?ago)/i)).toBeVisible();
});

test("sort menu offers Rank by fit", async ({ page }) => {
    await page.goto("/jobs");
    await page.getByText("Sort", { exact: false }).first().click();
    await expect(page.getByText("Rank by fit", { exact: false })).toBeVisible();
});
```

- [ ] **Step 2: Run to verify fail** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts` → new tests FAIL

- [ ] **Step 3: Implement** per the Interfaces block. Freshness stamp markup (right side of toolbar, after the count spans at 1292-1303):

```tsx
{lastUpdated !== undefined && (
    <span
        className="text-xs tabular-nums text-muted-foreground data-[stale=true]:text-amber-600"
        data-stale={isStale(lastUpdated, Date.now())}
        title={lastUpdated ?? "freshness unknown"}
    >
        {lastUpdated ? `updated ${formatRelativeAge(lastUpdated, Date.now())}` : "freshness unknown"}
    </span>
)}
```

(Adapt class names to the file's existing utility patterns; never render a fake time.)

- [ ] **Step 4: Run to verify pass** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/jobs/page.tsx tests/e2e/jobs-first-screen.spec.ts
git commit -m "feat(jobs): trust toolbar — corpus-count placeholder, honest freshness stamp, fit sort"
```

---

### Task 7: Filter rail — promotion, More group, ghost toggle, 1024px threshold

**Files:**
- Modify: `src/components/jobs/FilterPanel.tsx` (props 84-101, `FilterState` 76-81, group order, ghost facet group at lines 12/18-23, `SALARY_PRESETS` stay as-is at 26-32)
- Modify: `src/app/jobs/page.tsx` (rail visibility region 1244-1253: `xl:` → `lg:`; pass new props; hidden-count fetch)
- Test: `tests/unit/jobs-filter-model.test.ts` + extend e2e

**Interfaces:**
- `FilterState` (FilterPanel.tsx:76-81) gains `hideGhosts: boolean` — this is THE shared model both rail (desktop) and sheet (mobile, Task 10) render; parity is enforced by unit-testing the model helpers, not the JSX.
- New exported helpers in FilterPanel.tsx (pure, for tests + Task 10-11 reuse):
  - `PROMOTED_GROUPS = ["posted", "work_type", "salary", "posting_health"] as const` and `MORE_FACETS: FacetKey[] = ["experience_level", "employment_type", "location_country", "source"]`
  - `activeFilterEntries(state: FilterState): { key: string; label: string; clear: (s: FilterState) => FilterState }[]` — one entry per active filter, used by chips (existing loop page.tsx:1254-1263), the sheet, and the empty state (Task 11).
- New FilterPanel props: `hideGhosts: boolean; onHideGhosts: (v: boolean) => void; ghostHiddenCount: number | null`.
- Ghost facet group ("Ghost-job risk") is REPLACED by the toggle row: label `Hide likely-ghost`, count suffix `−{ghostHiddenCount.toLocaleString()}` when non-null and > 0.
- Hidden count source (page side): after each search resolves with `hideGhosts: true`, issue one `searchJobsAction({ ...sameParams, hideGhosts: false, facets: { ...facets, ghost_badge: undefined }, limit: 1, withFacets: true })` and read `facetDistribution.ghost_badge["likely_ghost"] ?? 0`; skip when ghosts are shown.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/jobs-filter-model.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFilterEntries } from "../../src/components/jobs/FilterPanel";

const base = { facets: {}, salaryMin: 0, visaOnly: false, postedBucket: undefined, hideGhosts: true };

test("pristine state has no active entries (hideGhosts default is not 'active')", () => {
    assert.equal(activeFilterEntries(base).length, 0);
});

test("each active filter yields one clearable entry", () => {
    const s = { ...base, facets: { work_type: ["remote"] }, salaryMin: 150_000, postedBucket: "7d" as const };
    const entries = activeFilterEntries(s);
    assert.equal(entries.length, 3);
    const cleared = entries.reduce((acc, e) => e.clear(acc), s);
    assert.deepEqual(cleared, base);
});
```

- [ ] **Step 2: Run to verify fail** — `npx tsx tests/unit/jobs-filter-model.test.ts` → FAIL (no export)

- [ ] **Step 3: Implement** per Interfaces block: reorder JSX groups (Posted, Work type, Salary, Posting health, collapsible "More filters" with the rest), add the toggle row, export the helpers, extend props/state, switch `xl:` to `lg:` at page.tsx:1244-1253 (grep the file for other `xl:` occurrences tied to the rail/filters button), wire the hidden-count fetch.

- [ ] **Step 4: Run to verify pass** — `npx tsx tests/unit/jobs-filter-model.test.ts && npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/jobs/FilterPanel.tsx src/app/jobs/page.tsx tests/unit/jobs-filter-model.test.ts
git commit -m "feat(jobs): filter rail — promoted groups, hide-likely-ghost default ON with honest count, lg visibility"
```

---

### Task 8: Row badges + résumé upsell card

**Files:**
- Modify: `src/app/jobs/page.tsx` (`GHOST_META` 82-103, `GhostChip` 168-172, row meta 240-242, clear special-case 370, list render 1399-1404)
- Create: `src/components/jobs/ResumeUpsellCard.tsx`
- Test: extend `tests/e2e/jobs-first-screen.spec.ts`

**Interfaces:**
- Row badge contract (uses `formatRelativeAge` from Task 3): `clear` → `✓ live {formatRelativeAge(job.updated_at, now)}`; `caution` → `⚠ {daysOpen} days open` (daysOpen from `posted_ts`); `likely_ghost` → `✕ likely ghost` (only visible when ghosts shown); `unscored` → nothing (keep existing null behavior).
- `ResumeUpsellCard` props: `{ total: number | null; onUpload: () => void; onDismiss: () => void }`. Copy (verbatim, Global Constraints): `Upload your résumé to rank all {total?.toLocaleString() ?? ""} roles by fit — free`.
- Dismissal: localStorage key `intervu.jobs.upsell.dismissed` = `"1"`; card renders after the FIRST row only when not dismissed AND no usable résumé; `onUpload` queues the existing `"upload"` pending action (same as Task 6's fit path).

- [ ] **Step 1: Write the failing e2e tests**

```ts
// append to tests/e2e/jobs-first-screen.spec.ts
test("upsell card shows once and dismissal survives reload", async ({ page }) => {
    await page.goto("/jobs");
    const card = page.getByText("rank all", { exact: false });
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: /dismiss|✕/i }).first().click();
    await expect(card).not.toBeVisible();
    await page.reload();
    await expect(page.getByText("rank all", { exact: false })).not.toBeVisible();
});

test("clear rows carry a live badge with age", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByText(/✓ live (just now|\d+ (min|h|d)? ?ago)/).first()).toBeVisible();
});
```

- [ ] **Step 2: Run to verify fail** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts` → new tests FAIL

- [ ] **Step 3: Implement** — new component:

```tsx
// src/components/jobs/ResumeUpsellCard.tsx
"use client";

export function ResumeUpsellCard({ total, onUpload, onDismiss }: {
    total: number | null;
    onUpload: () => void;
    onDismiss: () => void;
}) {
    return (
        <div className="mx-2 my-1.5 flex items-center gap-3 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <button type="button" onClick={onUpload} className="flex-1 text-left text-primary hover:underline">
                ↑ Upload your résumé to rank all {total ? total.toLocaleString() : ""} roles by fit — free
            </button>
            <button type="button" aria-label="dismiss" onClick={onDismiss} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
    );
}
```

(Adapt utility classes to the design system used in surrounding components.) Wire into the list render (1399-1404) at index 0, gate on the dismissal key + `resumeIsUsable`. Update `GHOST_META`/`GhostChip`/row meta per the badge contract.

- [ ] **Step 4: Run to verify pass** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/jobs/ResumeUpsellCard.tsx src/app/jobs/page.tsx tests/e2e/jobs-first-screen.spec.ts
git commit -m "feat(jobs): live/caution/ghost row badges + dismissible resume upsell card"
```

---

### Task 9: Typeahead

**Files:**
- Modify: `src/components/search/SearchAutocomplete.tsx` (props 9-18)
- Modify: `src/lib/jobs/meilisearch.ts`, `src/lib/jobs/search.ts`, `src/actions/jobs.ts` (suggest path)
- Modify: `src/app/jobs/page.tsx` (replace bare Input at 1205-1213)
- Test: extend `tests/e2e/jobs-first-screen.spec.ts`

**Interfaces:**
- `SearchAutocomplete` gains optional `suggest?: (q: string) => Promise<SearchSuggestion[]>` (the `SearchSuggestion` type already used internally from `src/lib/search-suggestions.ts`). When provided, it replaces the local `getSuggestions` source; default behavior unchanged (the prep pages keep working without edits).
- New action: `suggestJobsAction(q: string): Promise<{ titles: string[]; companies: string[] }>` → lib `suggestJobs(q)` in search.ts → `fetchJobSuggestions(q)` in meilisearch.ts: ONE search call (`{ q, hitsPerPage: 20, attributesToRetrieve: ["title", "company"] }`), dedupe titles (case-insensitive, max 5) and companies (max 3) client-side. **No counts** — `company` is not a facet (FACETABLE_KEYS, types.ts:68-76), so counts aren't cheap; the spec explicitly allows degrading to plain suggestions.
- Debounce 150ms in the component; Enter always submits the raw text (suggestions are accelerants, never gates).

- [ ] **Step 1: Write the failing e2e test**

```ts
// append to tests/e2e/jobs-first-screen.spec.ts
test("typing shows suggestions; Enter searches without reload", async ({ page }) => {
    await page.goto("/jobs");
    const box = page.getByRole("textbox").first();
    await box.fill("engineer");
    await expect(page.getByRole("listbox").or(page.locator("[data-suggestions]"))).toBeVisible();
    const nav = page.waitForURL(/q=engineer/);
    await box.press("Enter");
    await nav; // URL updated client-side (no full navigation)
});
```

- [ ] **Step 2: Run to verify fail** — new test FAILS (no suggestions today)

- [ ] **Step 3: Implement** per Interfaces block. In page.tsx, swap the bare `Input` (1205-1213) for `SearchAutocomplete` with `value={query}`, `onChange`, `onSearch={() => applyUrlState({ ...current, q: query }, "push")}`, `suggest={(q) => suggestJobsAction(q).then(mapToSuggestions)}` where `mapToSuggestions` is a small mapper you write in page.tsx converting `{ titles, companies }` into the `SearchSuggestion` shape exported by `src/lib/search-suggestions.ts` (read that type first — do not guess its fields), and `placeholder` from Task 6.

- [ ] **Step 4: Run to verify pass** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/search/SearchAutocomplete.tsx src/lib/jobs/ src/actions/jobs.ts src/app/jobs/page.tsx tests/e2e/jobs-first-screen.spec.ts
git commit -m "feat(jobs): wire typeahead — title/company suggestions from the live index"
```

---

### Task 10: Mobile — chips row, sheet live count, detail sticky bar

**Files:**
- Create: `src/components/jobs/FilterChipsRow.tsx`
- Modify: `src/app/jobs/page.tsx` (mobile Filters button 1241-1253; mobile detail Sheet 1486-1495)
- Test: extend `tests/e2e/jobs-first-screen.spec.ts` (mobile viewport project)

**Interfaces:**
- `FilterChipsRow` props: `{ state: FilterState; distribution: FacetDistribution | undefined; activeCount: number; onPostedBucket: (v: PostedBucket | undefined) => void; onToggleFacet: (key: FacetKey, value: string) => void; onSalaryMin: (v: number) => void; onOpenSheet: () => void }` — same callback signatures as FilterPanel (FilterPanel.tsx:84-101), because both render the one `FilterState` model.
- Chips: `Posted ▾` (cycles Any → 1d → 3d → 7d → 30d → Any), `Remote` (toggles the `work_type` facet value that matches `/remote/i` among `distribution.work_type` keys — no hardcoded value string), `Salary ▾` (cycles SALARY_PRESETS), `All ({activeCount})` → `onOpenSheet`. Row is horizontal-scrollable, `lg:hidden`.
- Sheet apply button: local pending `FilterState` (not applied while toggling); a 250ms-debounced `searchJobsAction({ ...pendingParams, limit: 1 })` feeds `Show {total.toLocaleString()} roles`; tapping applies via `applyUrlState(..., "replace")` and closes.
- Mobile detail Sheet gains a sticky bottom bar with the existing `onOpenPosting` (Apply ↗) and `onPrep` (Prep for this) handlers (same props already passed at 1486-1495).

- [ ] **Step 1: Write the failing e2e tests**

```ts
// append to tests/e2e/jobs-first-screen.spec.ts
test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("chips row is visible and opens the sheet with a live count", async ({ page }) => {
        await page.goto("/jobs");
        await expect(page.getByText("All (", { exact: false })).toBeVisible();
        await page.getByText("All (", { exact: false }).click();
        await expect(page.getByRole("button", { name: /Show [\d,]+ roles/ })).toBeVisible();
    });

    test("sheet count matches applied result count", async ({ page }) => {
        await page.goto("/jobs");
        await page.getByText("All (", { exact: false }).click();
        const applyBtn = page.getByRole("button", { name: /Show [\d,]+ roles/ });
        const n = (await applyBtn.textContent())!.replace(/\D/g, "");
        await applyBtn.click();
        await expect(page.getByText(new RegExp(`${Number(n).toLocaleString()}|${n}`)).first()).toBeVisible();
    });

    test("system back closes detail and preserves scroll", async ({ page }) => {
        await page.goto("/jobs");
        await page.mouse.wheel(0, 1500);
        const y = await page.evaluate(() => window.scrollY);
        await page.locator("[data-testid=job-row], main li").nth(5).click();
        await page.goBack();
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(200);
    });
});
```

- [ ] **Step 2: Run to verify fail** — mobile tests FAIL

- [ ] **Step 3: Implement** per Interfaces block. The chips row renders between toolbar and list, `lg:hidden`; the existing mobile Filters button (1241-1253) is absorbed by the `All (n)` chip.

- [ ] **Step 4: Run to verify pass** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/jobs/FilterChipsRow.tsx src/app/jobs/page.tsx tests/e2e/jobs-first-screen.spec.ts
git commit -m "feat(jobs): mobile chips + live-count filter sheet + thumb-zone detail bar"
```

---

### Task 11: Empty states and the dead-link tombstone

**Files:**
- Modify: `src/app/jobs/page.tsx` (empty-list branch near the list render 1399-1408; selected-job resolution effect from Task 5)
- Test: extend `tests/e2e/jobs-first-screen.spec.ts`

**Interfaces:**
- Zero results: replaces the list when `hits.length === 0 && !loading`. Renders: `No roles match.` + one clear-chip per `activeFilterEntries(state)` (Task 7) + when `hideGhosts && ghostHiddenCount > 0`: `{n} roles hidden as likely-ghost — show them` (sets `hideGhosts: false` via `applyUrlState`).
- Tombstone: when the URL `job` id is not found in loaded hits after the first page resolves → the detail panel/sheet renders `This role is no longer available.` + similar roles via the already-imported `suggestAdjacentRolesAction` (page.tsx:39). Do NOT claim a takedown date — the data doesn't exist (verified: no per-job takedown timestamp is surfaced).
- Junk URL params: already dropped by `parseJobsUrl` (Task 1 unit tests); the next `applyUrlState` write cleans the address bar by construction.

- [ ] **Step 1: Write the failing e2e tests**

```ts
// append to tests/e2e/jobs-first-screen.spec.ts
test("zero results names the excluders and offers ghost reveal", async ({ page }) => {
    await page.goto("/jobs?q=zzzzunfindablezzz&salary=200k");
    await expect(page.getByText("No roles match.")).toBeVisible();
    await expect(page.getByText(/Clear/i).first()).toBeVisible();
});

test("dead job link shows an honest tombstone", async ({ page }) => {
    await page.goto("/jobs?job=nonexistent-id-12345");
    await expect(page.getByText("This role is no longer available.")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify fail** — new tests FAIL

- [ ] **Step 3: Implement** per Interfaces block.

- [ ] **Step 4: Run to verify pass** — `npx playwright test tests/e2e/jobs-first-screen.spec.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/jobs/page.tsx tests/e2e/jobs-first-screen.spec.ts
git commit -m "feat(jobs): honest empty states — excluder chips, ghost reveal, dead-link tombstone"
```

---

### Task 12: Full verification sweep

**Files:**
- Modify (only if failures surface): anything the sweep flags

- [ ] **Step 1: Run every unit test**

Run: `for f in tests/unit/*.test.ts; do npx tsx "$f" || exit 1; done`
Expected: all PASS (including pre-existing `jobs-sort`, `resume-match`, `pending-actions`, `encryption`)

- [ ] **Step 2: Run the full e2e suite**

Run: `npx playwright test`
Expected: all PASS — including pre-existing specs; `jobs-entry-gate.spec.ts` must be gone (deleted in Task 4)

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean build, no type errors

- [ ] **Step 4: Manual visual pass (drive the real app)**

Run: `npm run dev`, open `/jobs` at 1440px, 1100px, and 390px widths. Verify against the spec's Section 1/3 mockups: gate absent, rail visible at 1100px, chips on mobile, badges, upsell, freshness stamp. Screenshot each width into the PR.

- [ ] **Step 5: Commit any fixes, then push the branch**

```bash
git push -u origin feat/jobs-portal-redesign-phase1
```

Do NOT open a PR to main yet — the PR description must carry the ship gate note (jobs-sync repair pending) and Vivek decides ship timing.
