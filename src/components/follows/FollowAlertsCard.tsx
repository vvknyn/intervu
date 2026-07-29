"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell } from "@phosphor-icons/react";
import { listFollowAlertsAction } from "@/actions/follows";
import {
  readFollowAlertCursor,
  writeFollowAlertCursor,
} from "@/lib/follows/alert-cursor";
import type { FollowAlertGroup } from "@/lib/follows/alerts";
import { jobPostedMs } from "@/lib/follows/alerts";
import type { FollowedCompany } from "@/lib/follows/types";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { locationText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { BoardId } from "@/lib/boards/types";
import { cn } from "@/lib/utils";

type AlertRow = {
  job: PublicJob;
  domain: string;
  displayName: string;
  slug: string;
};

function flattenAlertRows(groups: FollowAlertGroup[], follows: FollowedCompany[]): AlertRow[] {
  const slugByDomain = new Map(follows.map((f) => [f.domain.trim().toLowerCase(), f.slug]));
  const rows: AlertRow[] = [];

  for (const group of groups) {
    const slug = slugByDomain.get(group.domain) ?? group.domain;
    for (const job of group.jobs) {
      rows.push({
        job,
        domain: group.domain,
        displayName: group.displayName,
        slug,
      });
    }
  }

  return rows.sort((a, b) => (jobPostedMs(b.job) ?? 0) - (jobPostedMs(a.job) ?? 0));
}

function jobAgeLabel(job: PublicJob, nowMs: number): string {
  const postedMs = jobPostedMs(job);
  if (postedMs != null) return formatRelativeAge(new Date(postedMs).toISOString(), nowMs);
  const iso = job.first_seen_at ?? job.posted_at;
  return iso ? formatRelativeAge(iso, nowMs) : "";
}

export function FollowAlertsCard({
  follows,
  nowMs,
  board,
  onViewAll,
  className,
}: {
  follows: FollowedCompany[];
  nowMs: number;
  board: BoardId | null;
  onViewAll: () => void;
  className?: string;
}) {
  const [groups, setGroups] = useState<FollowAlertGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (follows.length === 0) {
        if (!cancelled) {
          setGroups([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const sinceIso = readFollowAlertCursor();
      const res = await listFollowAlertsAction(sinceIso, follows);
      if (cancelled) return;
      setGroups(res.data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [follows]);

  const rows = useMemo(() => flattenAlertRows(groups, follows), [groups, follows]);

  const acknowledge = useCallback(() => {
    writeFollowAlertCursor(new Date().toISOString());
    setGroups([]);
  }, []);

  const handleViewAll = () => {
    acknowledge();
    onViewAll();
  };

  if (loading || rows.length === 0) return null;

  const totalNew = rows.length;
  const companyCount = groups.length;
  const title =
    totalNew === 1
      ? `1 new role at ${rows[0]?.displayName ?? "a company you follow"}`
      : `${totalNew} new roles at ${companyCount === 1 ? rows[0]?.displayName ?? "companies you follow" : "companies you follow"}`;

  return (
    <section
      data-testid="follow-alerts-card"
      className={cn(
        "mb-4 rounded-xl border border-border bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand/10 text-brand">
          <Bell size={20} weight="fill" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
          <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
            Observed since your last visit · hiring signal
          </p>
        </div>
        <button
          type="button"
          onClick={acknowledge}
          className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          aria-label="Dismiss follow alerts"
        >
          dismiss
        </button>
      </div>

      <ul className="mb-4 divide-y divide-border/60">
        {rows.map(({ job, displayName, slug }) => {
          const loc = locationText(job);
          const meta = loc ? `${displayName} · ${loc}` : displayName;
          return (
            <li key={job.id}>
              <Link
                href={`/co/${slug}`}
                data-testid="follow-alert-row"
                onClick={acknowledge}
                className="flex items-center justify-between gap-3 py-3 text-[13.5px] transition-colors hover:text-brand"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{job.title}</div>
                  <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
                    {meta}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {jobAgeLabel(job, nowMs)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        data-testid="follow-alerts-cta"
        onClick={handleViewAll}
        className="w-full rounded-[10px] bg-foreground px-4 py-3 text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
      >
        {board === "elite" ? "View followed roles →" : "View in Elite SERP →"}
      </button>
    </section>
  );
}
