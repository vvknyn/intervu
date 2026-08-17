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

export function WorkArrangementDistribution({
  workTypes = [],
  visaSponsorship,
}: WorkArrangementDistributionProps) {
  if (!workTypes || workTypes.length === 0) return null;

  const maxCount = Math.max(...workTypes.map((w) => w.count), 1);

  return (
    <section
      data-testid="trends-work-types"
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-chip text-sky-500">
          <Laptop size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Work Arrangement & Flexibility</h2>
          <p className="text-xs text-muted-foreground">
            Distribution of remote, hybrid, and onsite workplace policies
          </p>
        </div>
      </div>

      {/* Multi-segment visual bar */}
      <div className="mt-5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          {workTypes.map((item) => {
            const barBg =
              item.key === "remote"
                ? "bg-sky-500"
                : item.key === "hybrid"
                ? "bg-amber-500"
                : "bg-slate-400 dark:bg-slate-600";
            return (
              <div
                key={item.key}
                style={{ width: `${item.pct}%` }}
                className={barBg}
                title={`${item.label}: ${item.pct}%`}
              />
            );
          })}
        </div>
      </div>

      <ol className="mt-4 space-y-2.5">
        {workTypes.map((item) => {
          const href = `/${serializeJobsUrl({
            ...DEFAULT_URL_STATE,
            facets: { work_type: [item.rawKey] },
          })}`;

          return (
            <li key={item.key} className="flex items-center gap-3 text-[13.5px]">
              <Link
                href={href}
                className="w-36 shrink-0 truncate font-medium text-foreground hover:text-sky-600 dark:hover:text-sky-400 sm:w-44"
              >
                {item.label}
              </Link>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-sky-500 to-teal-500"
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

      {visaSponsorship && visaSponsorship.sponsoredCount > 0 && (
        <div className="mt-5 flex items-center justify-between rounded-xl border border-brand/20 bg-brand/5 p-3.5">
          <div className="flex items-center gap-2">
            <GlobeHemisphereWest className="h-4 w-4 text-brand" weight="bold" />
            <span className="text-xs font-semibold text-foreground">Visa & Immigration Sponsorship</span>
          </div>
          <span className="flex items-center gap-1 font-mono text-xs font-bold text-brand">
            <CheckCircle className="h-3.5 w-3.5" weight="fill" />
            {visaSponsorship.sponsoredPct}% ({visaSponsorship.sponsoredCount.toLocaleString()} roles)
          </span>
        </div>
      )}
    </section>
  );
}
