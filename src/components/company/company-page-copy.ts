/**
 * Small pure copy-builders for `/co/[slug]`'s consumer-first body (the
 * 2026-08-20 redesign — jobs first, plain language, one primary action).
 *
 * These would naturally sit beside `buildCompanyHiringAnswer` in
 * `lib/companies/presentation.ts` — same page, same "page file renders, this
 * decides" split that module's own docblock describes. They live here
 * instead only because this change is fenced to `src/app/co/**` and
 * `src/components/company/**`, and `lib/companies/presentation.ts` is out of
 * scope for this PR. Not a second copy of that module's pattern by choice —
 * just where the fence put it.
 */
import type { CompanyPageData } from "@/lib/companies/types";

/**
 * The ghost-flagged share as a plain sentence, e.g.
 * "9 of the 68 shown may no longer be live." — the old KPI tile rendered
 * this same share as a bare "13%"; this restates it as the count it was
 * always computed from, never a second, independently-drifting count.
 *
 * `ghostFlaggedPct` (get-company.ts's `ghostFlaggedPct(jobs)`) is always
 * `round(flagged / jobs.length * 100)` over the SAME fetched `jobs` window
 * this function reads `jobs.length` from — so the flagged count is always
 * recoverable from the two numbers the page already has, whether or not
 * that window happens to cover the employer's whole roster. Returns null
 * when there is no fetched window to state a share of (`ghostFlaggedPct` is
 * itself null whenever `jobs.length === 0`), rather than rendering a
 * sentence about zero roles nobody asked for.
 */
export function staleShareText(
  data: Pick<CompanyPageData, "ghostFlaggedPct" | "jobs">,
): string | null {
  if (data.ghostFlaggedPct == null || data.jobs.length === 0) return null;
  const count = Math.round((data.ghostFlaggedPct / 100) * data.jobs.length);
  return `${count} of the ${data.jobs.length} shown may no longer be live.`;
}
