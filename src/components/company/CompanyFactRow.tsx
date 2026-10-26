import { eventDate } from "@/lib/format";
import { resolveFundingOrListingCell } from "@/lib/companies/exhaust";
import type { CompanyExhaust } from "@/lib/companies/exhaust";
import { prettyEnum } from "@/lib/jobs/presentation";

interface FactCell {
  key: string;
  label: string;
  value: string;
  receipt: string;
}

function money(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

/**
 * Band 5 — "On the record": one small fact per enrichment source, each with
 * its own receipt. Rule 2 from the design freeze applies per-cell (a field
 * with no value drops its own cell, never an "N/A"), and the band drops when
 * no cell is left. It is a flat section now, so one fact no longer leaves a
 * half-empty grid. Funding vs. SEC listing is mutually exclusive —
 * `resolveFundingOrListingCell` (exhaust.ts) is the one place that decides
 * which of the two a public filer shows.
 */
export function CompanyFactRow({ exhaust }: { exhaust: CompanyExhaust }) {
  const cells: FactCell[] = [];

  // Founding year, organization type and headcount are not repeated here:
  // the header's facts row already states them from the same profile row.

  const fundingCell = resolveFundingOrListingCell({
    secListing: exhaust.secListing?.data ?? null,
    funding: exhaust.funding?.data ?? null,
  });
  if (fundingCell === "sec" && exhaust.secListing) {
    const sec = exhaust.secListing.data;
    const latestFiling = [sec.latest10kDate, sec.latest10qDate, sec.latest8kDate]
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();
    cells.push({
      key: "sec-listing",
      label: "SEC listing",
      value: latestFiling ? `Public filer · latest filing ${eventDate(latestFiling)}` : "Public filer",
      receipt: exhaust.secListing.label,
    });
  } else if (fundingCell === "funding" && exhaust.funding) {
    const f = exhaust.funding.data;
    const parts: string[] = [];
    if (f.latestFundingAmount != null) parts.push(`${money(f.latestFundingAmount)} total raised`);
    const round = prettyEnum(f.latestFundingType); // "series_c" -> "Series C"
    if (round) {
      parts.push(f.latestFundingYear ? `last round ${round}, ${f.latestFundingYear}` : `last round ${round}`);
    }
    if (parts.length > 0) {
      cells.push({ key: "funding", label: "Funding", value: parts.join(" · "), receipt: exhaust.funding.label });
    }
  }

  if (exhaust.govContracts?.data.totalAmount != null) {
    cells.push({
      key: "gov-contracts",
      label: "Federal contracts",
      value: `${money(exhaust.govContracts.data.totalAmount)} active`,
      receipt: exhaust.govContracts.label,
    });
  }

  if (cells.length === 0) return null;

  return (
    <section data-testid="company-fact-row" className="border-t border-border pt-6">
      <h2 className="text-base font-semibold leading-snug text-foreground">On the record</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {cells.map((c) => (
          <div key={c.key}>
            <dt className="text-sm text-muted-foreground">{c.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground">{c.value}</dd>
            <dd className="mono-data mt-0.5 text-xs text-muted-foreground">{c.receipt}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
