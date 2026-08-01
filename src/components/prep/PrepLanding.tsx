"use client";

import { useState } from "react";
import Link from "next/link";
import type { CachedPlanListItem, ResumableSessionItem } from "@/lib/prep/plan-list";
import type { StarStory } from "@/types";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

/**
 * Ledger-style ruled row shared by both list sections below (recent sessions,
 * prep packages) — one row shape, not two near-identical ones (writing-lean-
 * code rule 2: single source of truth for a repeated structural pattern).
 */
function RuledRow({
  onClick,
  testId,
  title,
  meta,
  trailing,
}: {
  onClick: () => void;
  testId?: string;
  title: string;
  meta: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 border-b border-border py-3 text-left transition-colors duration-100 hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{title}</div>
        <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">{meta}</div>
      </div>
      {trailing && <div className="shrink-0 font-mono text-[13px] font-medium text-foreground">{trailing}</div>}
    </button>
  );
}

/**
 * Honest completeness signal for the story bank glyph row. StarStory carries
 * no "readiness" field, so this counts how many of the real content fields a
 * row actually has — same blob-vs-STAR content shape StoryCard.tsx already
 * uses to decide what to render — rather than reusing `importance` (a
 * different concern: how much the story matters, not how complete it is; see
 * writing-lean-code rule 4, one concern per field).
 */
type StoryReadiness = "ready" | "draft" | "missing";
function storyReadiness(story: StarStory): StoryReadiness {
  const fields =
    story.type === "blob" || (!story.situation && story.content)
      ? [story.content]
      : [story.situation, story.task, story.action, story.result];
  const filled = fields.filter((f) => (f ?? "").trim().length > 0).length;
  if (filled === 0) return "missing";
  if (filled === fields.length) return "ready";
  return "draft";
}

/** Verdict-channel color only (anti-marker: color appears ONLY in the
 *  verdict channel) — reuses the same tokens the jobs ledger's verdict cell
 *  reads (`--verdict-live`/`--verdict-caution`), not a new palette. */
const READINESS_META: Record<StoryReadiness, { glyph: string; cls: string }> = {
  ready: { glyph: "■", cls: "text-verdict-live" },
  draft: { glyph: "▲", cls: "text-verdict-caution" },
  missing: { glyph: "—", cls: "text-faint" },
};

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

  const hasSessions = resumableSessions.length > 0;
  const hasPlans = cachedPlans.length > 0;
  const storyCounts = { ready: 0, draft: 0, missing: 0 };
  for (const story of stories) storyCounts[storyReadiness(story)]++;

  return (
    <div className="w-full max-w-5xl">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-7">
            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.02em]">Interview prep</h1>
            <p className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">
              {prepLandingSubline(cachedPlans, resumableSessions)}
            </p>
          </div>

          <section className="border-b border-border pb-6">
            <h2 className="font-display text-[19px] font-semibold">New prep session</h2>
            <p className="mt-2 max-w-[520px] text-[13.5px] leading-relaxed text-muted-foreground">
              Learn: review real questions and model answers at your own pace. Practice: answer aloud and get AI
              critique on your responses.
            </p>
            <div className="mt-4 flex items-center gap-5">
              <Button onClick={onStartNew} data-testid="prep-start-new">
                Start session
              </Button>
              <button
                type="button"
                onClick={onSearch}
                className="font-mono text-[12px] text-muted-foreground underline underline-offset-4 transition-colors duration-100 hover:text-foreground"
              >
                Search plans
              </button>
            </div>
          </section>

          {hasSessions && (
            <section className="mt-7">
              <div className="border-b border-border pb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                recent sessions
              </div>
              <div>
                {resumableSessions.slice(0, 4).map((session) => {
                  const touched = session.totalQuestions - session.summary.progress.unreviewed;
                  const avg = session.summary.performance.averageScore;
                  return (
                    <RuledRow
                      key={session.planCacheKey}
                      testId="prep-recent-session-row"
                      onClick={() => onResume(session.planCacheKey)}
                      title={`${session.company} · ${session.position}`}
                      meta={`${MODE_LABEL[session.mode]} · ${formatRelativeAge(session.updatedAt, now)} · ${touched}/${session.totalQuestions}`}
                      trailing={avg !== null ? `${avg.toFixed(1)}/10` : undefined}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {hasPlans && (
            <section className="mt-7">
              <div className="border-b border-border pb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                prep packages
              </div>
              <div>
                {cachedPlans.map((plan) => (
                  <RuledRow
                    key={plan.cacheKey}
                    onClick={() => onOpenPackage(plan)}
                    title={`${plan.company} · ${plan.position}`}
                    meta={plan.round}
                  />
                ))}
              </div>
            </section>
          )}

          {!hasSessions && !hasPlans && (
            <p className="mt-7 text-[13.5px] text-muted-foreground">No sessions yet — start one above.</p>
          )}
        </div>

        <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Story bank
            </span>
            <Link
              href="/stories"
              className="font-mono text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
            >
              open story bank →
            </Link>
          </div>
          <p className="font-mono text-[12.5px] text-foreground">
            <span className="tabular-nums">{storyCounts.ready}</span> ready · <span className="tabular-nums">{storyCounts.draft}</span> draft · <span className="tabular-nums">{storyCounts.missing}</span> missing
          </p>
          {stories.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {stories.slice(0, 5).map((story) => {
                const meta = READINESS_META[storyReadiness(story)];
                return (
                  <div key={story.id} className="flex items-center gap-2 text-[13px]">
                    <span className={cn("font-mono", meta.cls)} aria-hidden="true">
                      {meta.glyph}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{story.title}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">No stories saved yet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
