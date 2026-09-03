import type { IntegrityFacts } from "@/lib/companies/exhaust";

/**
 * Band 6 (gated) — "How their postings behave": counts by `closed_reason`
 * over the trailing 90 days, plus how many roles opened in the same window.
 * `label` is already humanized (exhaust.ts reuses `eventTypeLabel`, the
 * same snake_case→words pattern `events.ts` uses for the ledger vocabulary)
 * — this component never re-derives copy from the raw `reason` string.
 */
export function CompanyIntegrityBand({
  integrity,
}: {
  integrity: { data: IntegrityFacts; source: string; asOf: string } | null;
}) {
  if (!integrity) return null;
  const { closedReasonCounts, openedCount } = integrity.data;
  if (closedReasonCounts.length === 0 && openedCount === 0) return null;

  const closedTotal = closedReasonCounts.reduce((sum, r) => sum + r.count, 0);

  return (
    <section data-testid="company-integrity-band" className="border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-xs font-semibold text-muted-foreground">
        How their postings behave
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground">
        {closedTotal} role{closedTotal === 1 ? "" : "s"} closed in the last 90 days
        {openedCount > 0 ? `; ${openedCount} opened in the same window.` : "."}
      </p>
      {closedReasonCounts.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-border-strong pb-2 pr-3 text-left text-xs font-semibold text-muted-foreground">
                  How roles closed (90 days)
                </th>
                <th className="border-b border-border-strong pb-2 text-right text-xs font-semibold text-muted-foreground">
                  count
                </th>
              </tr>
            </thead>
            <tbody>
              {closedReasonCounts.map((r) => (
                <tr key={r.reason}>
                  <td className="border-b border-border py-2 pr-3 text-foreground">{r.label}</td>
                  <td className="mono-data border-b border-border py-2 text-right text-foreground">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mono-data mt-3 text-xs text-muted-foreground">{integrity.source} · window 90 days</p>
    </section>
  );
}
