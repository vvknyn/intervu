# Elite Company Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let seekers filter Find jobs to curated Elite companies, scan honest hiring counts on each card, run “Am I a fit?” into the existing tailor/prep/apply loop, then (milestone 2) open light company pages, hot-hiring ranks, and follow alerts.

**Architecture:** Board allowlists live in-repo JSON and become a Meilisearch `company_domain IN […]` filter. Optional denormalized `company_*` aggregate fields on job docs power the intel strip (UI omits when null). Fit is a SERP drawer that reuses `analyzeJobRequirements` + `generateTailoringRecommendations`. Company/follow surfaces mirror the pursuits guest-store + Firestore pattern.

**Tech Stack:** Next.js 16 App Router, Meilisearch, Firestore, existing tailor actions, Tailwind + current jobs SERP (`src/app/page.tsx`).

**Spec:** `docs/superpowers/specs/2026-07-29-elite-company-signal-design.md`  
**Mocks:** `docs/design/elite-company-signal/`

## Global Constraints

- Observations only: opened/closed/open counts + ghost share — never valuation/investors/Caplight.
- Ghost signal stays; company intel stacks with it, does not replace it.
- `company_domain` must be added to Meili `filterableAttributes` before board filter ships to prod index.
- Intel strip **omits** missing fields; never show fake `0/0` as if measured.
- First shippable milestone = Tasks 1–9 (A1+A2+A3). Tasks 10–16 are milestone 2 (A4+B).
- Locked decisions: route `/co/[slug]`; Remote stays `work_type` facet (not a board); alerts in-app only for v1; Elite seed target ~200–400 domains in `data/boards/elite-domains.json`.
- Do not build employer Hire marketplace.
- Commits are local feature-branch commits unless the user asks to push.

---

## File structure (create / modify)

| Path | Responsibility |
|---|---|
| `data/boards/elite-domains.json` | Curated Elite domain allowlist |
| `src/lib/boards/types.ts` | `BoardId`, board metadata types |
| `src/lib/boards/allowlists.ts` | Load board → domains[]; `isBoardId` |
| `src/lib/boards/slug.ts` | domain ↔ slug helpers |
| `src/lib/jobs/company-intel.ts` | Pure formatters for intel strip / omit rules |
| `src/lib/jobs/types.ts` | `board?` on params; optional aggregate fields on `PublicJob` |
| `src/lib/jobs/meilisearch.ts` | filterable `company_domain`; `buildFilter` board clause |
| `src/lib/jobs/search-payload.ts` | Pass `board` through |
| `src/lib/jobs/url-state.ts` | `board` in URL |
| `src/components/jobs/BoardChips.tsx` | Elite (and future) chips |
| `src/components/jobs/FitDrawer.tsx` | Am I a fit? panel |
| `src/components/jobs/CompanyIntelStrip.tsx` | Card footer strip |
| `src/app/page.tsx` | Wire chips, card CTAs, drawer; fix prep deep-link |
| `src/lib/companies/types.ts` | Company page DTO |
| `src/lib/companies/get-company.ts` | Aggregate + jobs-by-domain |
| `src/app/co/[slug]/page.tsx` | Light company page |
| `src/app/companies/hiring/page.tsx` | Hot companies rank |
| `src/lib/follows/guest-store.ts` | Guest follow localStorage |
| `src/lib/follows/types.ts` | Follow record |
| `src/actions/follows.ts` | Server follow CRUD + sync |
| `src/components/companies/FollowButton.tsx` | Follow UI |
| `src/lib/follows/alerts.ts` | Detect new roles for followed domains |
| `tests/unit/boards-*.test.ts`, `company-intel.test.ts`, `follows-guest-store.test.ts`, … | Unit coverage |
| `tests/e2e/elite-board.spec.ts` | Smoke E2E |

---

## Milestone 1 — SERP loop (A1 + A2 + A3)

### Task 1: Elite allowlist module

