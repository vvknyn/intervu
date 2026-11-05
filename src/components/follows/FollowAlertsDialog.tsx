"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { jobPostedMs } from "@/lib/follows/alerts";
import type { FollowAlertRow } from "@/lib/follows/use-follow-alerts";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { decodeText, locationText, placeWithWorkMode, titleCaseDisplay } from "@/lib/jobs/presentation";
import { jobPath } from "@/lib/jobs/job-slug";
import type { PublicJob } from "@/lib/jobs/types";
import { MANAGE_FOLLOWS_HREF } from "@/lib/follows/manage-path";

function jobAgeLabel(job: PublicJob, nowMs: number): string {
  const postedMs = jobPostedMs(job);
  if (postedMs != null) return formatRelativeAge(new Date(postedMs).toISOString(), nowMs);
  const iso = job.first_seen_at ?? job.posted_at;
  return iso ? formatRelativeAge(iso, nowMs) : "";
}

/**
 * The new roles at the companies an account follows, opened from the account menu's
 * "New at companies you follow" row (it used to be a bell of its own in the header).
 * Opening a role, or "Mark as seen", moves the since-last-look cursor to now.
 */
export function FollowAlertsDialog({
  open,
  onOpenChange,
  title,
  rows,
  acknowledge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: FollowAlertRow[];
  acknowledge: () => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="follow-alerts-dialog" className="gap-4 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border p-4 pr-12 text-left">
          <DialogTitle className="text-sm leading-snug">{title}</DialogTitle>
          <DialogDescription className="text-xs">Observed since your last visit · hiring signal</DialogDescription>
        </DialogHeader>

        <ul className="max-h-[min(24rem,50vh)] divide-y divide-border overflow-y-auto">
          {rows.map(({ job, displayName }) => {
            // placeWithWorkMode: this row has no adjacent work-type chip, so
            // it's the only place a remote/hybrid job's work mode can show.
            const loc = placeWithWorkMode(locationText(job), job.work_type);
            const meta = loc ? `${displayName} · ${loc}` : displayName;
            return (
              <li key={job.id}>
                <Link
                  href={jobPath(job)}
                  data-testid="follow-alert-row"
                  onClick={() => {
                    acknowledge();
                    close();
                  }}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:text-brand"
                >
                  <div className="min-w-0">
                    <div className="truncate">{titleCaseDisplay(decodeText(job.title))}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{jobAgeLabel(job, nowMs)}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          {/* Who you follow is changed in Settings › Account, not on the Elite startups board. */}
          <Link
            href={MANAGE_FOLLOWS_HREF}
            data-testid="follow-alerts-cta"
            onClick={close}
            className="text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Manage companies you follow
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="follow-alerts-dismiss"
            onClick={() => {
              acknowledge();
              close();
            }}
          >
            Mark as seen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
