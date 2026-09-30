import type { ExhaustSection, IntegrityFacts } from "@/lib/companies/exhaust";
import { hiringRecordSentence } from "@/lib/companies/hiring-record";

/**
 * Band 6 (gated) — "How their postings behave": counts by `closed_reason`
 * over the trailing 90 days, plus how many roles opened in the same window.
 * `label` is already humanized (exhaust.ts reuses `eventTypeLabel`, the
 * same snake_case→words pattern `events.ts` uses for the ledger vocabulary)
 * — this component never re-derives copy from the raw `reason` string.
 * The summary sentence is `hiringRecordSentence`, the same one the rail's
 * hiring record prints, so the two can't disagree.
 */
export function CompanyIntegrityBand({
  integrity,
  nowMs,
}: {
  integrity: ExhaustSection<IntegrityFacts>;
  nowMs: number;
}) {
  if (!integrity) return null;
  const { closedReasonCounts, openedCount } = integrity.data;
  if (closedReasonCounts.length === 0 && openedCount === 0) return null;

  return (
    <section data-testid="company-integrity-band" className="border-t border-border pt-6">
      <h2 className="text-base font-semibold leading-snug text-foreground">
        How their postings behave
      </h2>
      <p data-testid="company-integrity-record" className="mt-2 text-sm leading-relaxed text-foreground">
        {hiringRecordSentence(integrity.data, nowMs)}
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
                  Count
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
      <p className="mono-data mt-3 text-xs text-muted-foreground">{integrity.label} · window 90 days</p>
    </section>
  );
}
