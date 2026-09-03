"use client";

import { GlobeHemisphereWest, CheckCircle } from "@phosphor-icons/react";
import type { TrendFacetItem } from "@/lib/jobs/market-trends";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { BarRow, TrendSection } from "./TrendSection";

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
  hybrid: "bg-muted-foreground dark:bg-muted-foreground",
  onsite: "bg-border dark:bg-border",
};

export function WorkArrangementDistribution({
  workTypes = [],
  visaSponsorship,
}: WorkArrangementDistributionProps) {
  if (!workTypes || workTypes.length === 0) return null;

  const maxCount = Math.max(...workTypes.map((w) => w.count), 1);

  return (
    <TrendSection testId="trends-work-types" label="Workplace flexibility">
      {/* High-contrast multi-segment visual breakdown — a proportion picture
          the row grammar below can't replace, kept as its own shape. */}
      <div className="flex h-2 w-full overflow-hidden rounded-none bg-muted">
        {workTypes.map((item) => (
          <div
            key={item.key}
            style={{ width: `${item.pct}%` }}
            className={SEGMENT_COLORS[item.key] || "bg-muted-foreground"}
            title={`${item.label}: ${item.pct}% (${item.count.toLocaleString()} roles)`}
          />
        ))}
      </div>

      <ul className="mt-2 mb-4 flex flex-wrap gap-x-4 gap-y-1" aria-label="Workplace flexibility legend">
        {workTypes.map((item) => (
          <li key={`legend-${item.key}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`h-2 w-2 shrink-0 rounded-none ${SEGMENT_COLORS[item.key] || "bg-muted-foreground"}`}
              aria-hidden
            />
            <span className="text-foreground">{item.label}</span>
            <span className="mono-data">{item.pct}%</span>
          </li>
        ))}
      </ul>

      {workTypes.map((item) => (
        <BarRow
          key={item.key}
          label={item.label}
          pct={Math.round((item.count / maxCount) * 100)}
          pctLabel={`${item.pct}%`}
          count={item.count.toLocaleString()}
          href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { work_type: [item.rawKey] } })}`}
        />
      ))}

      {visaSponsorship && visaSponsorship.sponsoredCount > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-none border border-border bg-muted p-3">
          <div className="flex items-center gap-2">
            <GlobeHemisphereWest className="h-4 w-4 text-foreground" weight="duotone" />
            <span className="text-xs text-foreground">Visa sponsorship verified</span>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CheckCircle className="h-3.5 w-3.5 text-live dark:text-live" weight="fill" />
            <span>{visaSponsorship.sponsoredPct}%</span>
            <span className="text-muted-foreground font-normal">({visaSponsorship.sponsoredCount.toLocaleString()})</span>
          </span>
        </div>
      )}
    </TrendSection>
  );
}