**Files:**
- Create: `data/boards/elite-domains.json`
- Create: `src/lib/boards/types.ts`
- Create: `src/lib/boards/allowlists.ts`
- Test: `tests/unit/boards-allowlists.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `BoardId`, `BOARD_META`, `getBoardDomains(boardId: BoardId): string[]`, `isBoardId(v: string): v is BoardId`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBoardDomains, isBoardId } from "@/lib/boards/allowlists";

describe("boards/allowlists", () => {
  it("accepts elite and rejects unknown", () => {
    assert.equal(isBoardId("elite"), true);
    assert.equal(isBoardId("nope"), false);
  });
  it("returns normalized lowercase domains for elite", () => {
    const domains = getBoardDomains("elite");
    assert.ok(domains.length >= 50);
    assert.ok(domains.every((d) => d === d.toLowerCase() && !d.includes("http")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/boards-allowlists.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

`data/boards/elite-domains.json` — JSON array of lowercase registrable domains (seed from a hand-picked subset of `data/job-boards-domains-all.txt` / known elite startups; ≥50 for tests, target 200–400 for product).

```ts
// src/lib/boards/types.ts
export type BoardId = "elite";
export const BOARD_META: Record<BoardId, { label: string; description: string }> = {
  elite: {
    label: "Elite startups",
    description: "Curated high-signal startups — editorial allowlist, not fundraising rank.",
  },
};
```

```ts
// src/lib/boards/allowlists.ts
import elite from "../../../data/boards/elite-domains.json";
import { BOARD_META, type BoardId } from "./types";

const LISTS: Record<BoardId, string[]> = {
  elite: (elite as string[]).map((d) => d.trim().toLowerCase()).filter(Boolean),
};

export function isBoardId(v: string): v is BoardId {
  return Object.prototype.hasOwnProperty.call(BOARD_META, v);
}

export function getBoardDomains(boardId: BoardId): string[] {
  return LISTS[boardId] ?? [];
}
```

Ensure `tsconfig` / Next can import JSON (already used elsewhere in repo — match that pattern; if JSON import fails, use `readFileSync` with path from `process.cwd()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/boards-allowlists.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add data/boards/elite-domains.json src/lib/boards/types.ts src/lib/boards/allowlists.ts tests/unit/boards-allowlists.test.ts
git commit -m "$(cat <<'EOF'
feat(boards): add Elite domain allowlist module

EOF
)"
```

---

### Task 2: Meilisearch board filter + types

**Files:**
- Modify: `src/lib/jobs/types.ts` (`JobSearchParams`, `PublicJob`)
- Modify: `src/lib/jobs/meilisearch.ts` (`JOBS_INDEX_SETTINGS.filterableAttributes`, `buildFilter`)
- Test: `tests/unit/jobs-filter.test.ts` (extend) or `tests/unit/jobs-board-filter.test.ts`

**Interfaces:**
- Consumes: `getBoardDomains` from Task 1
- Produces: `JobSearchParams.board?: BoardId`; `buildFilter` emits `company_domain IN [...]` when set; optional `PublicJob` aggregate fields typed but unused until Task 5

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFilter } from "@/lib/jobs/meilisearch";

describe("buildFilter board", () => {
  it("adds company_domain IN clause for elite", () => {
    const f = buildFilter({ board: "elite", hideGhosts: true });
    const clause = f.find((c) => c.startsWith("company_domain IN"));
    assert.ok(clause, `expected IN clause in ${JSON.stringify(f)}`);
    assert.ok(clause.includes("company_domain IN ["));
  });
  it("omits board clause when board unset", () => {
    const f = buildFilter({ hideGhosts: true });
    assert.ok(!f.some((c) => c.includes("company_domain")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/jobs-board-filter.test.ts`  
Expected: FAIL (board unknown / no clause)

- [ ] **Step 3: Write minimal implementation**

In `types.ts` add:

```ts
import type { BoardId } from "@/lib/boards/types";

// on PublicJob — optional until sync backfills:
company_opened_90d?: number | null;
company_closed_90d?: number | null;
company_open_count?: number | null;
company_stage?: string | null;

// on JobSearchParams:
board?: BoardId;
```

In `meilisearch.ts`:
- Add `"company_domain"` to `filterableAttributes`.
- At end of `buildFilter` (before return), if `p.board`:

```ts
if (p.board) {
  const { getBoardDomains } = require("@/lib/boards/allowlists") as typeof import("@/lib/boards/allowlists");
  // prefer static import at top of file instead of require
  const domains = getBoardDomains(p.board);
  if (domains.length > 0) {
    f.push(`company_domain IN [${domains.map((d) => JSON.stringify(d)).join(", ")}]`);
  }
}
```

