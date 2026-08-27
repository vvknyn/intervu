import { eventDate } from "@/components/company/CompanyChangeEvents";
import { eventTypeLabel } from "@/lib/companies/events";
import { isVerdictWindowSufficient, type HealthFacts } from "@/lib/companies/exhaust";

/**
 * Band 2 — "Are they actually hiring?" The health-review verdict, stated as
 * a sentence, with the observed score/repost-rate/status underneath as a
 * receipted number row. Renders nothing without a health section; the
 * verdict SENTENCE additionally requires ≥90 days of observation
 * (`isVerdictWindowSufficient`) — below that the numbers still render, but
 * with no verdict claim attached (a guessed verdict is worse than none).
 */
export function CompanyVerdictBand({
  health,
  nowMs,
}: {
  health: { data: HealthFacts; source: string; asOf: string } | null;
  nowMs: number;
}) {
  if (!health) return null;
  const { data, source, asOf } = health;

  const hasNumbers = data.score != null || data.repostRate != null || data.operatingStatus;
  const verdictLabel = data.verdict ? eventTypeLabel(data.verdict) : null;
  const showVerdict = verdictLabel && isVerdictWindowSufficient(data.observedSinceIso, nowMs);
  if (!showVerdict && !hasNumbers) return null;

  const asOfLabel = eventDate(asOf);

  return (
    <section data-testid="company-verdict-band" className="border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Are they actually hiring?
      </h2>
      {showVerdict && (
        <p className="mt-2 font-display text-[22px] font-bold leading-tight tracking-tight text-foreground sm:text-[24px]">
          {verdictLabel}.
        </p>
      )}
      {hasNumbers && (
        <div className="mt-4 grid grid-cols-2 gap-0 border border-border sm:grid-cols-3">
          {data.score != null && (
            <div className="border-b border-r border-border px-4 py-3 last:border-r-0 sm:border-b-0">
              <div className="font-display text-[22px] font-bold tabular-nums text-foreground">{data.score}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">health score</div>
            </div>
          )}
          {data.repostRate != null && (
            <div className="border-b border-r border-border px-4 py-3 last:border-r-0 sm:border-b-0">
              <div className="font-display text-[22px] font-bold tabular-nums text-foreground">
                {Math.round(data.repostRate * 100)}%
              </div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">roles reposted</div>
            </div>
          )}
          {data.operatingStatus && (
            <div className="px-4 py-3">
              <div className="font-display text-[18px] font-bold text-foreground">
                {eventTypeLabel(data.operatingStatus)}
              </div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">operating status</div>
            </div>
          )}
        </div>
      )}
      <p className="mono-data mt-3 text-[11px] text-muted-foreground">
        {source}
        {asOfLabel ? ` · updated ${asOfLabel}` : ""}
      </p>
    </section>
  );
}
