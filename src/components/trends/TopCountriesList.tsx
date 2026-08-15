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
  const maxCount = Math.max(...countries.map((row) => row.count), 1);

  return (
    <section data-testid="trends-countries" className="mt-6 rounded-2xl border border-slate-200/90 bg-card p-6 shadow-xs dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <GlobeHemisphereWest size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Top Hiring Countries</h2>
          <p className="text-xs text-muted-foreground">Live active postings direct from verified employer pages</p>
        </div>
      </div>

      <ol className="mt-5 space-y-2.5">
        {ranked.map((row, i) => (
          <li key={row.country} data-testid="trends-country-row" className="flex items-center gap-3 text-[13.5px]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {i + 1}
            </span>
            <Link
              href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { location_country: row.rawValues ?? [] } })}`}
              className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              {row.country}
            </Link>
            <span className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 sm:w-48">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-500"
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="w-18 shrink-0 text-right font-mono text-[12.5px] font-bold text-foreground">
              {row.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>

      {unclassified && (
        <div
          data-testid="trends-country-unclassified"
          className="mt-4 flex items-center gap-3 border-t border-dashed border-slate-200 pt-3 text-[13px] text-muted-foreground dark:border-slate-800"
        >
          <span className="w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{unclassified.country}</span>
          <span className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 sm:w-48">
            <span
              className="block h-full rounded-full bg-slate-300 dark:bg-slate-700"
              style={{ width: `${(unclassified.count / maxCount) * 100}%` }}
            />
          </span>
          <span className="w-18 shrink-0 text-right font-mono text-[12.5px] font-semibold">
            {unclassified.count.toLocaleString()}
          </span>
        </div>
      )}
    </section>
  );
}
