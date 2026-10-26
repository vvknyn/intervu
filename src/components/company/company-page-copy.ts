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
import { countNotRecentlyVerified } from "@/lib/companies/freshness";
import { openCountText, sampleCoversAllRoles } from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";

/**
 * The ghost-flagged share as a plain sentence, e.g.
 * "9 of the 68 roles tracked here may no longer be live." — the old KPI
 * tile rendered this same share as a bare "13%"; this restates it as the
 * count it was always computed from, never a second, independently-drifting
 * count.
 *
 * "roles tracked here", not "shown": only `ROLES_PREVIEW` (10) rows actually
 * render on the page (CompanyRoleSearch), so "shown" overclaimed the M side
 * of the ratio for any employer with more than 10 fetched roles — the
 * fetched `jobs` window (up to `COMPANY_JOBS_FETCH_LIMIT`) this page
 * tracked, not what rendered on screen.
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
  data: Pick<CompanyPageData, "ghostFlaggedPct" | "jobs" | "openCount" | "openCountIsLowerBound" | "nowMs">,
): string | null {
  if (data.ghostFlaggedPct == null || data.jobs.length === 0) return null;
  const count = Math.round((data.ghostFlaggedPct / 100) * data.jobs.length);
  const unverified = countNotRecentlyVerified(data.jobs, data.nowMs);
  // The denominator is the page's one open-roles number. A window that is only a sample of it states
  // the flagged count of the loaded roles without naming the window's size as a second count.
  const tracked = sampleCoversAllRoles(data) ? `the ${openCountText(data)} roles` : "the newest roles";
  const sentences = [
    count > 0 && `${count} of ${tracked} tracked here may no longer be live.`,
    unverified > 0 && `${unverified} of ${tracked} ${unverified === 1 ? "is" : "are"} not recently verified.`,
  ].filter(Boolean);
  return sentences.length > 0 ? sentences.join(" ") : `None of ${tracked} are flagged as possibly stale.`;
}

/**
 * The question above the role list for a visitor with no résumé on hand
 * (`CompanyFitPrompt`), short enough to share a phone's row with its button;
 * the company is named in the header right above it. The count is the roles
 * the résumé would be scored against, every loaded role, and says "newest"
 * when those are only the most recent ones, the same split `roleFitStat`
 * makes for its answer.
 */
export function fitPromptTitle(loadedCount: number, partialWindow: boolean): string {
  if (partialWindow) return `Which of the ${loadedCount} newest roles here fit you?`;
  return loadedCount === 1 ? "Does this open role fit you?" : `Which of these ${loadedCount} roles fit you?`;
}

/** The prompt's line under the question: what adding a résumé does here,
 *  and where it is kept (`resumeImportStorageNote` says the same in the
 *  importer). Only an account with paid time has it saved; every other résumé, a signed-in one's too, stays on this device. */
export function fitPromptBody(savedToAccount: boolean): string {
  const what = "Add your résumé to see how well each role here fits you, and why.";
  return savedToAccount ? `${what} It's saved to your account, encrypted.` : `${what} It stays in this browser.`;
}
