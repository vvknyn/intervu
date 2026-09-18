import { eventDate } from "@/components/company/CompanyChangeEvents";
import { resolveFundingOrListingCell } from "@/lib/companies/exhaust";
import type { CompanyExhaust } from "@/lib/companies/exhaust";

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
 * with no value drops its own cell, never an "N/A") and to the band as a
 * whole (below two cells there is nothing worth a full-width band for, so
 * the band drops). Funding vs. SEC listing is mutually exclusive —
 * `resolveFundingOrListingCell` (exhaust.ts) is the one place that decides
 * which of the two a public filer shows.
 */
export function CompanyFactRow({ exhaust }: { exhaust: CompanyExhaust }) {
  const cells: FactCell[] = [];
  const profile = exhaust.profile?.data ?? null;

  if (profile?.yearFounded) {
    cells.push({
      key: "incorporated",
      label: "Founded",
      value: profile.organizationType
        ? `${profile.yearFounded} · ${profile.organizationType}`
        : String(profile.yearFounded),
      receipt: exhaust.profile!.label,
    });
  }

  if (profile?.nbEmployees) {
    cells.push({
      key: "headcount",
      label: "Headcount",
      value: `≈${profile.nbEmployees} people`,
      receipt: exhaust.profile!.label,
    });
  }

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
    if (f.latestFundingType) {
      parts.push(
        f.latestFundingYear
          ? `last round ${f.latestFundingType.replace(/_/g, " ")}, ${f.latestFundingYear}`
          : `last round ${f.latestFundingType.replace(/_/g, " ")}`,
      );
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

  if (cells.length < 2) return null;

  return (
    <section data-testid="company-fact-row" className="rounded-panel border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-xs font-semibold text-muted-foreground">On the record</h2>
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {cells.map((c) => (
          <div key={c.key} className="border border-border px-4 py-3">
            <div className="text-xs font-semibold text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{c.value}</div>
            <div className="mono-data mt-1 text-xs text-muted-foreground">{c.receipt}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
