"use client";

import { useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { QuestionsGrid } from "@/components/dashboard/QuestionsGrid";
import type { PrepJobContext } from "@/lib/prep/job-context";
import type {
  PrepSessionMode,
  PrepSessionState,
  PrepSessionAction,
  PrepSessionQuestionProgress,
} from "@/lib/prep/session-progress";
import { prepSessionReducer } from "@/lib/prep/session-progress";
import type { CompanyReconData, QuestionItem } from "@/types";
import { sessionCreditsLabel, type PrepEntitlement } from "./PrepModeSelection";
import { cn } from "@/lib/utils";

export function getSessionQuestionLabel(index: number, total: number): string {
  return `Question ${index + 1} of ${total}`;
}

/** Session header's anchor line (docs-mockup.html Comp E2 "anchor line …
 *  omit when generic"): only when the session's job context actually
 *  carries both a company and a job title — a generic (job-less) session
 *  has neither, and the mock says to omit the line entirely rather than
 *  render "anchored to · ·". Pure — no I/O. */
export function sessionAnchorLine(jobContext: PrepJobContext): string | null {
  const company = jobContext.identity.companyName?.trim();
  const title = jobContext.identity.jobTitle?.trim();
  if (!company || !title) return null;
  return `anchored to · ${title} · ${company}`;
}

/** Session-plan rail row status (docs-mockup.html Comp E2 "session plan rail
 *  … w/ progress states"): the current question always reads as "current"
 *  regardless of its stored status (revisiting an already-critiqued
 *  question mid-session still shows the pointer, not a checkmark); anything
 *  else counts as "done" once the user has moved past it in a terminal way
 *  for this pass (reviewed/critiqued/skipped) — a retried or merely-answered
 *  question is still "pending" since the user hasn't finished with it. */
export type SessionPlanRowStatus = "done" | "current" | "pending";
const DONE_STATUSES: PrepSessionQuestionProgress["status"][] = ["reviewed", "critiqued", "skipped"];

export function sessionPlanRowStatus(
  progress: PrepSessionQuestionProgress | undefined,
  isCurrent: boolean,
): SessionPlanRowStatus {
  if (isCurrent) return "current";
  if (progress && DONE_STATUSES.includes(progress.status)) return "done";
  return "pending";
}

/** Session-plan rail row label: the real short tag a question was generated
 *  with (`topics[0]`) when there is one, otherwise a truncated copy of the
 *  real question text — never a fabricated paraphrase (there is no field
 *  that holds a human-authored short label for a question). */
export function planRowLabel(q: QuestionItem): string {
  const topic = q.topics?.[0]?.trim();
  if (topic) return topic;
  const text = q.question.trim();
  return text.length > 46 ? `${text.slice(0, 46).trimEnd()}…` : text;
}

export function shouldShowLearnActions(
  mode: PrepSessionMode,
  progress: PrepSessionQuestionProgress | undefined,
): boolean {
  if (mode !== "learn" || !progress) return false;
  if (!progress.revealedContent) return false;
  return progress.status === "revealed" || progress.status === "reviewed";
}

/** Post-reducer state for onFinish after "I understand" — avoids stale closure snapshot. */
export function sessionStateAfterMarkReviewed(
  sessionState: PrepSessionState,
  questionId: string,
): PrepSessionState {
  const next = prepSessionReducer(sessionState, {
    type: "MARK_REVIEWED",
    questionId,
  });
  if (!next) {
    throw new Error(`MARK_REVIEWED failed for question ${questionId}`);
  }
  return next;
}

export interface PrepSessionViewProps {
  mode: PrepSessionMode;
  jobContext: PrepJobContext;
  questions: QuestionItem[];
  sessionState: PrepSessionState;
  dispatch: (action: PrepSessionAction) => void;
  company: string;
  position: string;
  round: string;
  reconData?: CompanyReconData;
  onGenerateReveal: (question: QuestionItem) => Promise<string>;
  onRequireAuth: () => void;
  onFinish: (sessionState: PrepSessionState) => void;
  onSwitchToPractice: () => void;
  favoritedMap: Record<string, string>;
  onToggleFavorite: (question: string, isFavorited: boolean, favoriteId?: string) => void;
  isLoggedIn?: boolean;
  jobContextText?: string;
  /** For the header's "credits: N left" statline — omitted for null/admin/BYOK. */
  entitlement?: PrepEntitlement | null;
}

export function PrepSessionView({
  mode,
  jobContext,
  questions,
  sessionState,
  dispatch,
  company,
  position,
  round,
  reconData,
  onGenerateReveal,
  onRequireAuth,
  onFinish,
  onSwitchToPractice,
  favoritedMap,
  onToggleFavorite,
  isLoggedIn = false,
  jobContextText,
  entitlement,
}: PrepSessionViewProps) {
  const sessionQuestions = useMemo(() => {
    const byId = new Map(questions.map((q) => [q.id, q]));
    return sessionState.questionIds
      .map((id) => byId.get(id))
      .filter((q): q is QuestionItem => !!q);
  }, [questions, sessionState.questionIds]);

  const total = sessionQuestions.length;
  const currentIndex = sessionState.currentIndex;
  const currentQuestion = sessionQuestions[currentIndex];
  const currentProgress = currentQuestion
    ? sessionState.questions[currentQuestion.id]
    : undefined;

  const handleAdvance = useCallback(
    (stateForFinish: PrepSessionState = sessionState) => {
      if (currentIndex >= total - 1) {
        onFinish(stateForFinish);
      } else {
        dispatch({ type: "SET_INDEX", index: currentIndex + 1 });
      }
    },
    [currentIndex, total, onFinish, dispatch, sessionState],
  );

  const handleUnderstand = useCallback(() => {
    if (!currentQuestion) return;
    const next = sessionStateAfterMarkReviewed(sessionState, currentQuestion.id);
    dispatch({ type: "MARK_REVIEWED", questionId: currentQuestion.id });
    handleAdvance(next);
  }, [currentQuestion, dispatch, handleAdvance, sessionState]);

  const handlePracticeOne = useCallback(() => {
    if (!currentQuestion) return;
    dispatch({ type: "PRACTICE_ONE", questionId: currentQuestion.id });
    onSwitchToPractice();
  }, [currentQuestion, dispatch, onSwitchToPractice]);

  const handleIndexChange = useCallback(
    (index: number) => {
      dispatch({ type: "SET_INDEX", index });
    },
    [dispatch],
  );

  const showLearnActions = shouldShowLearnActions(mode, currentProgress);
  const anchorLine = sessionAnchorLine(jobContext);
  const creditsLabel = sessionCreditsLabel(entitlement);

  if (!currentQuestion || total === 0) {
    return (
      <div className="w-full max-w-2xl text-center py-12 text-muted-foreground">
        No questions in this session.
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl animate-in fade-in duration-300">
      {/* Session header (docs-mockup.html Comp E2): a mono green anchor line
          when this session is anchored to a real job, ONLY the generic
          "Prep session" title otherwise — never a fabricated anchor. */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          {anchorLine && (
            <div
              data-testid="prep-session-anchor"
              className="font-mono text-[11px] uppercase tracking-[0.1em] text-brand"
            >
              {anchorLine}
            </div>
          )}
          <h1 className={cn("font-display text-[28px] font-extrabold tracking-tight", anchorLine && "mt-1.5")}>
            Prep session
          </h1>
          {round && <p className="mt-1 text-[13px] text-muted-foreground">{round} round</p>}
        </div>
        <div className="shrink-0 text-right font-mono text-[12px] text-muted-foreground">
          <span data-testid="prep-session-question-counter">{getSessionQuestionLabel(currentIndex, total)}</span>
          {creditsLabel && <span> · {creditsLabel}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          {/* Learn/Practice squared tabs (Comp E2) — a real, bidirectional
              SWITCH_MODE dispatch. The reducer already supports either
              direction (session-progress.ts's SWITCH_MODE case is a plain
              `{ ...state, mode: action.mode }`); only the Practice→Learn UI
              trigger was previously missing (the only existing caller,
              onSwitchToPractice, only ever dispatches "practice"). */}
          <div className="mb-3.5 inline-flex border border-border" data-testid="prep-session-mode-tabs">
            {(["practice", "learn"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => dispatch({ type: "SWITCH_MODE", mode: m })}
                aria-pressed={mode === m}
                className={cn(
                  "px-5 py-2 text-[13px] font-semibold capitalize transition-colors",
                  mode === m
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>

          <QuestionsGrid
            questions={questions}
            onGenerateStrategy={async (_index, question) => onGenerateReveal(question)}
            company={company}
            position={position}
            round={round}
            reconData={reconData}
            favoritedMap={favoritedMap}
            onToggleFavorite={onToggleFavorite}
            isLoggedIn={isLoggedIn}
            onRequireAuth={onRequireAuth}
            sessionMode={mode}
            sessionQuestionIds={sessionState.questionIds}
            sessionIndex={currentIndex}
            onSessionIndexChange={handleIndexChange}
            externalDispatch={dispatch}
            sessionProgress={sessionState.questions}
            jobContextText={jobContextText}
            onSessionContinue={handleAdvance}
          />

          {showLearnActions && (
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                variant="outline"
                onClick={handlePracticeOne}
                className="w-full sm:w-auto"
              >
                Practice this question
              </Button>
              <Button onClick={handleUnderstand} className="w-full sm:w-auto">
                I understand
              </Button>
            </div>
          )}
        </div>

        {/* Session plan rail (Comp E2 "session plan rail as mono checklist
            from the session's real question list w/ progress states") — the
            same `sessionQuestions`/`sessionState` this view already reads,
            no separate data source to drift from the actual session. */}
        <div className="h-fit border border-border bg-card p-4" data-testid="prep-session-plan">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Session plan
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {sessionQuestions.map((q, i) => {
              const status = sessionPlanRowStatus(sessionState.questions[q.id], i === currentIndex);
              return (
                <div
                  key={q.id}
                  className={cn(
                    "flex items-baseline gap-2 font-mono text-[12px]",
                    status === "current" && "font-semibold text-foreground",
                    status === "done" && "text-verdict-live",
                    status === "pending" && "text-muted-foreground",
                  )}
                >
                  <span aria-hidden="true" className="shrink-0 tabular-nums">
                    {status === "done" ? "✓" : status === "current" ? "▸" : i + 1}
                  </span>
                  <span className="truncate">{planRowLabel(q)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
