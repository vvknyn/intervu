import { eventDate } from "@/components/company/CompanyChangeEvents";
import { buildH1bSentence, buildWarnSentence } from "@/lib/companies/exhaust";
import type { CompanyExhaust } from "@/lib/companies/exhaust";

interface FilingRow {
  key: string;
  date: string | null;
  record: string;
  sourceLabel: string;
}

/**
 * Band 9 (gated) — "The paper trail": SEC filings, federal contract awards,
 * and Form D funding filings, one row per record, each with its own date
 * and source, plus two sentence-grammar sub-sections for WARN Act layoff
 * notices and H-1B visa approvals — a coarser government-filing shape (a
 * notice count and a fiscal-year approval summary, not one row per record),
 * so they render as a count-sentence + mono receipt instead of table rows.
 */
export function CompanyFilingsBand({ exhaust }: { exhaust: CompanyExhaust }) {
  const rows: FilingRow[] = [];

  const sec = exhaust.secListing?.data;
  if (sec) {
    if (sec.latest10kDate) rows.push({ key: "10k", date: sec.latest10kDate, record: "Annual report (10-K)", sourceLabel: "SEC EDGAR" });
    if (sec.latestS1Date) rows.push({ key: "s1", date: sec.latestS1Date, record: "Registration statement (S-1)", sourceLabel: "SEC EDGAR" });
    if (sec.hasRestructuring8k) {
      rows.push({ key: "8k-restructuring", date: sec.latest8kDate, record: "Restructuring disclosure (8-K)", sourceLabel: "SEC EDGAR" });
    }
    if (sec.hasOfficerChange8k) {
      rows.push({ key: "8k-officer", date: sec.latest8kDate, record: "Officer change disclosure (8-K)", sourceLabel: "SEC EDGAR" });
    }
  }

  const funding = exhaust.funding?.data;
  if (funding?.formDCount) {
    const latestFormD = [...funding.formDDates].sort().pop() ?? null;
    rows.push({
      key: "form-d",
      date: latestFormD,
      record: `${funding.formDCount} Form D filing${funding.formDCount === 1 ? "" : "s"}`,
      sourceLabel: "SEC Form D",
    });
  }

  const gov = exhaust.govContracts?.data;
  if (gov?.awardCount) {
    rows.push({
      key: "gov-award",
      date: gov.latestAward,
      record: `${gov.awardCount} federal contract award${gov.awardCount === 1 ? "" : "s"}${gov.agencies.length > 0 ? ` — ${gov.agencies.slice(0, 2).join(", ")}` : ""}`,
      sourceLabel: "USAspending",
    });
  }

  const warn = exhaust.warnNotices;
  const h1b = exhaust.h1bLca;
  const warnAsOf = warn ? eventDate(warn.asOf) : null;

  if (rows.length === 0 && !warn && !h1b) return null;

  return (
    <section data-testid="company-filings-band" className="rounded-panel border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-xs font-semibold text-muted-foreground">
        The paper trail · {rows.length} record{rows.length === 1 ? "" : "s"}
      </h2>
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-border-strong pb-2 pr-3 text-left text-xs font-semibold text-muted-foreground">
                  Date
                </th>
                <th className="border-b border-border-strong pb-2 pr-3 text-left text-xs font-semibold text-muted-foreground">
                  Record
                </th>
                <th className="border-b border-border-strong pb-2 text-left text-xs font-semibold text-muted-foreground">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="mono-data whitespace-nowrap border-b border-border py-2 pr-3 text-muted-foreground">
                    {r.date ? eventDate(r.date) : "—"}
                  </td>
                  <td className="border-b border-border py-2 pr-3 text-foreground">{r.record}</td>
                  <td className="mono-data border-b border-border py-2 text-muted-foreground">{r.sourceLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warn && (
        <div className={rows.length > 0 ? "mt-6 border-t border-border pt-4" : "mt-4"}>
          <p className="text-sm leading-relaxed text-foreground">{buildWarnSentence(warn.data)}</p>
          {warn.data.recent.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {warn.data.recent.map((r, i) => (
                <li key={`${r.noticeDate ?? "notice"}-${i}`}>
                  {[
                    r.noticeDate ? eventDate(r.noticeDate) : null,
                    r.location,
                    r.employeesAffected != null ? `${r.employeesAffected} affected` : null,
                  ]
                    .filter((part): part is string => Boolean(part))
                    .join(" · ")}
                </li>
              ))}
            </ul>
          )}
          <p className="mono-data mt-3 text-xs text-muted-foreground">
            state warn portals (ca ny tx wa){warnAsOf ? ` · as of ${warnAsOf}` : ""}
          </p>
        </div>
      )}

      {h1b && (
        <div className={rows.length > 0 || Boolean(warn) ? "mt-6 border-t border-border pt-4" : "mt-4"}>
          <p className="text-sm leading-relaxed text-foreground">{buildH1bSentence(h1b.data)}</p>
          <p className="mono-data mt-3 text-xs text-muted-foreground">
            uscis h-1b employer hub · fy{h1b.data.fiscalYear}
          </p>
        </div>
      )}
    </section>
  );
}
