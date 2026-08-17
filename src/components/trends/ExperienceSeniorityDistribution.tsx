"use client";

import Link from "next/link";
import { UserFocus, Briefcase } from "@phosphor-icons/react";
import type { TrendFacetItem } from "@/lib/jobs/market-trends";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";

interface ExperienceSeniorityDistributionProps {
  experienceLevels?: TrendFacetItem[];
  employmentTypes?: TrendFacetItem[];
}

export function ExperienceSeniorityDistribution({
  experienceLevels = [],
  employmentTypes = [],
}: ExperienceSeniorityDistributionProps) {
  if (!experienceLevels || experienceLevels.length === 0) return null;

  const maxCount = Math.max(...experienceLevels.map((e) => e.count), 1);

  return (
    <section
      data-testid="trends-experience-levels"
      className="rounded-none border border-border bg-card p-6 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground/70">
            <UserFocus size={15} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Experience & Seniority Mix</h2>
            <p className="text-xs text-muted-foreground">
              Demand distributed across career stages and leadership tiers
            </p>
          </div>
        </div>
        <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          Career Tiers
        </span>
      </div>

      <ol className="mt-4 space-y-1.5">
        {experienceLevels.map((item) => {
          const href = `/${serializeJobsUrl({
            ...DEFAULT_URL_STATE,
            facets: { experience_level: [item.rawKey] },
          })}`;

          return (
            <li
              key={item.key}
              className="group flex items-center gap-3 px-2 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              <Link
                href={href}
                className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-brand"
              >
                {item.label}
              </Link>
              <div className="flex items-center gap-3 shrink-0">
                <span className="h-1.5 w-24 overflow-hidden rounded-none bg-muted/80 sm:w-36">
                  <span
                    className="block h-full rounded-none bg-slate-700 dark:bg-slate-300 transition-all"
                    style={{ width: `${(item.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="w-10 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                  {item.pct}%
                </span>
                <span className="w-16 text-right font-mono text-xs font-bold text-foreground tabular-nums">
                  {item.count.toLocaleString()}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {employmentTypes.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <Briefcase size={14} weight="duotone" />
            <span>Employment Contract Types</span>
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
                  className="inline-flex items-center gap-1.5 rounded-none border border-border bg-muted/20 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-muted/50"
                >
                  <span>{type.label}</span>
                  <span className="font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
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
