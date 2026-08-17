"use client";

import Link from "next/link";
import { UserFocus, Briefcase } from "@phosphor-icons/react";
import type { TrendFacetItem } from "@/lib/jobs/market-trends";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";

interface ExperienceSeniorityDistributionProps {
  experienceLevels: TrendFacetItem[];
  employmentTypes: TrendFacetItem[];
}

export function ExperienceSeniorityDistribution({
  experienceLevels,
  employmentTypes,
}: ExperienceSeniorityDistributionProps) {
  if (experienceLevels.length === 0) return null;

  const maxCount = Math.max(...experienceLevels.map((e) => e.count), 1);

  return (
    <section
      data-testid="trends-experience-levels"
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-chip text-indigo-500">
          <UserFocus size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Experience & Seniority Mix</h2>
          <p className="text-xs text-muted-foreground">
            Active demand distributed by engineering and leadership seniority
          </p>
        </div>
      </div>

      <ol className="mt-5 space-y-2.5">
        {experienceLevels.map((item) => {
          const href = `/${serializeJobsUrl({
            ...DEFAULT_URL_STATE,
            facets: { experience_level: [item.rawKey] },
          })}`;

          return (
            <li key={item.key} className="flex items-center gap-3 text-[13.5px]">
              <Link
                href={href}
                className="w-36 shrink-0 truncate font-medium text-foreground hover:text-indigo-600 dark:hover:text-indigo-400 sm:w-44"
              >
                {item.label}
              </Link>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                  style={{ width: `${(item.count / maxCount) * 100}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-[12px] font-semibold text-muted-foreground">
                {item.pct}%
              </span>
              <span className="w-18 shrink-0 text-right font-mono text-[12.5px] font-bold text-foreground">
                {item.count.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ol>

      {employmentTypes.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <Briefcase size={14} weight="duotone" />
            <span>Employment Structure Breakdown</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {employmentTypes.map((type) => {
              const href = `/${serializeJobsUrl({
                ...DEFAULT_URL_STATE,
                facets: { employment_type: [type.rawKey] },
              })}`;

              return (
                <Link
                  key={type.key}
                  href={href}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-chip px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-card"
                >
                  <span>{type.label}</span>
                  <span className="font-mono text-[11px] font-bold text-muted-foreground">
                    {type.pct}%
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
