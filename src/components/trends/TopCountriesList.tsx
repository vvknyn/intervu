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
    <section
      data-testid="trends-countries"
      className="rounded-none border border-border/80 bg-card/75 p-6 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-colors"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border/70 bg-muted/40 backdrop-blur-md text-foreground/70">
            <GlobeHemisphereWest size={15} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Top Hiring Countries</h2>
            <p className="text-xs text-muted-foreground">Geographic distribution of active verified openings</p>
          </div>
        </div>
        <span className="hidden text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          {ranked.length} Jurisdictions
        </span>
      </div>

      {/* Carbon-Glass Structured Data Column Header */}
      <div className="mt-4 flex items-center gap-3 border-b border-border/60 pb-2 px-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="w-5 shrink-0">#</span>
        <span className="min-w-0 flex-1">Jurisdiction</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="hidden sm:inline-block w-36">Distribution</span>
          <span className="w-11 text-right">Share</span>
          <span className="w-16 text-right">Postings</span>
        </div>
      </div>

      <ol className="mt-1 divide-y divide-border/30">
        {ranked.map((row, i) => {
          const pct = totalCount > 0 ? ((row.count / totalCount) * 100).toFixed(1) : "0.0";
          return (
            <li
              key={row.country}
              data-testid="trends-country-row"
              className="group flex items-center gap-3 px-2 py-2 text-xs transition-colors hover:bg-muted/40"
            >
              <span className="flex h-4 w-5 shrink-0 items-center text-[11px] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Link
                href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { location_country: row.rawValues ?? [] } })}`}
                className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-brand"
              >
                {row.country}
              </Link>
              <div className="flex items-center gap-3 shrink-0">
                <span className="hidden sm:inline-block h-1.5 w-36 overflow-hidden rounded-none bg-muted/70 backdrop-blur-xs">
                  <span
                    className="block h-full rounded-none bg-slate-700 dark:bg-slate-300 transition-all shadow-[0_0_8px_rgba(255,255,255,0.15)]"
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="w-11 text-right text-[11px] text-muted-foreground tabular-nums">
                  {pct}%
                </span>
                <span className="w-16 text-right text-xs font-bold text-foreground tabular-nums">
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
          className="mt-2 flex items-center gap-3 border-t border-dashed border-border pt-3 px-2 text-xs text-muted-foreground"
        >
          <span className="w-5 shrink-0 text-[11px] opacity-40">--</span>
          <span className="min-w-0 flex-1 truncate">{unclassified.country}</span>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline-block h-1.5 w-36 overflow-hidden rounded-none bg-muted/70">
              <span
                className="block h-full rounded-none bg-slate-400 dark:bg-slate-600"
                style={{ width: `${(unclassified.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="w-11 text-right text-[11px] tabular-nums">
              {totalCount > 0 ? ((unclassified.count / totalCount) * 100).toFixed(1) : 0}%
            </span>
            <span className="w-16 text-right text-xs font-semibold tabular-nums">
              {unclassified.count.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
