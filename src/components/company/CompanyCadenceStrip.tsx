import { eventDate } from "@/components/company/CompanyChangeEvents";
import type { CadenceFacts, ExhaustSection, WeeklyCadence } from "@/lib/companies/exhaust";
import { cn } from "@/lib/utils";

/** Bar heights as literal classes so Tailwind emits them; a week's bar takes
 *  the step nearest its share of the tallest week. */
const BAR_HEIGHTS = [
  "h-1", "h-2", "h-3", "h-4", "h-5", "h-6", "h-7", "h-8",
  "h-9", "h-10", "h-11", "h-12", "h-13", "h-14", "h-15", "h-16",
] as const;

function barHeight(n: number, max: number): string {
  if (n <= 0) return "h-0.5";
  const step = Math.min(BAR_HEIGHTS.length, Math.max(1, Math.round((n / max) * BAR_HEIGHTS.length)));
  return BAR_HEIGHTS[step - 1];
}

/** The backlog week's grey. `border-strong` is near-white in dark mode, which
 *  made the week that should recede the loudest bar on the chart. */
const BACKLOG_TONE = "bg-muted-foreground/40";

function barTone(w: WeeklyCadence): string {
  if (w.inProgress) return "min-h-2 border border-dashed border-brand";
  if (w.firstTracked) return BACKLOG_TONE;
  return w.newListings === 0 ? "bg-border" : "bg-brand";
}

/** Whether `CompanyCadenceStrip` draws anything (see `verdictBandHasContent`). */
export function cadenceStripHasContent(
  cadence: ExhaustSection<CadenceFacts> | undefined,
): cadence is NonNullable<ExhaustSection<CadenceFacts>> {
  return !!cadence && cadence.data.weeks.length > 0;
}

/**
 * Band 3 — new postings per week, public (design call DC1).
 *
 * Draws only weeks Velai was watching: when tracking began inside the window
 * the strip starts there (see `buildWeeklyCadence`), so months before the
 * first crawl no longer read as "posted nothing". The first tracked week is
 * the crawl's backlog of already-open roles, drawn grey and left out of the
 * scale so it can't flatten the weeks after it; this week is dashed because
 * it is still being counted. Every week prints its count, since phones never
 * show a hover title.
 */
export function CompanyCadenceStrip({ cadence }: { cadence: ExhaustSection<CadenceFacts> }) {
  if (!cadenceStripHasContent(cadence)) return null;
  const { weeks, trackedSinceIso } = cadence.data;
  const scaled = weeks.filter((w) => !w.firstTracked);
  const max = Math.max(...(scaled.length > 0 ? scaled : weeks).map((w) => w.newListings), 1);
  const first = eventDate(`${weeks[0].weekStartIso}T00:00:00Z`);
  const last = eventDate(`${weeks[weeks.length - 1].weekStartIso}T00:00:00Z`);
  const trackedWithinWindow = weeks.some((w) => w.firstTracked);
  const trackedSince = trackedWithinWindow && trackedSinceIso ? eventDate(`${trackedSinceIso}T00:00:00Z`) : null;
  const hasInProgress = weeks.some((w) => w.inProgress);

  return (
    <section data-testid="company-cadence-strip" className="border-t border-border pt-6">
      <h2 className="text-base font-semibold leading-snug text-foreground">
        New postings per week
        <span className="text-sm font-normal text-muted-foreground">
          {" · "}
          {trackedSince ? `tracking since ${trackedSince}` : `last ${weeks.length} weeks`}
        </span>
      </h2>
      <ol
        className="mt-4 flex items-end gap-0.5 overflow-x-auto pb-1"
        aria-label={`New postings per week, ${first} through ${last}`}
      >
        {weeks.map((w) => {
          const date = eventDate(`${w.weekStartIso}T00:00:00Z`);
          return (
            <li
              key={w.weekStartIso}
              data-testid="company-cadence-week"
              data-first-tracked={w.firstTracked || undefined}
              data-in-progress={w.inProgress || undefined}
              title={`${w.newListings} new ${w.newListings === 1 ? "posting" : "postings"}, week of ${date}${w.inProgress ? " (so far)" : ""}`}
              className="flex min-w-5 flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="mono-data text-xs leading-none text-muted-foreground">
                {w.newListings > 0 || w.inProgress ? w.newListings : ""}
              </span>
              <span className={cn("w-full", barHeight(w.newListings, max), barTone(w))} aria-hidden />
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span className="mono-data">{first}</span>
        <span className="mono-data">{last}</span>
      </div>
      {(trackedWithinWindow || hasInProgress) && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {trackedWithinWindow && (
            <li className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0", BACKLOG_TONE)} aria-hidden />
              First week tracked: includes roles already open
            </li>
          )}
          {hasInProgress && (
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 border border-dashed border-brand" aria-hidden />
              This week so far
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