**Ops note (not a code step):** after deploy, update the live Meili index settings so `company_domain` is filterable (same settings object already exported — run whatever reindex/settings sync this repo uses for `JOBS_INDEX_SETTINGS`). Until then, board searches 400 → surface unavailable like other filter mismatches.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/unit/jobs-board-filter.test.ts tests/unit/jobs-filter.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/types.ts src/lib/jobs/meilisearch.ts tests/unit/jobs-board-filter.test.ts
git commit -m "$(cat <<'EOF'
feat(jobs): filter Meilisearch by Elite board domains

EOF
)"
```

---

### Task 3: URL + search payload for `board`

**Files:**
- Modify: `src/lib/jobs/url-state.ts`
- Modify: `src/lib/jobs/search-payload.ts`
- Modify: `src/components/jobs/FilterPanel.tsx` only if `FilterState` must carry `board` — prefer keeping `board` on URL/page state separate from facet `FilterState` to avoid facet panel churn
- Test: `tests/unit/jobs-url-state.test.ts` (extend), `tests/unit/jobs-search-payload.test.ts` (extend)

**Interfaces:**
- Consumes: `isBoardId`, `BoardId`
- Produces: `JobsUrlState.board: BoardId | null`; `parseJobsUrl` / `serializeJobsUrl` round-trip `?board=elite`; `buildJobSearchPayload(..., board)` includes `board`

- [ ] **Step 1: Write failing URL round-trip test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJobsUrl, serializeJobsUrl, DEFAULT_URL_STATE } from "@/lib/jobs/url-state";

describe("url-state board", () => {
  it("round-trips board=elite", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, board: "elite" });
    const params = new URLSearchParams(url.startsWith("?") ? url.slice(1) : url);
    assert.equal(params.get("board"), "elite");
    const parsed = parseJobsUrl(params);
    assert.equal(parsed.board, "elite");
  });
  it("drops unknown board", () => {
    const parsed = parseJobsUrl(new URLSearchParams("board=nope"));
    assert.equal(parsed.board, null);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Add `board: BoardId | null` to `JobsUrlState` and `DEFAULT_URL_STATE` (`null`).  
Serialize only when non-null: `params.set("board", state.board)`.  
Parse with `isBoardId`.

Extend `buildJobSearchPayload` signature with `board: BoardId | null | undefined` and return `board: board ?? undefined`.

Update every `buildJobSearchPayload(...)` call site in `src/app/page.tsx` to pass current `board` from URL state (grep the four call sites mentioned in the file header comment).

- [ ] **Step 4: Run unit tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(jobs): persist board filter in URL and search payload

EOF
)"
```

---

### Task 4: Board chips UI on Find jobs

**Files:**
- Create: `src/components/jobs/BoardChips.tsx`
- Modify: `src/app/page.tsx` — render chips near results chrome; wire click → URL state
- Test: optional RTL not required; cover via E2E in Task 9. Unit-test pure toggle helper if extracted.

**Interfaces:**
- Consumes: `BOARD_META`, `JobsUrlState.board`
- Produces: visible Elite chip; selected = filled; click toggles board on/off

- [ ] **Step 1: Add `BoardChips` component**

```tsx
"use client";
import { BOARD_META, type BoardId } from "@/lib/boards/types";
import { cn } from "@/lib/utils"; // use repo's cn helper path

const ORDER: BoardId[] = ["elite"];

export function BoardChips({
  board,
  onChange,
}: {
  board: BoardId | null;
  onChange: (next: BoardId | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="board-chips">
      {ORDER.map((id) => {
        const on = board === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={`board-chip-${id}`}
            aria-pressed={on}
            onClick={() => onChange(on ? null : id)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium",
              on
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/80 hover:border-foreground/40",
            )}
          >
            {BOARD_META[id].label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `JobsContent`**

Place chips under the search / above `#jobs-results-list` (match mock `02-serp-elite.html` — not inside the heavy facet panel). On change, update URL state via existing serialize path so refresh keeps the board.

- [ ] **Step 3: Manual check**

