import React from "react";
import { TrendUp, TrendDown, Minus } from "@phosphor-icons/react/dist/ssr";
import { eventTypeLabel } from "@/lib/companies/events";
import type { CompanyChangeEvent } from "@/lib/companies/types";
import { cn } from "@/lib/utils";

/**
 * "Aug 15, 2026" from an ISO-8601 stamp — same rules as the news card's
 * `articleDate` (always show the year; render in UTC so a viewer-local render
 * can't roll the date back a day). Returns null on an unparseable stamp so the
 * caller omits the line instead of printing "Invalid Date".
 *
 * The year matters more here than anywhere else on the page: "hiring has
 * stalled" reads as a statement about *now*, and a bare "Aug 15" on a
 * two-year-old freeze would be the page's most misleading line.
 */
function eventDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Direction drives the only colour on the row. `improving`/`declining` are
 *  the ledger's own words for "good for a jobseeker" / "bad for one"; anything
 *  else is drawn neutral rather than guessed at. */
function directionStyle(direction: CompanyChangeEvent["direction"]): {
  Icon: typeof TrendUp;
  chip: string;
  icon: string;
} {
  switch (direction) {
    case "improving":
      return { Icon: TrendUp, chip: "border-brand/20 bg-brand/10 text-brand", icon: "text-brand" };
    case "declining":
      return {
        Icon: TrendDown,
        chip: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        icon: "text-amber-600 dark:text-amber-400",
      };
    default:
      return { Icon: Minus, chip: "border-border bg-chip text-muted-foreground", icon: "text-muted-foreground" };
  }
}

/**
 * Observed changes in how this company is hiring — Subspace's change-event
 * ledger, scoped to one employer.
 *
 * Renders NOTHING when there are no events. That is the same rule the news
 * card follows and it is the whole point: an empty ledger means we have not
 * observed a change worth reporting, and the honest rendering of "no observed
 * change" is silence, not a reassuring placeholder. The caller must not wrap
 * this in a heading of its own, or the heading would survive the empty case
 * and re-introduce exactly that.
 *
 * Every line here is a FACT the pipeline measured (posting velocity across two
 * 14-day windows, SEC filings, WARN notices), never an inference about intent
 * — the headline text is the projector's, rendered verbatim.
 */
export function CompanyChangeEvents({
  events,
  companyName,
}: {
  events: CompanyChangeEvent[];
  companyName: string;
}) {
  if (events.length === 0) return null;

  return (
    <section data-testid="company-change-events" className="mb-8">
      <h2 className="mb-1 font-display text-[20px] font-semibold">Recent changes</h2>
      <p className="mb-4 font-mono text-[11px] text-muted-foreground">
        Observed shifts in {companyName}&apos;s hiring, from postings we track over time.
      </p>

      <ul className="space-y-2.5">
        {events.map((event, idx) => {
          const { Icon, chip, icon } = directionStyle(event.direction);
          const label = eventTypeLabel(event.event_type);
          const date = eventDate(event.occurred_at);
          return (
            // occurred_at alone is not unique (the hourly projector can emit
            // two events for one company in the same run), so the index is
            // folded in — the list is server-rendered and never reordered.
            <li
              key={`${event.event_type}-${event.occurred_at}-${idx}`}
              className="flex items-start gap-3.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-xs"
            >
              <Icon size={18} weight="bold" className={cn("mt-0.5 shrink-0", icon)} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {label && (
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
                        chip,
                      )}
                    >
                      {label}
                    </span>
                  )}
                  {date && <span className="font-mono text-[11px] text-muted-foreground">{date}</span>}
                </div>
                <p className="mt-1.5 text-[15px] leading-snug text-foreground">{event.headline}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
