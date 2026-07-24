"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MagnifyingGlass, Package } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { CachedPlanListItem, ResumableSessionItem } from "@/lib/prep/plan-list";
import type { StarStory } from "@/types";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { cn } from "@/lib/utils";

export interface PrepLandingProps {
  onStartNew: () => void;
  onSearch: () => void;
  onResume: (planCacheKey: string) => void;
  onOpenPackage: (item: CachedPlanListItem) => void;
  cachedPlans: CachedPlanListItem[];
  resumableSessions: ResumableSessionItem[];
  stories: StarStory[];
}

const MODE_LABEL: Record<ResumableSessionItem["mode"], string> = {
  learn: "Learn",
  practice: "Practice",
};

/** Real, honest subline: package/session counts when there's real activity to
 * report, otherwise a generic tagline — never a fabricated "built for X". */
function prepLandingSubline(cachedPlans: CachedPlanListItem[], resumableSessions: ResumableSessionItem[]): string {
  if (cachedPlans.length === 0) return "Practice with real questions, get real feedback";
  const packages = `${cachedPlans.length} prep package${cachedPlans.length === 1 ? "" : "s"}`;
  if (resumableSessions.length === 0) return packages;
  return `${packages} · ${resumableSessions.length} session${resumableSessions.length === 1 ? "" : "s"} in progress`;
}

/** Story bank's real status field is `importance` (same one StoryList badges
 * already show) — no separate "readiness" concept invented here. */
function importanceDotClass(importance?: StarStory["importance"]): string {
  if (importance === "high") return "bg-warn-dot";
  if (importance === "medium") return "bg-muted-foreground";
  return "bg-faint";
}

export function PrepLanding({
  onStartNew,
  onSearch,
  onResume,
  onOpenPackage,
  cachedPlans,
  resumableSessions,
  stories,
}: PrepLandingProps) {
  // Sampled once via useState's lazy initializer — the sanctioned way to do
  // one-time impure work during render (react-hooks/purity); see the longer
  // rationale at the same pattern's first use, src/app/page.tsx's `nowMs`.
  const [now] = useState(() => Date.now());

  return (
    <div className="w-full max-w-5xl animate-in fade-in duration-500">
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_350px]">
        <div>
          <div className="mb-[18px]">
            <h1 className="font-display text-[28px] font-semibold tracking-tight">
              Interview prep
            </h1>
            <p className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">
              {prepLandingSubline(cachedPlans, resumableSessions)}
            </p>
          </div>

          <div className="mb-[18px] flex flex-col items-start justify-between gap-6 rounded-xl bg-ink-card-bg p-6 text-ink-card-fg dark:border dark:border-ink-card-border sm:flex-row sm:items-center sm:p-7">
            <div>
              <div className="mb-2 font-display text-[19px] font-semibold">
                New prep session
              </div>
              <p className="max-w-[520px] text-[13.5px] leading-relaxed text-ink-card-body">
                Learn: review real questions and model answers at your own pace.
                Practice: answer aloud and get AI critique on your responses.
              </p>
            </div>
            <Button
              onClick={onStartNew}
              data-testid="prep-start-new"
              className="shrink-0 bg-ink-card-accent text-ink-card-bg hover:bg-ink-card-accent/90"
            >
              Start session
              <ArrowRight size={16} weight="bold" />
            </Button>
          </div>

          <div className="mb-[18px]">
            <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onSearch}>
              <MagnifyingGlass size={18} className="mr-2" />
              Search plans
            </Button>
          </div>

          {resumableSessions.length > 0 && (
            <div className="mb-[18px] rounded-xl border border-border bg-card p-5">
              <div className="mb-3.5 font-display text-base font-semibold">
                Recent sessions
              </div>
              <div className="flex flex-col divide-y divide-border">
                {resumableSessions.slice(0, 4).map((session) => {
                  const touched = session.totalQuestions - session.summary.progress.unreviewed;
                  const pct =
                    session.totalQuestions > 0 ? Math.round((touched / session.totalQuestions) * 100) : 0;
                  const avg = session.summary.performance.averageScore;
                  return (
                    <button
                      key={session.planCacheKey}
                      onClick={() => onResume(session.planCacheKey)}
                      className="-mx-2 flex items-center justify-between gap-4 rounded-lg px-2 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {session.company} · {session.position}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
                          {MODE_LABEL[session.mode]} · {formatRelativeAge(session.updatedAt, now)} ·{" "}
                          {touched} of {session.totalQuestions} questions
                        </div>
                        <div className="mt-2 h-[5px] w-full max-w-[220px] rounded-full bg-chip">
                          <div className="h-[5px] rounded-full bg-live" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      {avg !== null && (
                        <div className="shrink-0 text-right font-display text-lg font-bold">
                          {avg.toFixed(1)}
                          <span className="text-xs font-normal text-faint">/10</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {cachedPlans.length > 0 && (
            <div className="space-y-3">
              <h3 className="px-1 text-sm font-medium text-muted-foreground">
                Prep packages
              </h3>
              <div className="space-y-2">
                {cachedPlans.map((plan) => (
                  <button
                    key={plan.cacheKey}
                    onClick={() => onOpenPackage(plan)}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border border-border bg-card",
                      "hover:shadow-md hover:border-border-strong transition-all duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                        <Package size={18} weight="duotone" className="text-brand" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">
                          {plan.company} · {plan.position}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {plan.round}
                        </p>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground/40 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {resumableSessions.length === 0 && cachedPlans.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No sessions yet — start your first one above.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3.5 flex items-baseline justify-between gap-2">
              <span className="font-display text-base font-semibold">Story bank</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {stories.length} {stories.length === 1 ? "story" : "stories"}
              </span>
            </div>
            {stories.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {stories.slice(0, 5).map((story) => (
                  <div key={story.id} className="flex items-center gap-2.5">
                    <span
                      className={cn("h-[7px] w-[7px] shrink-0 rounded-full", importanceDotClass(story.importance))}
                    />
                    <div className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                      {story.title}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No stories saved yet.</p>
            )}
            <Link
              href="/stories"
              className="mt-4 block rounded-lg border border-border-strong py-2 text-center text-[13px] font-semibold transition-colors hover:bg-foreground hover:text-background"
            >
              Open story bank
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
