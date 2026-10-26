import { checkFreshness, latestCheckAt } from "@/lib/jobs/badges";
import { isStaleClear } from "@/lib/jobs/presentation";
import type { GhostChecked } from "@/lib/jobs/types";
import { eventDate } from "@/components/company/CompanyChangeEvents";

/**
 * Company-level freshness, built from the SAME predicates the role rows use
 * (`checkFreshness`, `ghostMetaFor`), so a page-level "live right now" can
 * never be said over rows whose own badge says "Not recently verified".
 */

/** The newest check stamp over a window of rows, or null when none parses. */
export function newestCheckAt(jobs: readonly GhostChecked[]): string | null {
  let best: { ms: number; iso: string } | null = null;
  for (const job of jobs) {
    const iso = latestCheckAt(job);
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(ms) && (!best || ms > best.ms)) best = { ms, iso: iso as string };
  }
  return best?.iso ?? null;
}

export interface HiringFreshness {
  /** The newest check is current under `checkFreshness`; only then may copy say "live". */
  fresh: boolean;
  /** Human date of the newest check; null when the window carries no check stamp. */
  checkedOn: string | null;
}

export function hiringFreshness(checkedAt: string | null, nowMs: number): HiringFreshness {
  return {
    fresh: checkedAt !== null && checkFreshness({ ghost_badge: "unscored", ghost_checked_at: checkedAt }, nowMs) === "fresh",
    checkedOn: checkedAt ? eventDate(checkedAt) : null,
  };
}

/** Window rows whose row badge reads "Not recently verified". */
export function countNotRecentlyVerified(jobs: readonly GhostChecked[], nowMs: number): number {
  return jobs.filter((j) => isStaleClear(j, nowMs)).length;
}
