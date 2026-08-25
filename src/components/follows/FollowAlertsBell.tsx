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
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { locationText } from "@/lib/jobs/presentation";
import { jobPath } from "@/lib/jobs/job-slug";
import type { PublicJob } from "@/lib/jobs/types";
import { useFollows } from "@/lib/follows/use-follows";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type AlertRow = {
  job: PublicJob;
  displayName: string;
};

function flattenAlertRows(groups: FollowAlertGroup[]): AlertRow[] {
  const rows: AlertRow[] = [];

  for (const group of groups) {
    for (const job of group.jobs) {
      rows.push({
        job,
        displayName: group.displayName,
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

export function FollowAlertsBell() {
  const { follows } = useFollows();
  const [nowMs] = useState(() => Date.now());
  const [groups, setGroups] = useState<FollowAlertGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

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

  const rows = useMemo(() => flattenAlertRows(groups), [groups]);

  const acknowledge = useCallback(() => {
    writeFollowAlertCursor(new Date().toISOString());
    setGroups([]);
    setOpen(false);
  }, []);

  if (loading || rows.length === 0) return null;

  const totalNew = rows.length;
  const companyCount = groups.length;
  const title =
    totalNew === 1
      ? `1 new role at ${rows[0]?.displayName ?? "a company you follow"}`
      : `${totalNew} new roles at ${companyCount === 1 ? rows[0]?.displayName ?? "companies you follow" : "companies you follow"}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="topbar-follow-alerts"
          aria-label={title}
          className="relative grid h-8 w-8 shrink-0 place-items-center text-muted-foreground transition-colors outline-none hover:text-foreground"
        >
          <Bell size={20} weight="regular" aria-hidden />
          <span className="absolute -right-1 -top-1 mono-data rounded-none bg-brand px-1 text-[10px] font-bold leading-[14px] text-brand-foreground">
            {totalNew}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(20rem,calc(100vw-1rem))] rounded-none border border-border bg-card p-0"
      >
        <div className="flex items-start gap-3 border-b border-border/60 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Observed since your last visit · hiring signal
            </p>
          </div>
          <button
            type="button"
            onClick={acknowledge}
            className="shrink-0 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            aria-label="Dismiss follow alerts"
          >
            dismiss
          </button>
        </div>

        <ul className="max-h-[min(24rem,50vh)] divide-y divide-border/60 overflow-y-auto">
          {rows.map(({ job, displayName }) => {
            const loc = locationText(job);
            const meta = loc ? `${displayName} · ${loc}` : displayName;
            return (
              <li key={job.id}>
                <Link
                  href={jobPath(job)}
                  data-testid="follow-alert-row"
                  onClick={acknowledge}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px] transition-colors hover:text-brand"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{job.title}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {meta}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {jobAgeLabel(job, nowMs)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-border/60 p-4">
          <Link
            href="/jobs?board=elite"
            data-testid="follow-alerts-cta"
            onClick={acknowledge}
            className="block w-full rounded-none bg-primary px-4 py-3 text-center text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            View followed roles →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
