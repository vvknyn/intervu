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