Run: `npm run dev` → open `/?board=elite` → chip selected, results load (or unavailable if Meili settings not updated — acceptable with honest empty/unavailable UI).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(jobs): add Elite startups board chip on Find jobs

EOF
)"
```

---

### Task 5: Company intel pure formatters

**Files:**
- Create: `src/lib/jobs/company-intel.ts`
- Create: `src/components/jobs/CompanyIntelStrip.tsx`
- Test: `tests/unit/company-intel.test.ts`

**Interfaces:**
- Consumes: optional aggregate fields on `PublicJob`
- Produces: `formatCompanyIntel(job): string | null` — null means render nothing

- [ ] **Step 1: Failing tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCompanyIntel } from "@/lib/jobs/company-intel";

const base = { company_stage: null, company_opened_90d: null, company_closed_90d: null, company_open_count: null };

describe("formatCompanyIntel", () => {
  it("returns null when no observations", () => {
    assert.equal(formatCompanyIntel(base as any), null);
  });
  it("does not invent zeros for missing opened/closed", () => {
    assert.equal(formatCompanyIntel({ ...base, company_open_count: 18 } as any), "18 open roles");
  });
  it("formats full strip when counts present", () => {
    const s = formatCompanyIntel({
      company_stage: "Early-stage",
      company_opened_90d: 14,
      company_closed_90d: 3,
      company_open_count: 18,
    } as any);
    assert.equal(s, "Early-stage · Opened 14 / closed 3 in 90d · 18 open roles");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
export type CompanyIntelFields = {
  company_stage?: string | null;
  company_opened_90d?: number | null;
  company_closed_90d?: number | null;
  company_open_count?: number | null;
};

export function formatCompanyIntel(j: CompanyIntelFields): string | null {
  const parts: string[] = [];
  if (j.company_stage?.trim()) parts.push(j.company_stage.trim());
  const opened = j.company_opened_90d;
  const closed = j.company_closed_90d;
  if (typeof opened === "number" && typeof closed === "number") {
    parts.push(`Opened ${opened} / closed ${closed} in 90d`);
  }
  if (typeof j.company_open_count === "number") {
    parts.push(`${j.company_open_count} open roles`);
  }
  return parts.length ? parts.join(" · ") : null;
}
```

`CompanyIntelStrip` renders mono muted text or `null`.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(jobs): add honest company intel strip formatter

EOF
)"
```

**Sync contract (document in `src/lib/jobs/company-intel.ts` header comment):**  
Worker should set `company_opened_90d`, `company_closed_90d`, `company_open_count` per domain definitions in the spec. Until backfilled, strip stays hidden — product still ships.

---

### Task 6: Intel strip + fit affordance on JobCard

**Files:**
- Modify: `src/app/page.tsx` `JobCard` (~286–355)
- Use: `CompanyIntelStrip`, stopPropagation on fit button

**Interfaces:**
- Consumes: `formatCompanyIntel` / `CompanyIntelStrip`; parent handlers `onFit?(job)`, `onCompany?(job)`
- Produces: card shows strip when data exists; “Am I a fit?” button does not open detail

- [ ] **Step 1: Extend JobCard props**

```ts
onFit?: (job: PublicJob) => void;
onCompany?: (job: PublicJob) => void;
```

- [ ] **Step 2: UI additions under company line**

```tsx
{onFit && (
  <button
    type="button"
    data-testid="am-i-a-fit"
    className="mt-1 text-[12px] font-medium text-brand"
    onClick={(e) => { e.stopPropagation(); onFit(job); }}
  >
    Am I a fit?
  </button>
)}
<CompanyIntelStrip job={job} />
```

Make company name a button/link calling `onCompany` when provided (milestone 2 can navigate; for milestone 1 pass `undefined` or no-op).

- [ ] **Step 3: Pass `onFit` from `JobsContent`** (handler can be stub `setFitJob(job)` until Task 8)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(jobs): show company intel and Am I a fit on job rows

EOF
)"
```

---

### Task 7: Fit assessment mapping (reuse tailor)

**Files:**
- Create: `src/lib/jobs/fit-verdict.ts` (pure mapping)
- Create: `src/actions/job-fit.ts` (server action)
- Test: `tests/unit/fit-verdict.test.ts`

