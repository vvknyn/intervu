"use client";

import { UNCLASSIFIED_LABEL, type CountryRollupRow } from "@/lib/jobs/country-classification";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { BarRow, TrendSection } from "./TrendSection";

const MAX_VISIBLE_COUNTRIES = 15;

export function TopCountriesList({ countries }: { countries: CountryRollupRow[] }) {
  if (countries.length === 0) return null;

  const unclassified = countries.find((row) => row.country === UNCLASSIFIED_LABEL);
  const rankable = countries.filter((row) => row.country !== UNCLASSIFIED_LABEL);
  const ranked = rankable.slice(0, MAX_VISIBLE_COUNTRIES);
  const totalCount = countries.reduce((sum, row) => sum + row.count, 0);
  const maxCount = Math.max(...countries.map((row) => row.count), 1);
  // Ranked rows are real information (structure-is-information rule,
  // proposal annotation 4) — the as-of line says so honestly: it names the
  // cut only when the corpus actually has more countries than are shown.
  const asOf =
    rankable.length > ranked.length
      ? `top ${ranked.length} of ${rankable.length} · each row opens the filtered board`
      : "each row opens the filtered board";

  return (
    <TrendSection testId="trends-countries" label="Where the roles are" asOf={asOf}>
      {ranked.map((row, i) => {
        const pct = totalCount > 0 ? (row.count / totalCount) * 100 : 0;
        return (
          <BarRow
            key={row.country}
            testId="trends-country-row"
            label={row.country}
            rank={i + 1}
            pct={Math.round((row.count / maxCount) * 100)}
            pctLabel={`${pct.toFixed(1)}%`}
            count={row.count.toLocaleString()}
            href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { location_country: row.rawValues ?? [] } })}`}
          />
        );
      })}
      {unclassified && (
        <BarRow
          testId="trends-country-unclassified"
          label={unclassified.country}
          tone="neutral"
          pct={Math.round((unclassified.count / maxCount) * 100)}
          pctLabel={`${totalCount > 0 ? ((unclassified.count / totalCount) * 100).toFixed(1) : "0.0"}%`}
          count={unclassified.count.toLocaleString()}
        />
      )}
    </TrendSection>
  );
}
