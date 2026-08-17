"use client";

import Link from "next/link";
import { Laptop, GlobeHemisphereWest, CheckCircle } from "@phosphor-icons/react";
import type { TrendFacetItem } from "@/lib/jobs/market-trends";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";

interface WorkArrangementDistributionProps {
  workTypes?: TrendFacetItem[];
  visaSponsorship?: {
    sponsoredCount: number;
    sponsoredPct: number;
    totalCount: number;
  };
}

const SEGMENT_COLORS: Record<string, string> = {
  remote: "bg-foreground",
  hybrid: "bg-slate-500 dark:bg-slate-400",
  onsite: "bg-slate-300 dark:bg-slate-700",
};

export function WorkArrangementDistribution({
  workTypes = [],
  visaSponsorship,
}: WorkArrangementDistributionProps) {
  if (!workTypes || workTypes.length === 0) return null;

  const maxCount = Math.max(...workTypes.map((w) => w.count), 1);

  return (
    <section
      data-testid="trends-work-types"
      className="rounded-none border border-border bg-card p-6 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground/70">
            <Laptop size={15} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Workplace Flexibility</h2>
            <p className="text-xs text-muted-foreground">
              Distribution of remote, hybrid, and onsite workplace policies
            </p>
          </div>
        </div>
        <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          Work Policies
        </span>
      </div>

      {/* High-contrast multi-segment visual breakdown */}
      <div className="mt-4">
        <div className="flex h-2 w-full overflow-hidden rounded-none bg-muted/80">
          {workTypes.map((item) => (
            <div
              key={item.key}
              style={{ width: `${item.pct}%` }}
              className={SEGMENT_COLORS[item.key] || "bg-muted-foreground"}
              title={`${item.label}: ${item.pct}% (${item.count.toLocaleString()} roles)`}
            />
          ))}
        </div>
      </div>

      <ol className="mt-4 space-y-1.5">
        {workTypes.map((item) => {
          const href = `/${serializeJobsUrl({
            ...DEFAULT_URL_STATE,
            facets: { work_type: [item.rawKey] },
          })}`;

          return (
            <li
              key={item.key}
              className="group flex items-center gap-3 px-2 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`h-1.5 w-1.5 rounded-none shrink-0 ${
                    SEGMENT_COLORS[item.key] || "bg-muted-foreground"
                  }`}
                  aria-hidden
                />
                <Link
                  href={href}
                  className="truncate font-medium text-foreground hover:text-brand"
                >
                  {item.label}
                </Link>
              </div>

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

      {visaSponsorship && visaSponsorship.sponsoredCount > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-none border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <GlobeHemisphereWest className="h-4 w-4 text-foreground/70" weight="duotone" />
            <span className="text-xs font-medium text-foreground">Visa Sponsorship Verified</span>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" weight="fill" />
            <span>{visaSponsorship.sponsoredPct}%</span>
            <span className="text-muted-foreground font-normal">({visaSponsorship.sponsoredCount.toLocaleString()})</span>
          </span>
        </div>
      )}
    </section>
  );
}
