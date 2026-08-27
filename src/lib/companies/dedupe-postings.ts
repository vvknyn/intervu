import { decodeText, locationText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Collapses re-synced duplicate postings — the same role ingested twice
 * under a second id — to a single row, keyed on the same text a role row
 * itself displays (title + location) via `decodeText`/`locationText`, so
 * two rows a visitor can't tell apart never render as two. Order-preserving
 * (keeps the first occurrence), matching `dedupeNewsArticles`'s convention
 * for the same class of problem. The key is deliberately narrower than full
 * row equality: a minor field like `work_type` differing between the pair
 * (observed live — one copy discloses "Onsite", the duplicate omits it)
 * does not exempt them from collapsing.
 *
 * The ONE place this collapsing happens: `getCompanyPageData` (get-company.ts)
 * runs it once, server-side, right after the internal-postings filter, and
 * every downstream reader — the roles list, the open-role count, the
 * ghost-flagged share, the search box's own filtering — consumes that same
 * deduped array. It used to run a second time, client-only, inside
 * `CompanyRoleSearch` — which is exactly how a hero KPI (sourced upstream of
 * that component, pre-dedup) and the rendered role list (deduped inside it)
 * could disagree: Stewart's company page stated "66 open roles" while the
 * list under it rendered 62 rows, live. One array, computed once, removes
 * the seam a second computation could drift from.
 */
export function collapseDuplicatePostings(jobs: PublicJob[]): PublicJob[] {
  const seen = new Set<string>();
  const out: PublicJob[] = [];
  for (const job of jobs) {
    const key = `${decodeText(job.title).trim().toLowerCase()}\u0000${locationText(job).trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}
