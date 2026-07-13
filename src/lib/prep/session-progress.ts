import type { AnswerCritique } from "@/types/index";
import type { PrepJobContext } from "@/lib/prep/job-context";
import { emptyPrepJobContext } from "@/lib/prep/job-context";

export type PrepSessionMode = "learn" | "practice";

export type PrepSessionQuestionStatus =
  | "unreviewed"
  | "revealed"
  | "reviewed"
  | "answered"
  | "critiqued"
  | "retried"
  | "skipped";

export interface PrepSessionQuestionProgress {
  questionId: string;
  status: PrepSessionQuestionStatus;
  starred: boolean;
  answerText?: string;
  critique?: AnswerCritique;
  revealedAt?: string;
  /** Rendered HTML for the suggested answer shown after a successful reveal. */
  revealedContent?: string;
  practicedAt?: string;
}

export interface PrepSessionState {
  version: 1;
  planCacheKey: string;
  mode: PrepSessionMode;
  startedAt: string;
  updatedAt: string;
  currentIndex: number;
  questionIds: string[];
  questions: Record<string, PrepSessionQuestionProgress>;
  /** Job context used when the session started (for reveal/critique on resume). */
  jobContext?: PrepJobContext;
}

export interface PrepSessionProgressCounts {
  reviewed: number;
  revealed: number;
  practiced: number;
  starred: number;
  unreviewed: number;
  completed: number;
  retried: number;
  skipped: number;
}

export interface PrepSessionPerformance {
  answeredCount: number;
  critiquedCount: number;
  averageScore: number | null;
  scoreLabelCounts: Record<string, number>;
  strongestQuestionIds: string[];
  focusQuestionIds: string[];
}

export interface PrepSessionSummary {
  mode: PrepSessionMode;
  progress: PrepSessionProgressCounts;
  performance: PrepSessionPerformance;
}

export type PrepSessionAction =
  | {
      type: "START";
      planCacheKey: string;
      mode: PrepSessionMode;
      questionIds: string[];
      jobContext?: PrepJobContext;
    }
  | { type: "REVEAL"; questionId: string; revealedContent: string }
  | { type: "MARK_REVIEWED"; questionId: string }
  | { type: "PRACTICE_ONE"; questionId: string }
  | { type: "SET_ANSWER"; questionId: string; answerText: string }
  | { type: "SET_CRITIQUE"; questionId: string; critique: AnswerCritique }
  | { type: "RETRY"; questionId: string }
  | { type: "SKIP"; questionId: string }
  | { type: "TOGGLE_STAR"; questionId: string }
  | { type: "SET_INDEX"; index: number }
  | { type: "SWITCH_MODE"; mode: PrepSessionMode }
  | {
      type: "CONTINUE_WITH";
      questionIds: string[];
      mode?: PrepSessionMode;
      retryQuestionIds?: string[];
    };

const SESSION_STORAGE_PREFIX = "intervu_prep_session_v1_";
const STRONG_SCORE_THRESHOLD = 7;

function nowIso(): string {
  return new Date().toISOString();
}

function emptyQuestionProgress(questionId: string): PrepSessionQuestionProgress {
  return {
    questionId,
    status: "unreviewed",
    starred: false,
  };
}

function touchState(state: PrepSessionState): PrepSessionState {
  return { ...state, updatedAt: nowIso() };
}

function updateQuestion(
  state: PrepSessionState,
  questionId: string,
  patch: Partial<PrepSessionQuestionProgress>,
): PrepSessionState {
  const existing = state.questions[questionId];
  if (!existing) return state;

  return touchState({
    ...state,
    questions: {
      ...state.questions,
      [questionId]: { ...existing, ...patch },
    },
  });
}

export function emptySessionState(
  planCacheKey: string,
  mode: PrepSessionMode,
  questionIds: string[],
  jobContext?: PrepJobContext,
): PrepSessionState {
  const timestamp = nowIso();
  const questions: Record<string, PrepSessionQuestionProgress> = {};
  for (const questionId of questionIds) {
    questions[questionId] = emptyQuestionProgress(questionId);
  }

  return {
    version: 1,
    planCacheKey,
    mode,
    startedAt: timestamp,
    updatedAt: timestamp,
    currentIndex: 0,
    questionIds,
    questions,
    ...(jobContext ? { jobContext } : {}),
  };
}

export function prepSessionReducer(
  state: PrepSessionState | null,
  action: PrepSessionAction,
): PrepSessionState | null {
  switch (action.type) {
    case "START":
      return emptySessionState(
        action.planCacheKey,
        action.mode,
        action.questionIds,
        action.jobContext,
      );

    case "REVEAL":
      if (!state) return state;
      return updateQuestion(state, action.questionId, {
        status: "revealed",
        revealedAt: nowIso(),
        revealedContent: action.revealedContent,
      });

    case "MARK_REVIEWED":
      if (!state) return state;
      return updateQuestion(state, action.questionId, { status: "reviewed" });

    case "PRACTICE_ONE":
      if (!state) return state;
      return updateQuestion(state, action.questionId, { practicedAt: nowIso() });

    case "SET_ANSWER":
      if (!state) return state;
      return updateQuestion(state, action.questionId, {
        status: "answered",
        answerText: action.answerText,
      });

    case "SET_CRITIQUE":
      if (!state) return state;
      return updateQuestion(state, action.questionId, {
        status: "critiqued",
        critique: action.critique,
      });

    case "RETRY":
      if (!state) return state;
      return updateQuestion(state, action.questionId, {
        status: "retried",
        critique: undefined,
      });

    case "SKIP":
      if (!state) return state;
      return updateQuestion(state, action.questionId, { status: "skipped" });

    case "TOGGLE_STAR":
      if (!state) return state;
      return updateQuestion(state, action.questionId, {
        starred: !state.questions[action.questionId]?.starred,
      });

    case "SET_INDEX":
      if (!state) return state;
      return touchState({ ...state, currentIndex: action.index });

    case "SWITCH_MODE":
      if (!state) return state;
      return touchState({ ...state, mode: action.mode });

    case "CONTINUE_WITH": {
      if (!state) return state;
      const validIds = action.questionIds.filter((id) => state.questions[id]);
      if (validIds.length === 0) return state;

      let next: PrepSessionState = touchState({
        ...state,
        questionIds: validIds,
        currentIndex: 0,
        ...(action.mode !== undefined ? { mode: action.mode } : {}),
      });

      for (const questionId of action.retryQuestionIds ?? []) {
        const question = next.questions[questionId];
        if (!question) continue;
        if (
          question.critique !== undefined ||
          question.status === "critiqued" ||
          question.status === "skipped"
        ) {
          next = updateQuestion(next, questionId, {
            status: "retried",
            critique: undefined,
          });
        }
      }

      return next;
    }

    default:
      return state;
  }
}

