"use client";

import { useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { QuestionsGrid } from "@/components/dashboard/QuestionsGrid";
import { PrepJobHeader } from "./PrepJobHeader";
import type { PrepJobContext } from "@/lib/prep/job-context";
import type {
  PrepSessionMode,
  PrepSessionState,
  PrepSessionAction,
  PrepSessionQuestionProgress,
} from "@/lib/prep/session-progress";
import type { CompanyReconData, QuestionItem } from "@/types";

export function getSessionQuestionLabel(index: number, total: number): string {
  return `Question ${index + 1} of ${total}`;
}

export function shouldShowLearnActions(
  mode: PrepSessionMode,
  progress: PrepSessionQuestionProgress | undefined,
): boolean {
  if (mode !== "learn" || !progress) return false;
  if (!progress.revealedContent) return false;
  return progress.status === "revealed" || progress.status === "reviewed";
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
  onFinish: () => void;
  onSwitchToPractice: () => void;
  favoritedMap: Record<string, string>;
  onToggleFavorite: (question: string, isFavorited: boolean, favoriteId?: string) => void;
  isLoggedIn?: boolean;
  jobContextText?: string;
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

  const handleAdvance = useCallback(() => {
    if (currentIndex >= total - 1) {
      onFinish();
    } else {
      dispatch({ type: "SET_INDEX", index: currentIndex + 1 });
    }
  }, [currentIndex, total, onFinish, dispatch]);

  const handleUnderstand = useCallback(() => {
    if (!currentQuestion) return;
    dispatch({ type: "MARK_REVIEWED", questionId: currentQuestion.id });
    handleAdvance();
  }, [currentQuestion, dispatch, handleAdvance]);

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

  if (!currentQuestion || total === 0) {
    return (
      <div className="w-full max-w-2xl text-center py-12 text-muted-foreground">
        No questions in this session.
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl animate-in fade-in duration-300">
      <PrepJobHeader jobContext={jobContext} />

      <div
        data-testid="prep-session-question-counter"
        className="mb-4 text-center text-sm font-medium text-muted-foreground"
      >
        {getSessionQuestionLabel(currentIndex, total)}
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
  );
}
