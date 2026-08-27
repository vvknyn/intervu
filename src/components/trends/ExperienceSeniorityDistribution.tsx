"use client";

import Link from "next/link";
import { Briefcase } from "@phosphor-icons/react";
import type { TrendFacetItem } from "@/lib/jobs/market-trends";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { BarRow, TrendSection } from "./TrendSection";

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
    <TrendSection testId="trends-experience-levels" label="Experience and seniority mix">
      {experienceLevels.map((item) => (
        <BarRow
          key={item.key}
          label={item.label}
          pct={Math.round((item.count / maxCount) * 100)}
          pctLabel={`${item.pct}%`}
          count={item.count.toLocaleString()}
          href={`/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { experience_level: [item.rawKey] } })}`}
        />
      ))}

      {employmentTypes.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <Briefcase size={14} weight="duotone" />
            <span>Employment contract types</span>
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
                  <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {type.pct}%
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </TrendSection>
  );
}
