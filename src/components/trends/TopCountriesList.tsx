import Link from "next/link";
import { UNCLASSIFIED_LABEL, type CountryRollupRow } from "@/lib/jobs/country-classification";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";

/** Numbered rows shown before the list collapses into the Unclassified
 *  footnote row — bounded so the page stays a stats surface, not a full
 *  country directory (that's the Phase 2 /trends/locations/<country> idea
 *  in the spec). */
const MAX_VISIBLE_COUNTRIES = 15;

/**
 * "Top hiring countries" — numbered ranked list, count + a single-hue CSS
 * proportion bar (dataviz skill: sequential magnitude, one hue, thin marks,
 * never a rainbow), each real country linking into /jobs pre-filtered to it
 * via the one existing URL serializer. The Unclassified row (cities/regions/
 * remote sentinels that failed ISO validation — see
 * country-classification.ts) always renders last, unranked and unlinked: it
 * has no single corpus value to filter search by.
 */
export function TopCountriesList({ countries }: { countries: CountryRollupRow[] }) {
  if (countries.length === 0) return null;

  const unclassified = countries.find((row) => row.country === UNCLASSIFIED_LABEL);
  const ranked = countries.filter((row) => row.country !== UNCLASSIFIED_LABEL).slice(0, MAX_VISIBLE_COUNTRIES);
  const maxCount = Math.max(...countries.map((row) => row.count), 1);

  return (
    <section data-testid="trends-countries" className="mt-10 border-t border-foreground pt-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Top hiring countries
      </span>
      <p className="mt-1 text-sm text-muted-foreground">Live active postings, by country.</p>

      <ol className="mt-4 space-y-2">
        {ranked.map((row, i) => (
          <li key={row.country} data-testid="trends-country-row" className="flex items-center gap-3 text-[13.5px]">
            <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{i + 1}.</span>
            <Link
              href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { location_country: row.rawValues ?? [] } })}`}
              className="min-w-0 flex-1 truncate text-foreground hover:underline"
            >
              {row.country}
            </Link>
            <span className="h-1.5 w-20 shrink-0 bg-foreground/10 sm:w-40">
              <span
                className="block h-full bg-foreground/40"
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[12.5px] text-foreground">
              {row.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>

      {unclassified && (
        <div
          data-testid="trends-country-unclassified"
          className="mt-3 flex items-center gap-3 border-t border-dashed border-foreground/20 pt-3 text-[13px] text-muted-foreground"
        >
          <span className="w-6 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{unclassified.country}</span>
          <span className="h-1.5 w-20 shrink-0 bg-foreground/10 sm:w-40">
            <span
              className="block h-full bg-foreground/20"
              style={{ width: `${(unclassified.count / maxCount) * 100}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[12.5px]">
            {unclassified.count.toLocaleString()}
          </span>
        </div>
      )}
    </section>
  );
}
