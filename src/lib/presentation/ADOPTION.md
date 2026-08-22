# Adoption plan — wave 3

This PR ships `src/lib/presentation/` as a **module + tests only**. Nothing in
the app imports it yet — three parallel PRs are already editing the surfaces
below (`src/app/jobs/page.tsx`, `src/app/co/**`, `JobDetail.tsx`,
`LaunchBanner.tsx`, `search-suggestions.ts`, `country-flag.ts`, TopBar/login),
so wiring this in now would collide with in-flight work. Wave 3 wires it in
once those land.

## Call sites

- **SERP `JobCard` (`src/app/jobs/page.tsx`'s row renderer).** Replace the
  row's own `locationText(job)` call with `presentJob(job).location` (already
  postal-stripped/breadcrumb-collapsed) and its raw `job.company` /
  `displayCompanyBrand` calls with `presentJob(job).company.name`. The row's
  ghost-badge chip stays on `rowTrustChip`/`badgeFor` (badges.ts) for now —
  those already encode staleness-aware wording that `STATUS_VOCABULARY`
  doesn't yet fold in (see the gap noted below).

- **`JobDetail.tsx`.** Swap the inline `cleanedCompany`/`companyBrand` +
  `"Unknown company"` ternary (around the header, near `jobCompanyHref`) for
  `presentJob(job).company` — this removes the ONE place that fallback string
  is duplicated outside `presentCompany`. Swap the `locationText(job)` call
  next to it for `presentJob(job).location`. The description pane keeps using
  `formatDescription` (format-description.ts) for the full structured render;
  `descriptionLede` is for previews only, not this surface.

- **`/co/[slug]` page — DONE.** Both role-row renderers (`CompanyRoleSearch`
  on `/co`, `CompanyRolesList` on `/companies/[slug]`) now call
  `companyRowMetaSegments` (`job.ts`, wraps `presentJob(job).location`) for
  their meta line instead of raw `locationText`. `.descriptionLede` is still
  unused on this page — there is no role-row description preview today.



- **Email digest (wherever the next digest-send job renders a `PublicJob`
  into copy — not yet built as of this PR).** Use `presentJob(job)` directly
  for title/company/location/salary, and `presentJob(job).status?.label` for
  the seeker-facing verdict word, so the email never re-derives its own copy
  from `ghost_badge` the way `GHOST_META`/`rowTrustChip` do independently
  today. This is the concrete case `STATUS_VOCABULARY`'s module doc means by
  "email copy convergence".

## Known gaps carried into wave 3

- `presentCompany` does not clean a leading bare country-code token + a
  dash-joined duplicate name in a second language (e.g. "CAN 3M Canada
  Company - Compagnie 3M Canada" from the 2026-08-20 audit) — verified
  unchanged through `displayCompanyBrand` today. See the "KNOWN GAP" doc
  comment in `company.ts` for why this PR doesn't invent a rule for it.
  Needs either a Subspace-side ingest fix or a rule validated against a
  corpus sample, not a single string.
- `presentJob`'s `status` field is derived from `ghost_badge` only — it does
  not fold in `classifyRelisted` (posting-freshness.ts), which needs a
  `nowMs` argument `presentJob(job)` doesn't take. Wave 3's SERP/JobDetail
  adoption should call `classifyRelisted` alongside `presentJob` and prefer
  `STATUS_VOCABULARY.relisted` when it fires, the same precedence
  `posting-freshness.ts`'s own doc already states ("relisted wins over
  fresh").
