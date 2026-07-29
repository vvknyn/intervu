/**
 * Company intel strip — honest formatters for denormalized aggregate fields on
 * `PublicJob`.
 *
 * Sync contract: the off-repo worker should set `company_opened_90d`,
 * `company_closed_90d`, and `company_open_count` per domain definitions in
 * docs/superpowers/specs/2026-07-29-elite-company-signal-design.md:
 *   - Opened 90d: distinct roles first-seen in the last 90 days for that domain.
 *   - Closed 90d: distinct roles that disappeared in the last 90 days.
 *   - Open roles: currently live count.
 * Until backfilled, `formatCompanyIntel` returns null and the strip stays hidden
 * — product still ships.
 */

export type CompanyIntelFields = {
  company_stage?: string | null;
  company_opened_90d?: number | null;
  company_closed_90d?: number | null;
  company_open_count?: number | null;
};

export type CompanyIntelSegment = {
  text: string;
  /** Mock `.intel-hot` — stage + high velocity openings. */
  hot?: boolean;
};

/** Threshold for highlighting opened-90d in the elite intel footer. */
export const INTEL_OPENED_HOT_MIN = 10;

export function companyIntelSegments(j: CompanyIntelFields): CompanyIntelSegment[] {
  const segs: CompanyIntelSegment[] = [];
  const stage = j.company_stage?.trim();
  if (stage) segs.push({ text: stage, hot: true });
  const opened = j.company_opened_90d;
  const closed = j.company_closed_90d;
  if (typeof opened === "number" && typeof closed === "number") {
    segs.push({
      text: `Opened ${opened} / closed ${closed} in 90d`,
      hot: opened >= INTEL_OPENED_HOT_MIN,
    });
  }
  if (typeof j.company_open_count === "number") {
    segs.push({ text: `${j.company_open_count} open roles` });
  }
  return segs;
}

export function formatCompanyIntel(j: CompanyIntelFields): string | null {
  const segs = companyIntelSegments(j);
  return segs.length ? segs.map((s) => s.text).join(" · ") : null;
}