**Interfaces:**
- Consumes: `analyzeJobRequirements`, `generateTailoringRecommendations`, `fetchResumeData` (same as `TailorAnalysisSheet`)
- Produces:

```ts
export type FitVerdictLabel = "strong" | "stretch" | "weak";
export type FitAssessment = {
  verdict: FitVerdictLabel;
  matches: string[];
  gaps: string[];
  analysisId?: string;
};
export async function assessJobFitAction(input: {
  description: string;
  url?: string | null;
}): Promise<{ data?: FitAssessment; error?: string; needsAuth?: boolean; needsResume?: boolean }>
```

- [ ] **Step 1: Pure mapping tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verdictFromRecommendationCounts } from "@/lib/jobs/fit-verdict";

describe("verdictFromRecommendationCounts", () => {
  it("strong when matches dominate", () => {
    assert.equal(verdictFromRecommendationCounts({ match: 5, gap: 1 }), "strong");
  });
  it("stretch when mixed", () => {
    assert.equal(verdictFromRecommendationCounts({ match: 3, gap: 3 }), "stretch");
  });
  it("weak when gaps dominate", () => {
    assert.equal(verdictFromRecommendationCounts({ match: 1, gap: 4 }), "weak");
  });
});
```

Define thresholds in `fit-verdict.ts` (document numbers in comment). Map tailor recommendation items into `matches` / `gaps` strings (take up to 3 matches, 2 gaps).

- [ ] **Step 2: Implement `assessJobFitAction`**

Mirror auth/resume gates from `TailorAnalysisSheet` / credit-gate patterns:
- No session → `{ needsAuth: true }`
- No resume → `{ needsResume: true }`
- Else analyze → recommend → map → `{ data }`
- Swallow/credit errors into `{ error }`

- [ ] **Step 3: Unit tests for pure mapper PASS; action smoke optional**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(jobs): assess job fit via existing tailor analysis path

EOF
)"
```

---

### Task 8: FitDrawer component

**Files:**
- Create: `src/components/jobs/FitDrawer.tsx`
- Modify: `src/app/page.tsx` — state `fitJob`, render drawer

**Interfaces:**
- Consumes: `assessJobFitAction`, `PublicJob`, existing `handleTailor`, prep navigation, `markJobAppliedAction` / apply flow
- Produces: drawer UI per mock `03-fit-panel.html`

- [ ] **Step 1: Build drawer**

Use existing Sheet/Drawer primitive from the design system (same as job detail sheet). Props:

```ts
{
  job: PublicJob | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onTailor: () => void;
  onPrep: () => void;
  onApply: () => void;
}
```

On open + job set → call `assessJobFitAction`. Show loading, then verdict badge (Strong = green/live tokens, Stretch = warn, Weak = muted/danger), bullets, CTAs, footnote “Uses your active resume”.

Guest: show short teaser + existing login popover trigger (reuse page auth pattern).

- [ ] **Step 2: Wire page state**

```ts
const [fitJob, setFitJob] = useState<PublicJob | null>(null);
// JobCard onFit={setFitJob}
// FitDrawer open={!!fitJob} job={fitJob} ...
```

Prep CTA: `router.push(`/prep?company=...&position=...&round=Technical&searched=true`)` — **fix** any existing `handlePrep` that wrongly pushes `/?...` (see `page.tsx` ~1847).

- [ ] **Step 3: Manual — open fit on a job with resume signed in**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(jobs): Am I a fit drawer on Find jobs SERP

EOF
)"
```

---

### Task 9: Milestone 1 E2E smoke + logging

**Files:**
- Create: `tests/e2e/elite-board.spec.ts`
- Modify: search log entry builder if it should record `board` (extend `SearchLogEntry` when that module exists — optional, do not block)

- [ ] **Step 1: E2E**

```ts
import { test, expect } from "@playwright/test";

test("elite board chip toggles URL", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("board-chip-elite").click();
  await expect(page).toHaveURL(/board=elite/);
  await page.getByTestId("board-chip-elite").click();
  await expect(page).not.toHaveURL(/board=elite/);
});

