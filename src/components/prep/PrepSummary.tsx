"use client";

import { Button } from "@/components/ui/button";
import type { PrepJobContext } from "@/lib/prep/job-context";
import type { PrepSessionSummary } from "@/lib/prep/session-progress";
import { PrepJobHeader } from "./PrepJobHeader";

export interface PrepSummaryProps {
  summary: PrepSessionSummary;
  jobContext: PrepJobContext;
  onPracticeReviewed: () => void;
  onRetryFocus: () => void;
  onOpenPackage: () => void;
  onViewStarred: () => void;
  onGoToApplication: () => void;
  onSameContextNewSession: () => void;
}

function questionOrdinal(questionId: string, questionIds?: string[]): string {
  if (!questionIds?.length) return questionId;
  const index = questionIds.indexOf(questionId);
  return index >= 0 ? `Question ${index + 1}` : questionId;
}

type PrepSummaryViewProps = PrepSummaryProps & {
  questionIds?: string[];
};

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function PrepSummary({
  summary,
  jobContext,
  questionIds,
  onPracticeReviewed,
  onRetryFocus,
  onOpenPackage,
  onViewStarred,
  onGoToApplication,
  onSameContextNewSession,
}: PrepSummaryViewProps) {
  const isLearn = summary.mode === "learn";
  const { progress, performance } = summary;
  const scoreLabels = Object.entries(performance.scoreLabelCounts);
  const hasFocus = performance.focusQuestionIds.length > 0;
  const hasReviewed = progress.reviewed > 0;
  const hasStarred = progress.starred > 0;

  return (
    <div className="w-full max-w-2xl animate-in fade-in duration-300">
      <PrepJobHeader jobContext={jobContext} />

      <h2 className="text-2xl font-semibold tracking-tight mb-6">Session summary</h2>

      <section className="mb-8" data-testid="prep-summary-progress">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Progress
        </h3>
        <div className="rounded-lg border border-border/60 bg-card/50 px-4">
          {isLearn ? (
            <>
              <ProgressRow label="Reviewed" value={progress.reviewed} />
              <ProgressRow label="Revealed" value={progress.revealed} />
              <ProgressRow label="Practiced" value={progress.practiced} />
              <ProgressRow label="Starred" value={progress.starred} />
              <ProgressRow label="Unreviewed" value={progress.unreviewed} />
            </>
          ) : (
            <>
              <ProgressRow label="Completed" value={progress.completed} />
              <ProgressRow label="Retried" value={progress.retried} />
              <ProgressRow label="Skipped" value={progress.skipped} />
            </>
          )}
        </div>
      </section>

      {!isLearn && (
        <section className="mb-8" data-testid="prep-summary-performance">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Performance
          </h3>
          <div className="rounded-lg border border-border/60 bg-card/50 px-4 py-4 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Average score</p>
              <p className="text-lg font-semibold tabular-nums">
                {performance.averageScore !== null
                  ? `${performance.averageScore.toFixed(1)} / 10`
                  : "—"}
                {performance.critiquedCount > 0 && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({performance.critiquedCount} scored)
                  </span>
                )}
              </p>
            </div>

            {scoreLabels.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Score distribution</p>
                <ul className="space-y-1">
                  {scoreLabels.map(([label, count]) => (
                    <li key={label} className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="tabular-nums font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-sm text-muted-foreground mb-2">Strongest responses</p>
              {performance.strongestQuestionIds.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">None yet</p>
              ) : (
                <ul className="space-y-1">
                  {performance.strongestQuestionIds.map((id) => (
                    <li key={id} className="text-sm">
                      {questionOrdinal(id, questionIds)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Focus questions</p>
              {performance.focusQuestionIds.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">None — great work!</p>
              ) : (
                <ul className="space-y-1">
                  {performance.focusQuestionIds.map((id) => (
                    <li key={id} className="text-sm">
                      {questionOrdinal(id, questionIds)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3">
        {isLearn ? (
          <Button
            className="w-full"
            onClick={onPracticeReviewed}
            disabled={!hasReviewed}
            data-testid="prep-summary-primary-cta"
          >
            Practice reviewed questions
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={onRetryFocus}
            disabled={!hasFocus}
            data-testid="prep-summary-primary-cta"
          >
            Retry focus questions
          </Button>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={onOpenPackage}>
            Open prep package
          </Button>
          <Button variant="outline" onClick={onViewStarred} disabled={!hasStarred}>
            View starred
          </Button>
          <Button variant="outline" onClick={onGoToApplication}>
            Go to application
          </Button>
          <Button variant="outline" onClick={onSameContextNewSession}>
            Start new session
          </Button>
        </div>
      </div>
    </div>
  );
}
