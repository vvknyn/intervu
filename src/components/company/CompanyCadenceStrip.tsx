import { eventDate } from "@/components/company/CompanyChangeEvents";
import type { ExhaustSection, WeeklyCadence } from "@/lib/companies/exhaust";

/**
 * Band 3 — the posting-cadence strip, the page's signature band (design
 * call DC1: public, not behind the gate — it's the shop window). One
 * BarRow-style grammar: brand bars sized to the week's new-listing count,
 * zero weeks render as a flush 3px stub so silence is visible instead of a
 * gap in the row. Horizontally scrollable below the point the 26 bars stop
 * fitting.
 */
export function CompanyCadenceStrip({
  cadence,
}: {
  cadence: ExhaustSection<WeeklyCadence[]>;
}) {
  if (!cadence || cadence.data.length === 0) return null;
  const weeks = cadence.data;
  const max = Math.max(...weeks.map((w) => w.newListings), 1);
  const first = eventDate(`${weeks[0].weekStartIso}T00:00:00Z`);
  const last = eventDate(`${weeks[weeks.length - 1].weekStartIso}T00:00:00Z`);

  return (
    <section data-testid="company-cadence-strip" className="border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-xs font-semibold text-muted-foreground">
        Their posting rhythm, last {weeks.length} weeks
      </h2>
      <div
        className="mt-4 flex h-[72px] items-end gap-[2px] overflow-x-auto pb-1"
        role="img"
        aria-label={`Weekly new postings, ${first} through ${last}`}
      >
        {weeks.map((w) => {
          const isZero = w.newListings === 0;
          const heightPx = isZero ? 3 : Math.max(6, Math.round((w.newListings / max) * 72));
          return (
            <span
              key={w.weekStartIso}
              title={`${w.newListings} new postings — week of ${w.weekStartIso}`}
              className={isZero ? "min-w-[10px] flex-1 bg-border" : "min-w-[10px] flex-1 bg-brand opacity-85"}
              style={{ height: `${heightPx}px` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span className="mono-data">{first}</span>
        <span className="mono-data">{last}</span>
      </div>
      <p className="mono-data mt-3 text-xs text-muted-foreground">
        {cadence.label} · weekly buckets
      </p>
    </section>
  );
}
