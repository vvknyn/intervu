import { eventDate } from "@/components/company/CompanyChangeEvents";
import { KpiStat } from "@/components/jobs/JobDetail";
import { eventTypeLabel } from "@/lib/companies/events";
import { isVerdictWindowSufficient, type ExhaustSection, type HealthFacts } from "@/lib/companies/exhaust";

/** "Active" is true of every employer with live roles, so it says nothing;
 *  only a status a visitor would want to know (acquired, closed) is shown. */
function unusualStatus(status: string | null): string | null {
  return status && !/^active$/i.test(status.trim()) ? eventTypeLabel(status) : null;
}

/**
 * Band 2 — the latest health review, as supporting evidence under the
 * header's answer rather than a second answer to "Are they hiring?".
 *
 * The header answers from today's live count; this review is days or weeks
 * old, and when the two disagreed the page argued with itself. So the
 * review's verdict is a dated line, not a headline, and it still needs ≥90
 * days of observation (`isVerdictWindowSufficient`). The health score is not
 * shown: nothing in the repo defines its inputs or range, so a reader
 * cannot tell a good score from a bad one. Stats use the job page's
 * `KpiStat`, which has no grid cells to leave empty when one is missing.
 */
export function CompanyVerdictBand({
  health,
  nowMs,
}: {
  health: ExhaustSection<HealthFacts>;
  nowMs: number;
}) {
  if (!health) return null;
  const { data, label, asOf } = health;

  const status = unusualStatus(data.operatingStatus);
  const verdict =
    data.verdict && isVerdictWindowSufficient(data.observedSinceIso, nowMs) ? eventTypeLabel(data.verdict) : null;
  if (!verdict && data.repostRate == null && !status) return null;

  const asOfLabel = eventDate(asOf);

  return (
    <section data-testid="company-verdict-band" className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] px-6 py-6 sm:px-8">
      <h2 className="text-xs font-semibold text-muted-foreground">Latest hiring review</h2>
      {verdict && (
        <p data-testid="company-verdict-line" className="mt-2 text-sm leading-relaxed text-foreground">
          {asOfLabel ? `Velai's review on ${asOfLabel}: ` : "Velai's latest review: "}
          {verdict.toLowerCase()}.
        </p>
      )}
      {(data.repostRate != null || status) && (
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          {data.repostRate != null && (
            <KpiStat value={`${Math.round(data.repostRate * 100)}%`} label="of roles reposted" />
          )}
          {status && <KpiStat value={status} label="operating status" />}
        </div>
      )}
      <p className="mono-data mt-3 text-xs text-muted-foreground">
        {label}
        {asOfLabel ? ` · updated ${asOfLabel}` : ""}
      </p>
    </section>
  );
}