test("am I a fit control is on rows when results exist", async ({ page }) => {
  await page.goto("/");
  const row = page.getByTestId("job-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByTestId("am-i-a-fit")).toBeVisible();
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test tests/e2e/elite-board.spec.ts`  
Expected: PASS (or skip gracefully if CI has no Meili — follow repo’s existing jobs e2e skip patterns)

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(e2e): smoke Elite board chip and fit affordance

EOF
)"
```

**Milestone 1 done** when Tasks 1–9 merge. Stop here for first PR series if desired.

---

## Milestone 2 — Company page + Tier B

### Task 10: Slug helpers + company fetch

**Files:**
- Create: `src/lib/boards/slug.ts`
- Create: `src/lib/companies/types.ts`
- Create: `src/lib/companies/get-company.ts`
- Create: `src/actions/companies.ts`
- Test: `tests/unit/company-slug.test.ts`

**Interfaces:**

```ts
export function domainToSlug(domain: string): string; // "rad-ai.com" → "rad-ai-com" or keep dots: prefer slugify that round-trips
export function slugToDomain(slug: string): string | null; // resolve via allowlist + open jobs lookup

export type CompanyPageData = {
  domain: string;
  slug: string;
  name: string;
  oneLiner: string | null;
  opened90d: number | null;
  closed90d: number | null;
  openCount: number;
  ghostFlaggedPct: number | null;
  jobs: PublicJob[];
  boards: BoardId[];
};
```

- [ ] **Step 1: Slug tests** (round-trip for domains in elite list)
- [ ] **Step 2: `getCompanyPageData(slug)`** — resolve domain; `searchJobsAction`/`searchMeili` with filter `company_domain = domain` (add single-domain support: either `board` unused + new `companyDomain?: string` on `JobSearchParams`, or reuse IN with one element). Prefer `JobSearchParams.companyDomain?: string` in `buildFilter`: `company_domain = ${JSON.stringify(domain)}`.
- [ ] **Step 3: Aggregates from first hit’s denormalized fields or count `jobs.length` for openCount fallback**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(companies): resolve company page data by domain slug

EOF
)"
```

---

### Task 11: `/co/[slug]` page

**Files:**
- Create: `src/app/co/[slug]/page.tsx`
- Create: `src/components/companies/CompanyHeader.tsx` (optional split)
- Modify: `src/app/page.tsx` — company name → `router.push(/co/${domainToSlug(...)})`
- Fix prep link on company page: `/prep?company=&position=&round=Technical&searched=true`

- [ ] **Step 1: Server component page** loading `getCompanyPageData`
- [ ] **Step 2: UI from mock `04-company-page.html`** — KPI strip, roles list, Follow placeholder button (wired Task 13), Open prep
- [ ] **Step 3: 404 when unknown slug / zero jobs and not in any board**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(companies): light company profile at /co/[slug]

EOF
)"
```

---

### Task 12: Hot companies page

**Files:**
- Create: `src/app/companies/hiring/page.tsx`
- Create: `src/lib/companies/hot-list.ts`
- Test: `tests/unit/hot-list.test.ts`

**Interfaces:**
- Rank companies with `company_opened_90d` descending among Elite domains (or all domains that have the field). Pure sort helper tested with fixtures.
- Page subtitle copy: “Ranked by roles opened in the last 90 days — not fundraising.”

- [ ] **Step 1: Pure sort test**
- [ ] **Step 2: Page UI from mock `05-hot-companies.html`**
- [ ] **Step 3: Nav entry** — discreet link from BoardChips area (“Companies hiring hard”) or TopBar only if product agrees; default: link from Elite chip overflow / footer of chips row
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(companies): hot hiring rank by opened-in-90d

EOF
)"
```

---

### Task 13: Follow guest store + server actions

**Files:**
- Create: `src/lib/follows/types.ts`
- Create: `src/lib/follows/guest-store.ts` (mirror `guest-store.ts` pursuits API)
- Create: `src/actions/follows.ts`
- Modify: `firestore.rules` — owner-only `users/{uid}/followedCompanies/{domain}`
- Test: `tests/unit/follows-guest-store.test.ts`

**Interfaces:**

```ts
export type FollowedCompany = {
  domain: string;
  slug: string;
  displayName: string;
  createdAt: string;
};

// guest-store
listGuestFollows(): FollowedCompany[];
addGuestFollow(input: Omit<FollowedCompany, "createdAt">): void;
removeGuestFollow(domain: string): void;
subscribeGuestFollows(cb: () => void): () => void;

// actions
followCompanyAction(...) / unfollowCompanyAction(...) / listFollowsAction()
syncGuestFollowsAction() // call on sign-in alongside pursuits sync
```

- [ ] **Step 1: Guest store tests (add/remove/subscribe)**
- [ ] **Step 2: Implement guest store + Firestore actions**
- [ ] **Step 3: Hook sync into existing auth/sign-in merge path** (`use-pursuits.ts` pattern — either extend that hook file’s sign-in effect or small `use-follows.ts`)
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(follows): guest + Firestore followed companies

EOF
)"
```

---

### Task 14: FollowButton + wire company page

**Files:**
- Create: `src/components/companies/FollowButton.tsx`
- Modify: `src/app/co/[slug]/page.tsx`
- Modify: hot list Follow column

- [ ] **Step 1: Button** toggles follow; optimistic UI; `data-testid="follow-company"`
- [ ] **Step 2: Wire**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(follows): Follow button on company and hot list

EOF
)"
```

---

### Task 15: In-app follow alerts (v1)

**Files:**
- Create: `src/lib/follows/alerts.ts`
- Create: `src/components/follows/FollowAlertsCard.tsx`
- Modify: `src/app/page.tsx` or TopBar — show card when `listNewRolesForFollows` nontempty
- Persist last-seen cursor: `localStorage` key `intervu.follows.alertCursor` ISO timestamp; signed-in copy on user doc optional later

**Interfaces:**

```ts
export async function listNewRolesForFollows(sinceIso: string): Promise<
  { domain: string; displayName: string; jobs: PublicJob[] }[]
