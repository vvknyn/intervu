import { daysOpenFrom } from "@/lib/jobs/badges";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * `posted_age_days` for a result event: whole days since the role was
 * posted. Returns `{}` when the row is unknown or has no posted date, so the
 * event never carries a fabricated 0.
 */
export function postedAgeAnalyticsProps(
  job: Pick<PublicJob, "posted_ts"> | null | undefined,
  nowMs: number = Date.now(),
): { posted_age_days: number } | Record<string, never> {
  const days = daysOpenFrom(job?.posted_ts ?? null, nowMs);
  return days === null ? {} : { posted_age_days: days };
}
