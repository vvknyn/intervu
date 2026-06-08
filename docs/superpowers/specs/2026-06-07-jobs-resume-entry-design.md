# Jobs section — resume-gated entry

**Date:** 2026-06-07
**Status:** Approved design, pre-implementation
**Area:** intervu.cc `/jobs`

## Problem

Today `/jobs` loads a newest-first list immediately. We want the entry to start
from the candidate, not the corpus: ask whether they want to tailor results to
their resume, then branch into a focused "match" view, an "explore adjacent
roles" view, or a plain search.

## Goals

1. On entry, ask the user if they want to upload their resume.
2. If yes → present two modes:
   - **Match** — roles that fit their resume.
   - **Explore** — adjacent / tangential roles they're well-positioned for.
3. If no → show an empty list and prompt them to search for a specific kind of
   role (with a quiet "browse all" escape so they're never on a dead-end).

## Non-goals

- Semantic / vector job matching. The search backend (Meilisearch) is
  keyword-only; "match" and "explore" become *derived queries + facet filters*,
  not a similarity rank. A real match-score engine is deferred.
- Auto-detecting country/city from the resume location string (unreliable
  against the `location_country` facet values). Not applied in v1.
- Changing the results list, detail panel, tailor, apply, or prep flows. Those
  are reused as-is.

## Grounding facts (verified this session)

- `experience_level` facet values are exactly `entry | mid | senior | unknown`
  (`src/lib/jobs/types.ts:28`). The seniority map targets those literals.
- `searchJobsAction({ q, facets, salaryMin, visaOnly, withFacets, limit, offset })`
  is the single search entry point (`src/actions/jobs.ts:9`). All modes feed it.
- `fetchResumeData()` returns the logged-in user's saved structured `ResumeData`
  (`profession`, `yearsOfExperience`, `competencies[]`) from Firebase `profiles`
  (`src/actions/resume.ts:12`).
- `ResumeImportModal` already does upload (PDF/DOCX/paste) → AI-parse → review →
  `onImport(data, source, confidence)` (`src/components/resume-builder/ResumeImportModal.tsx`).
- `generateGenericJSON(prompt, config?)` carries the login + credit gate
  (`chargeIfSharedKey`); it throws `AUTH_REQUIRED` / `OUT_OF_CREDITS` sentinels
  (`src/actions/generate-context.ts:590`). `classifySentinel` (already imported
  on the page) routes those to the `AuthPopover`.

## Entry state machine

```
            ┌─ saved resume? ─YES─→ [CHOOSE] ─Match──→ results (mode=match)
  open /jobs │                          └────Explore─→ results (mode=explore)
            └─ NO ─→ [ASK] ─"Yes, upload"→ ResumeImportModal ─parsed─→ [CHOOSE]
                       └──── "No, I'll search" ───────────────────→ results (mode=search)
```

- **[ASK]** — "Want to tailor results to your resume?" → `Yes, upload` /
  `No, I'll search`. Shown only when no saved resume and no remembered choice.
- **[CHOOSE]** — two option cards (**Match**, **Explore**) + quiet
  `↳ use a different resume` (re-opens the import modal).
- The active mode + resume-present flag persist in `localStorage`
  (`intervu.jobs.entry`) so navigating away and back doesn't re-gate. A
  `Start over` control clears it and returns to [ASK]/[CHOOSE].

## Mode 1 — Match (free, no AI)

`buildMatchQuery(resume: ResumeData): { q: string; facets: Partial<Record<FacetKey,string[]>> }`
in new `src/lib/jobs/resume-match.ts`:

- `q = resume.profile.profession` (the role title; trimmed; empty → no q).
- `facets.experience_level` from `yearsOfExperience`:
  `0–2 → ["entry"]`, `3–6 → ["mid"]`, `7+ → ["senior"]`. Omitted if years is 0/unknown.
- Result is rendered as the existing editable filter chips + search box, so the
  user sees and can adjust the derived query. Pure + synchronous; spends nothing.

## Mode 2 — Explore (one AI credit)

New `suggestAdjacentRolesAction(resume: ResumeData): Promise<{ titles?: string[]; error?: string }>`
in `src/actions/jobs.ts`, calling `generateGenericJSON`:

- Prompt: given `profession` + top skills (`competencies`) + seniority, return
  **6–8 adjacent job titles** the person is well-positioned for but might not
  search themselves. JSON: `{ "titles": ["…", …] }`.
- Build `q = titles.join(" ")` and feed `searchJobsAction`. Titles render as
  clickable chips ("Exploring: Platform Eng · DevEx · …"); clicking one narrows
  `q` to that single title.
- **Fallbacks:**
  - AI returns nothing / malformed → deterministic broaden: `q` = top skills
    only (no title/seniority), + a toast noting it couldn't suggest adjacencies.
  - `OUT_OF_CREDITS` / `AUTH_REQUIRED` (via `classifySentinel`) → open
    `AuthPopover`; do not silently swallow.

## Mode 3 — Search-only (no resume)

- When `mode === "search"` **and the query is empty**, render an empty-state
  prompt ("Search for the kind of role you want — e.g. 'staff product designer,
  remote'") and **do not fetch**. The debounced search effect fires only once the
  user types a non-empty query.
- A quiet `or browse all live roles →` link switches to `mode = "browse"`, which
  restores today's behavior (empty query → newest-first auto-load).

## Components & files

**New**
- `src/lib/jobs/resume-match.ts` — `buildMatchQuery`, `seniorityFromYears`,
  `buildExploreBroadenQuery` (the deterministic fallback). Pure, unit-testable.
- `src/components/jobs/JobsEntryGate.tsx` — the [ASK] and [CHOOSE] screens
  (presentational; receives callbacks). Keeps the gate out of the 858-line page.

**Changed**
- `src/actions/jobs.ts` — add `suggestAdjacentRolesAction`.
- `src/app/jobs/page.tsx` — add the gate `mode` state, gate vs results rendering,
  suppress auto-fetch until a mode is active, wire `ResumeImportModal` /
  `fetchResumeData` / `AuthPopover` (latter two/modal already imported elsewhere).

**Reused unchanged**
- `ResumeImportModal`, `fetchResumeData`, `searchJobsAction`, `AuthPopover`,
  `FilterPanel`, `JobRow` / `JobDetail`, `TailorAnalysisSheet`, `classifySentinel`.

## Behavior change to call out

The current page auto-loads newest-first on mount. After this change, the first
fetch is deferred until a mode resolves (match/explore/browse set a query;
search waits for typing). Returning users with a remembered mode skip the gate
and fetch immediately.

## Edge cases / QA

- Logged-out + "Yes, upload" → `AuthPopover` first, then the import modal (the
  AI parse needs login). Match & Explore both depend on a resume anyway.
- `fetchResumeData()` error or empty → fall back to the [ASK] screen.
- Explore with no/low resume skills → still attempt AI; on empty result use the
  skills/profession broaden fallback.
- Mode is always overridable: the search box and filter chips stay visible in
  every results mode, so typing overrides any derived query.
- `Start over` / `use a different resume` must clear `localStorage` mode and the
  in-memory query/facets together (no stale chips).

## Testing

- Unit: `buildMatchQuery` seniority boundaries (2/3, 6/7), empty profession,
  empty years; `buildExploreBroadenQuery` skill extraction.
- Manual (Playwright-style, per repo convention — no vitest): the four entry
  paths (saved-resume→choose, no-resume→ask→upload→choose, no-resume→search,
  browse escape), plus Explore credit-exhausted → AuthPopover.

## Open / deferred

- Per-title Explore drill-down beyond a single chip narrow (e.g. grouped lanes).
- True semantic match once an embedding/score engine exists.
- Country/city facet derivation from resume location.
