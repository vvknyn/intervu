import { eventDate } from "@/components/company/CompanyChangeEvents";
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
 * and source. Built only from the verified `sec_filing_summary`,
 * `government_contract`, and `funding` payload keys (contract.md) — no WARN
 * / OSHA rows, since those data types aren't in the verified exhaust schema
 * yet and this page never renders an invented record.
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

  if (rows.length === 0) return null;

  return (
    <section data-testid="company-filings-band" className="border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        The paper trail · {rows.length} record{rows.length === 1 ? "" : "s"}
      </h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr>
              <th className="border-b border-border-strong pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Date
              </th>
              <th className="border-b border-border-strong pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Record
              </th>
              <th className="border-b border-border-strong pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
    </section>
  );
}