function countByStatus(
  state: PrepSessionState,
  status: PrepSessionQuestionStatus,
): number {
  return state.questionIds.filter((id) => state.questions[id]?.status === status).length;
}

function hasNonEmptyAnswer(question: PrepSessionQuestionProgress): boolean {
  return Boolean(question.answerText && question.answerText.trim().length > 0);
}

function isScoredQuestion(question: PrepSessionQuestionProgress): boolean {
  return (
    (question.status === "critiqued" || question.status === "retried") &&
    question.critique !== undefined
  );
}

export function buildSessionSummary(state: PrepSessionState): PrepSessionSummary {
  const questions = state.questionIds.map((id) => state.questions[id]);

  const progress: PrepSessionProgressCounts = {
    reviewed: countByStatus(state, "reviewed"),
    revealed: countByStatus(state, "revealed"),
    practiced: questions.filter((q) => q?.practicedAt).length,
    starred: questions.filter((q) => q?.starred).length,
    unreviewed: countByStatus(state, "unreviewed"),
    completed: countByStatus(state, "critiqued"),
    retried: countByStatus(state, "retried"),
    skipped: countByStatus(state, "skipped"),
  };

  const answeredCount = questions.filter((q) => q && hasNonEmptyAnswer(q)).length;
  const scoredQuestions = questions.filter((q): q is PrepSessionQuestionProgress =>
    Boolean(q && isScoredQuestion(q)),
  );
  const critiquedCount = scoredQuestions.length;

  const scoreLabelCounts: Record<string, number> = {};
  let scoreSum = 0;
  for (const question of scoredQuestions) {
    const label = question.critique!.scoreLabel;
    scoreLabelCounts[label] = (scoreLabelCounts[label] ?? 0) + 1;
    scoreSum += question.critique!.score;
  }

  const averageScore =
    critiquedCount > 0 ? scoreSum / critiquedCount : null;

  const strongestQuestionIds = scoredQuestions
    .filter((q) => q.critique!.score >= STRONG_SCORE_THRESHOLD)
    .sort((a, b) => b.critique!.score - a.critique!.score)
    .map((q) => q.questionId);

  const focusQuestionIds = state.questionIds.filter((id) => {
    const question = state.questions[id];
    if (!question) return false;
    if (question.status === "skipped") return true;
    return question.critique !== undefined && question.critique.score <= 5;
  });

  return {
    mode: state.mode,
    progress,
    performance: {
      answeredCount,
      critiquedCount,
      averageScore,
      scoreLabelCounts,
      strongestQuestionIds,
      focusQuestionIds,
    },
  };
}

export function sessionStorageKey(planCacheKey: string): string {
  return `${SESSION_STORAGE_PREFIX}${planCacheKey}`;
}

/** Restore PrepJobContext from persisted session state (falls back to empty context). */
export function resolveSessionJobContext(
  state: PrepSessionState,
  company: string,
  position: string,
  round: string,
): PrepJobContext {
  const base = state.jobContext
    ? state.jobContext
    : emptyPrepJobContext(company, position, round);

  return {
    ...base,
    identity: {
      ...base.identity,
      companyName: base.identity.companyName || company,
      jobTitle: base.identity.jobTitle || position,
    },
    interview: {
      ...base.interview,
      round: base.interview.round || round,
      sessionMode: state.mode,
    },
  };
}

/** JD text from session blob only — empty when not stored (clears stale legacy state). */
export function sessionJobContextText(state: PrepSessionState): string {
  return state.jobContext?.content?.originalJd?.trim() ?? "";
}

const REVEAL_FAILURE_PATTERNS = [
  /^error generating text\.?$/i,
  /^failed to generate/i,
  /^generation failed/i,
];

/** True when reveal generation returned an error sentinel or placeholder text. */
export function isRevealGenerationFailure(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("AUTH_REQUIRED") || trimmed.startsWith("OUT_OF_CREDITS")) {
    return true;
  }
  return REVEAL_FAILURE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function serializeSessionState(state: PrepSessionState): string {
  return JSON.stringify(state);
}

function isValidSessionState(value: unknown): value is PrepSessionState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PrepSessionState;
  return (
    candidate.version === 1 &&
    typeof candidate.planCacheKey === "string" &&
    (candidate.mode === "learn" || candidate.mode === "practice") &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.currentIndex === "number" &&
    Array.isArray(candidate.questionIds) &&
    typeof candidate.questions === "object" &&
    candidate.questions !== null
  );
}

export function parseSessionState(raw: string): PrepSessionState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSessionState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