>;
```

Implementation: for each followed domain, search `companyDomain` + `posted_ts`/`first_seen_at` after cursor (use existing posted filter or client filter on results). Cap domains checked (e.g. 20) to avoid fan-out abuse.

- [ ] **Step 1: Unit-test pure “group jobs by domain” helper**
- [ ] **Step 2: UI card from mock `06-boards-follow.html`**
- [ ] **Step 3: Clicking a row sets `board` or `q=company` / navigates to `/co/slug`**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(follows): in-app new-role alerts for followed companies

EOF
)"
```

---

### Task 16: Milestone 2 E2E + spec status

**Files:**
- Extend: `tests/e2e/elite-board.spec.ts` or `tests/e2e/company-follow.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-29-elite-company-signal-design.md` status → `approved` / `implemented` as appropriate

- [ ] **Step 1: E2E company page 404/200 + follow toggle (guest)**
- [ ] **Step 2: Run playwright subset**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(e2e): company page and follow smoke

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| A1 Elite board filter | 1–4 |
| A2 Intel strip | 5–6 |
| A3 Am I a fit | 7–8 |
| A4 Company page | 10–11 |
| B1 Hot companies | 12 |
| B2 Follow + alerts | 13–15 |
| B3 Extra boards | Deferred — only `elite` `BoardId` in v1; adding `ai` is copy of Task 1 JSON + `BOARD_META` entry |
| Phase 1.5 counts honesty | 5 + sync comment |
| No Hire / no valuation | Global constraints |
| Prep deep-link fix | 8, 11 |
| Analytics board_selected / fit_* | Optional follow-up — extend search log in Task 9 if `search-log.ts` present; else open issue, do not block |

## Placeholder scan

No TBD steps. Sync worker backfill is explicitly “UI omits until present,” not a blocked task.

## Type consistency

- `BoardId` = `"elite"` only in v1  
- `JobSearchParams.board?: BoardId`  
- `JobSearchParams.companyDomain?: string` added in Task 10  
- `FitVerdictLabel` = `strong | stretch | weak`  
- Follow keyed by `domain` string lowercase  

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-elite-company-signal.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

**Which approach?**

---

## Progress notes

- **2026-07-29 (re-review d16ada0):** Guest sync in-flight guard (`guestSyncInFlightRef`) on `page.tsx` and `yours/page.tsx` prevents parallel merge-at-sign-in runs. `usePursuits` shows pending guest rows while signed-in sync has not cleared localStorage, matching `useFollows`.
