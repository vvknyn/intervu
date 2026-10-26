import React from "react";
import { SectionTitle } from "@/components/ui/heading";
import { eventTypeLabel, humanizeProjectorHeadline } from "@/lib/companies/events";
import type { CompanyChangeEvent, CompanyChangeEventEvidence } from "@/lib/companies/types";
import { eventDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "14 May – 11 Jun 2026" from two calendar dates. Rendered in UTC and parsed
 *  from the plain `YYYY-MM-DD` the API sends, so the window a reader sees is
 *  the window that was measured — not one shifted by their timezone. */
function windowText(w: { start: string; end: string }): string | null {
  const s = Date.parse(`${w.start}T00:00:00Z`);
  const e = Date.parse(`${w.end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const fmt = (ms: number, withYear: boolean) =>
    new Date(ms).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    });
  const sameYear = new Date(s).getUTCFullYear() === new Date(e).getUTCFullYear();
  return `${fmt(s, !sameYear)} – ${fmt(e, true)}`;
}

/**
 * The proof under the claim.
 *
 * This is the part that was missing: a card read "hiring is accelerating" with
 * nothing under it, while the numbers that produced that sentence sat unread in
 * the event's payload. A claim on this page now shows its arithmetic, the
 * window it was measured over, and — where the observation came from outside
 * our own crawl — a link to the source document.
 *
 * Renders nothing at all when there is nothing to show. An "evidence" block
 * with no evidence in it would be worse than the bare card it replaced.
 */
function EventEvidence({ evidence }: { evidence: CompanyChangeEventEvidence }) {
  const window = evidence.window ? windowText(evidence.window) : null;
  const hasFooter = Boolean(window || evidence.provenance || evidence.sourceUrl);
  if (evidence.metrics.length === 0 && !hasFooter) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      {evidence.metrics.length > 0 && (
        <dl className="space-y-1.5">
          {evidence.metrics.map((m) => (
            <div key={m.label} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <dt className="min-w-21 text-xs text-muted-foreground">
                {m.label}
              </dt>
              <dd className="text-xs tabular-nums text-foreground">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {hasFooter && (
        <p
          className={cn(
            "text-xs text-muted-foreground",
            evidence.metrics.length > 0 && "mt-2.5",
          )}
        >
          {window && <>Measured {window}</>}
          {window && evidence.provenance && " · "}
          {evidence.provenance}
          {evidence.sourceUrl && (
            <>
              {(window || evidence.provenance) && " · "}
              <a
                href={evidence.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2 hover:text-foreground"
              >
                source
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Direction drives the only colour on the row. `improving`/`declining` are
 *  the ledger's own words for "good for a jobseeker" / "bad for one" — the
 *  same favorable/caution vocabulary every other verdict on the site reads
 *  off `--verdict-good`/`--verdict-caution` (see `Badge`'s `verdict-good` /
 *  `verdict-caution` variants); anything else is drawn neutral rather than
 *  guessed at. Colour is a signal here, not decoration, so it can never be
 *  brand blue (that's reserved for interactive elements) or a hardcoded hue.
 *  Status is the coloured word itself, with no arrow icon beside it. */
export function directionStyle(direction: CompanyChangeEvent["direction"]): {
  /** Word color for the event-type label — status reads as a plain colored
   *  word, never a bordered/filled pill (rulebook: status = words). */
  label: string;
} {
  switch (direction) {
    case "improving":
      return { label: "text-verdict-good" };
    case "declining":
      return { label: "text-verdict-caution" };
    default:
      return { label: "text-muted-foreground" };
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
 * — the headline text is the projector's, content-verbatim, with only its
 * snake_case enum typography normalized via `humanizeProjectorHeadline`.
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
      <SectionTitle className="mb-1">Recent changes</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Observed shifts in {companyName}&apos;s hiring, from postings we track over time.
      </p>

      <ul className="mt-2">
        {events.map((event, idx) => {
          const { label: tone } = directionStyle(event.direction);
          const label = eventTypeLabel(event.event_type);
          const date = eventDate(event.occurred_at);
          return (
            // occurred_at alone is not unique (the hourly projector can emit
            // two events for one company in the same run), so the index is
            // folded in — the list is server-rendered and never reordered.
            <li
              key={`${event.event_type}-${event.occurred_at}-${idx}`}
              className="border-b border-border py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {label && (
                    <span className={cn("text-xs font-semibold", tone)}>
                      {label}
                    </span>
                  )}
                  {date && <span className="text-xs text-muted-foreground">{date}</span>}
                </div>
                <p className="mt-1.5 text-sm leading-snug text-foreground">
                  {humanizeProjectorHeadline(event.headline)}
                </p>
                {event.evidence && <EventEvidence evidence={event.evidence} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
