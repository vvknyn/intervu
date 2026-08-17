"use client";

import Link from "next/link";
import { UNCLASSIFIED_LABEL, type CountryRollupRow } from "@/lib/jobs/country-classification";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { GlobeHemisphereWest } from "@phosphor-icons/react";

const MAX_VISIBLE_COUNTRIES = 15;

export function TopCountriesList({ countries }: { countries: CountryRollupRow[] }) {
  if (countries.length === 0) return null;

  const unclassified = countries.find((row) => row.country === UNCLASSIFIED_LABEL);
  const ranked = countries.filter((row) => row.country !== UNCLASSIFIED_LABEL).slice(0, MAX_VISIBLE_COUNTRIES);
  const totalCount = countries.reduce((sum, row) => sum + row.count, 0);
  const maxCount = Math.max(...countries.map((row) => row.count), 1);

  return (
    <section data-testid="trends-countries" className="rounded-xl border border-border bg-card p-6 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-border bg-muted/40 text-foreground/70">
            <GlobeHemisphereWest size={16} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Top Hiring Countries</h2>
            <p className="text-xs text-muted-foreground">Geographic distribution of active verified openings</p>
          </div>
        </div>
        <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          {ranked.length} Jurisdictions
        </span>
      </div>

      <ol className="mt-4 space-y-1.5">
        {ranked.map((row, i) => {
          const pct = totalCount > 0 ? ((row.count / totalCount) * 100).toFixed(1) : "0.0";
          return (
            <li
              key={row.country}
              data-testid="trends-country-row"
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[10.5px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <Link
                href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { location_country: row.rawValues ?? [] } })}`}
                className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-brand"
              >
                {row.country}
              </Link>
              <div className="flex items-center gap-3 shrink-0">
                <span className="h-1.5 w-24 overflow-hidden rounded-xs bg-muted/80 sm:w-36">
                  <span
                    className="block h-full rounded-xs bg-slate-700 dark:bg-slate-300 transition-all"
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="w-11 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                  {pct}%
                </span>
                <span className="w-16 text-right font-mono text-xs font-bold text-foreground tabular-nums">
                  {row.count.toLocaleString()}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {unclassified && (
        <div
          data-testid="trends-country-unclassified"
          className="mt-3 flex items-center gap-3 border-t border-dashed border-border pt-3 px-2 text-xs text-muted-foreground"
        >
          <span className="w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{unclassified.country}</span>
          <div className="flex items-center gap-3 shrink-0">
            <span className="h-1.5 w-24 overflow-hidden rounded-xs bg-muted/80 sm:w-36">
              <span
                className="block h-full rounded-xs bg-slate-400 dark:bg-slate-600"
                style={{ width: `${(unclassified.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="w-11 text-right font-mono text-[11px] tabular-nums">
              {totalCount > 0 ? ((unclassified.count / totalCount) * 100).toFixed(1) : 0}%
            </span>
            <span className="w-16 text-right font-mono text-xs font-semibold tabular-nums">
              {unclassified.count.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
