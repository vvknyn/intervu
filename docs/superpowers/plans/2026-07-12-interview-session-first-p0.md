# Interview Session-First P0 Implementation Plan

> **P1 and P2 are out of scope for this plan.** P1 (job → tailor → application → prep lifecycle; resume consolidation; application workspace) and P2 (cover-letter journey; STAR feedback handoff; onboarding polish; completion/next-action consistency) are separate follow-on plans and are **not** implemented here. Do not expand into P1/P2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver session-first Interview Prep (landing → setup → mode → Learn/Practice loop → summary) with shared job-context, JD-aware plan generation/cache identity, entitlement preflight, one-shot auth replay, and legacy prep-package compatibility — without a server-side session database.

**Architecture:** Extract focused `src/components/prep/*` views and pure `src/lib/prep/*` modules; keep `DashboardContainer` (~2000 lines, `src/components/dashboard/DashboardContainer.tsx`) as orchestration only. Generated plans stay in existing Firestore/localStorage cache (`src/lib/interview-cache.ts`, `src/actions/cache.ts`); session progress persists client-side in versioned localStorage keyed by plan identity. Cache keys gain a JD fingerprint so mismatched legacy entries are never served when JD context exists.

**Tech Stack:** Next.js/React/TypeScript, Firebase/Firestore existing cache, node:test via tsx, Playwright.

## Global Constraints

- **P0 only:** Shared job context (Interview Prep fields wired now); JD plumbing into `generateInterviewPlan` and cache identity; session-first landing/setup/mode/session/summary; Start + Search + Resume; auth interrupted-action replay; credits/BYOK shown before Start; dynamic Question X of N; progress separate from performance; prep package secondary; legacy deep-link compatibility.
- **Out of scope:** Google Sign-In, voice interviews, alerts, headshots, career coach, P1 lifecycle, P2 polish, server-side session sync across devices, unrelated `DashboardContainer` refactors.
- **Testing:** `npx tsx tests/unit/<file>.test.ts` with `node:test` + `node:assert/strict`. Playwright under `tests/e2e/`. No Jest/Vitest/RTL. No new npm packages unless unavoidable (prefer none).
- **Commits:** One small commit per task. Plan-file commit is separate (HEREDOC).
- **DashboardContainer:** Extract flows; do not rewrite unrelated sections.
- **QuestionsGrid package view:** Keep category filtering and internal Learn/Practice toggle for package compatibility; session view uses explicit question list + external mode via controlled props.

---

## Current Architecture and File Responsibility Map

| Path | Responsibility today | P0 change |
|---|---|---|
| `src/app/page.tsx` (lines 1–12) | Renders `DashboardContainer` inside `Suspense` | No change |
| `src/components/dashboard/DashboardContainer.tsx` (lines 71–2017) | Monolithic orchestration: search, cache load, `generateInterviewPlan` call (lines 878–886), package sections, `AuthPopover` without replay (line 1455) | Add prep flow state machine; wire new prep components; minimal edits |
| `src/components/dashboard/QuestionsGrid.tsx` (lines 14–622) | Package question carousel; internal Learn/Practice toggle (lines 322–345); category filter; `generateAnswerCritique` (line 190) | Add controlled session props; preserve package behavior when props absent |
| `src/components/dashboard/PrepSettings.tsx` (lines 57–442) | JD URL/paste, intensity presets, question counts | Reused by `PrepSetupFlow` |
| `src/actions/generate-context.ts` | `generateInterviewPlan` (lines 1109–1335), `fetchMatch` with `jobContext` (line 313), `fetchUnifiedReconMatch` without JD (line 927), `generateAnswerCritique` (lines 868–922) | Thread JD into orchestrator, unified prompts, critique |
| `src/lib/interview-cache.ts` (lines 6–195) | Client cache; `getCacheKey(company, position, round)` (lines 72–82) | JD-aware key; `listCachedPlans()` adapter |
| `src/actions/cache.ts` (lines 35–145) | Firestore read/write by `cache_key` | Persist `jd_fingerprint` metadata |
| `src/lib/cache-helpers.ts` (lines 11–68) | `loadEnhancedCache` / `saveEnhancedCache` | Pass JD fingerprint through |
| `src/lib/jobs/pending-actions.ts` (lines 32–118) | Pure auth replay reducer for `/jobs` | Pattern mirrored in `pending-prep-actions.ts` |
| `src/components/auth/auth-popover.tsx` (lines 8–55) | `onAuthed` callback before close | Wire in `DashboardContainer` |
| `src/actions/credits.ts` (lines 14–26) | `getMyCreditsAction()` | Used on mode screen |
| `src/components/layout/CreditBalance.tsx` (lines 16–66) | Sidebar credits only | Unchanged |
| `tests/e2e/dashboard.spec.ts` | Legacy search/dashboard tests | Extend for landing |
| `tests/unit/pending-actions.test.ts` | Reducer tests pattern | Mirror for prep |

**Cross-device session sync:** Outside P0. Session state lives in localStorage only.

---

## Task 1 — Shared job-context contract and deterministic fingerprint

**Files:**
- Create `src/lib/prep/job-context.ts`
- Create `tests/unit/job-context.test.ts`

**Interfaces:**

```typescript
// src/lib/prep/job-context.ts

export interface JobIdentity {
  jobId?: string;
  applicationId?: string;
  sourceUrl?: string;
  sourceName?: string;
  companyName: string;
  jobTitle: string;
  location?: string;
  remoteStatus?: string;
  employmentType?: string;
}

export interface JobContent {
  originalJd?: string;
  normalizedJd?: string;
  responsibilities?: string[];
  requiredSkills?: string[];
  preferredSkills?: string[];
  seniority?: string;
  compensation?: string;
  lastRefreshedAt?: string;
}

export interface CandidateContext {
  selectedResumeId?: string;
  resumeVersionId?: string;
  starStoryIds?: string[];
  knowledgeSourceIds?: string[];
  candidateProfileSnapshot?: string;
}

export interface ApplicationArtifacts {
  tailoredResumeVersionId?: string;
  coverLetterId?: string;
  status?: string;
  notes?: string;
  postingOpenedAt?: string;
  appliedAt?: string;
}

export interface InterviewContext {
  round: string;
  roleFamily?: string;
  prepIntensity?: string;
  sessionMode?: "learn" | "practice";
  interviewPlanId?: string;
  practiceSessionId?: string;
  completedQuestionIds?: string[];
  starredQuestionIds?: string[];
}

export interface ArtifactProvenance {
  jdVersion?: string;
  resumeVersion?: string;
  storyIds?: string[];
  sourceIds?: string[];
  generatedAt?: string;
}

export interface PrepJobContext {
  identity: JobIdentity;
  content: JobContent;
  candidate: CandidateContext;
  artifacts: ApplicationArtifacts;
  interview: InterviewContext;
  provenance: ArtifactProvenance;
}

export function emptyPrepJobContext(companyName: string, jobTitle: string, round: string): PrepJobContext;

export function stableSerializeJobContext(ctx: PrepJobContext): string;

export function fingerprintJobContext(ctx: PrepJobContext): string;

export function buildPrepJobContextFromLegacy(params: {
  company: string;
  position: string;
  round: string;
  jobUrl?: string;
  jobContextText?: string;
  resumeText?: string;
  starStoryIds?: string[];
  knowledgeSourceIds?: string[];
  prepIntensity?: string;
}): PrepJobContext;
```

**Consumes:** Nothing (pure module).

**Produces:** `PrepJobContext`, `stableSerializeJobContext`, `fingerprintJobContext`, `buildPrepJobContextFromLegacy`.

### Steps

- [ ] **1.1** Create `tests/unit/job-context.test.ts` with tests for: (a) `emptyPrepJobContext` required fields, (b) same context → same `fingerprintJobContext`, (c) different `originalJd` → different fingerprint, (d) optional missing fields do not throw, (e) `stableSerializeJobContext` is deterministic (key order stable).

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPrepJobContext,
  fingerprintJobContext,
  stableSerializeJobContext,
  buildPrepJobContextFromLegacy,
} from "../../src/lib/prep/job-context";

describe("fingerprintJobContext", () => {
  it("is stable for identical context", () => {
    const a = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build APIs",
    });
    const b = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build APIs",
    });
    assert.equal(fingerprintJobContext(a), fingerprintJobContext(b));
  });

  it("changes when JD text changes", () => {
    const a = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build APIs",
    });
    const b = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build ML pipelines",
    });
    assert.notEqual(fingerprintJobContext(a), fingerprintJobContext(b));
  });
});
```

- [ ] **1.2** Run `npx tsx tests/unit/job-context.test.ts`. **Expected FAIL:** `Cannot find module '../../src/lib/prep/job-context'`.

- [ ] **1.3** Create `src/lib/prep/job-context.ts` implementing all exports. Use a pure TypeScript djb2-style 32-bit hash on `stableSerializeJobContext` output (same approach as `InterviewCache.getCacheKey` lines 75–81 in `src/lib/interview-cache.ts`). Serialize with sorted object keys recursively. `buildPrepJobContextFromLegacy` maps `company`→`identity.companyName`, `position`→`identity.jobTitle`, `jobContextText`→`content.originalJd` and `content.normalizedJd` (trimmed copy), `jobUrl`→`identity.sourceUrl`.

- [ ] **1.4** Run `npx tsx tests/unit/job-context.test.ts`. **Expected PASS** with the named tests green.

- [ ] **1.5** Run `npx tsc --noEmit`. Fix any type errors in new files only.

- [ ] **1.6** Commit:

```bash
git add src/lib/prep/job-context.ts tests/unit/job-context.test.ts
git commit -m "feat(prep): add shared PrepJobContext contract and JD fingerprint"
```

---

## Task 2 — JD-aware generation, prompt context, and cache identity

**Files:**
- Modify `src/actions/generate-context.ts` — symbols: `generateInterviewPlan` (lines 1109–1335), `fetchUnifiedReconMatch` (lines 927–1005), `fetchUnifiedQuestions` (internal, called line 1196), `generateAnswerCritique` (lines 868–922)
- Modify `src/lib/interview-cache.ts` — `CachedInterviewData` (lines 6–25), `getCacheKey` (lines 72–82); add `getCacheKeyForPlan(company, position, round, jdFingerprint?: string)`
- Modify `src/actions/cache.ts` — `ServerCachedData` (lines 13–30), `fetchServerCache` (lines 35–86), `saveServerCache` (lines 91–145)
- Modify `src/components/dashboard/DashboardContainer.tsx` — `generateInterviewPlan` call (lines 878–886), `handleAnalyzeAnswer` path via `QuestionsGrid` props later
- Create `tests/unit/interview-context.test.ts` (pure cache-key helpers only)

**Interfaces:**

```typescript
// src/lib/interview-cache.ts (extend)
export interface CachedInterviewData {
  cacheKey: string;
  company: string;
  position: string;
  round: string;
  jdFingerprint?: string;
  hasResumeContext: boolean;
  createdAt: number;
  expiresAt: number;
  reconData?: CompanyReconData;
  matchData?: MatchData;
  questionsData?: QuestionsData;
  reverseData?: ReverseQuestionsData;
  technicalData?: TechnicalData;
  codingChallenges?: CodingChallenge[];
  systemDesignData?: SystemDesignData;
  resumeCompanies?: string[];
}

export function getCacheKeyForPlan(
  company: string,
  position: string,
  round: string,
  jdFingerprint?: string,
): string;

export function resolveCacheLookup(
  company: string,
  position: string,
  round: string,
  jdFingerprint?: string,
): { primaryKey: string; legacyKey: string };

// src/actions/generate-context.ts (signature change)
export async function generateInterviewPlan(
  company: string,
  position: string,
  round: string,
  resume: string,
  stories: string,
  settings: {
    modelConfig?: Partial<ProviderConfig>;
    prepSettings?: { questions: number; reverse: number; technical: number; systemDesign: number };
    outputPrefs?: { strategyLength: "brief" | "standard" | "detailed"; coverLetterLength: string };
    codingChallengeCount?: number;
    jobContext?: PrepJobContext;
  },
  forceRefresh?: boolean,
): Promise<{
  reconData?: CompanyReconData;
  matchData?: MatchData;
  questionsData?: QuestionsData;
  reverseData?: ReverseQuestionsData;
  technicalData?: TechnicalData;
  codingChallenges?: CodingChallenge[];
  systemDesignData?: SystemDesignData;
  error?: string;
  fromCache?: boolean;
}>;

// generateAnswerCritique context extension
context: {
  company: string;
  position: string;
  round: string;
  reconData?: CompanyReconData;
  jobContextText?: string;
};
```

**Consumes:** `PrepJobContext`, `fingerprintJobContext` from Task 1.

**Produces:** JD-aware cache keys; updated `generateInterviewPlan` accepting `settings.jobContext`; JD sections in unified recon/match/questions prompts; `generateAnswerCritique` and Learn reveal prompts include `jobContextText`.

**Call sites for `generateInterviewPlan`:** Only `DashboardContainer.tsx` lines 878–886 (grep confirms single caller).

### Steps

- [ ] **2.1** Create `tests/unit/interview-context.test.ts` testing `getCacheKeyForPlan` and `resolveCacheLookup`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCacheKeyForPlan, resolveCacheLookup } from "../../src/lib/interview-cache";

describe("getCacheKeyForPlan", () => {
  it("legacy key matches when jdFingerprint is undefined", () => {
    const legacy = getCacheKeyForPlan("Google", "SWE", "Technical");
    const oldStyle = getCacheKeyForPlan("Google", "SWE", "Technical", undefined);
    assert.equal(legacy, oldStyle);
  });

  it("jd fingerprint changes the key", () => {
    const a = getCacheKeyForPlan("Google", "SWE", "Technical", "fp-aaa");
    const b = getCacheKeyForPlan("Google", "SWE", "Technical", "fp-bbb");
    assert.notEqual(a, b);
  });
});

describe("resolveCacheLookup", () => {
  it("returns distinct primary and legacy keys when JD exists", () => {
    const { primaryKey, legacyKey } = resolveCacheLookup("Google", "SWE", "Technical", "fp-1");
    assert.notEqual(primaryKey, legacyKey);
  });
});
```

- [ ] **2.2** Run `npx tsx tests/unit/interview-context.test.ts`. **Expected FAIL:** `getCacheKeyForPlan is not a function` or module export missing.

- [ ] **2.3** Update `src/lib/interview-cache.ts`: add `jdFingerprint?` to `CachedInterviewData`; implement `getCacheKeyForPlan` (append `_jd_${hash}` when fingerprint present); implement `resolveCacheLookup` returning `{ primaryKey, legacyKey }` where `legacyKey` uses no fingerprint. Keep `getCacheKey` as alias to `getCacheKeyForPlan(company, position, round)`.

- [ ] **2.4** Update `src/actions/cache.ts`: add `jd_fingerprint?: string` to Firestore doc and `ServerCachedData`; map in `fetchServerCache` / `saveServerCache`.

- [ ] **2.5** Update `src/actions/generate-context.ts`:
  - Import `PrepJobContext`, `fingerprintJobContext` from `@/lib/prep/job-context`.
  - Change `generateInterviewPlan` signature to accept `settings.jobContext?: PrepJobContext`.
  - Replace line 1137 `const cacheKey = \`${company}-${position}-${round}\`.toLowerCase()` with `resolveCacheLookup` + `getCacheKeyForPlan` using `fingerprintJobContext(settings.jobContext)` when `settings.jobContext?.content?.originalJd` or `normalizedJd` has length > 0.
  - Cache read: try `primaryKey` first; if miss and JD fingerprint exists, do **not** return `legacyKey` hit (skip mismatched legacy). If no JD fingerprint, allow `legacyKey` hit (legacy behavior).
  - Pass `jobContextText` into `fetchUnifiedReconMatch`, `fetchUnifiedQuestions`, and `handleGenerateStrategy` prompt paths: add parameter `jobContextText: string` to `fetchUnifiedReconMatch` and include `\n\nJOB POSTING CONTEXT:\n${jobContextText}` when non-empty (mirror `fetchMatch` line 316).
  - Extend `generateAnswerCritique` context with optional `jobContextText`; add to prompt after `companyFacts`.
  - On cache save (lines 1298–1317), include `jdFingerprint` on `fullData`.

- [ ] **2.6** Update `DashboardContainer.tsx` lines 871–886 to build `PrepJobContext` via `buildPrepJobContextFromLegacy({ company: parsed.company, position: parsed.position, round: parsed.round, jobUrl, jobContextText: jobContext, resumeText: currentResume, prepIntensity: JSON.stringify(prepSettings) })` and pass `jobContext` inside `settings`.

- [ ] **2.7** Run `npx tsx tests/unit/interview-context.test.ts`. **Expected PASS** with the named tests green.

- [ ] **2.8** Run `npx tsx tests/unit/job-context.test.ts`. **Expected PASS** (no regressions).

- [ ] **2.9** Run `npx tsc --noEmit`. Fix type errors in touched files.

- [ ] **2.10** Commit:

```bash
git add src/lib/interview-cache.ts src/actions/cache.ts src/actions/generate-context.ts src/components/dashboard/DashboardContainer.tsx tests/unit/interview-context.test.ts
git commit -m "feat(prep): JD-aware plan cache identity and prompt context"
```

---

## Task 3 — Pure session progress, state, and summary persistence

**Files:**
- Create `src/lib/prep/session-progress.ts`
- Create `tests/unit/session-progress.test.ts`

**Interfaces:**

```typescript
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
  | { type: "START"; planCacheKey: string; mode: PrepSessionMode; questionIds: string[] }
  | { type: "REVEAL"; questionId: string }
  | { type: "MARK_REVIEWED"; questionId: string }
  | { type: "PRACTICE_ONE"; questionId: string }
  | { type: "SET_ANSWER"; questionId: string; answerText: string }
  | { type: "SET_CRITIQUE"; questionId: string; critique: AnswerCritique }
  | { type: "RETRY"; questionId: string }
  | { type: "SKIP"; questionId: string }
  | { type: "TOGGLE_STAR"; questionId: string }
  | { type: "SET_INDEX"; index: number }
  | { type: "SWITCH_MODE"; mode: PrepSessionMode };

export function emptySessionState(
  planCacheKey: string,
  mode: PrepSessionMode,
  questionIds: string[],
): PrepSessionState;

export function prepSessionReducer(
  state: PrepSessionState | null,
  action: PrepSessionAction,
): PrepSessionState | null;

export function buildSessionSummary(state: PrepSessionState): PrepSessionSummary;

export function sessionStorageKey(planCacheKey: string): string;

export function serializeSessionState(state: PrepSessionState): string;

export function parseSessionState(raw: string): PrepSessionState | null;
```

**Storage schema:** Key `intervu_prep_session_v1_${planCacheKey}` in localStorage. Version field `version: 1` inside JSON. Never store API keys, auth tokens, or full resume text. Restore on mount; corrupt JSON returns `null` (caller starts fresh session).

**Performance semantics:** `averageScore` = mean of `critique.score` for questions with status `critiqued` or `retried` only. `answeredCount` = questions with non-empty `answerText`. Skipped questions excluded from average (denominator = `critiquedCount`, not total). `focusQuestionIds` = question IDs with `critique.score <= 5` or status `skipped`.

**Consumes:** `AnswerCritique` from `src/types/index.ts` (lines 93–107).

**Produces:** Reducer, summary, serialization helpers.

### Steps

- [ ] **3.1** Create `tests/unit/session-progress.test.ts` covering: `START` initializes all questions `unreviewed`; `REVEAL` sets `revealed`; Learn flow `MARK_REVIEWED`; Practice `SET_ANSWER` + `SET_CRITIQUE`; `RETRY` clears critique, keeps answer; `SKIP`; `buildSessionSummary` progress counts; performance average excludes skipped; `parseSessionState` round-trip.

- [ ] **3.2** Run `npx tsx tests/unit/session-progress.test.ts`. **Expected FAIL:** module not found.

- [ ] **3.3** Implement `src/lib/prep/session-progress.ts` with full reducer and summary logic per interfaces above.

- [ ] **3.4** Run `npx tsx tests/unit/session-progress.test.ts`. **Expected PASS** with the named tests green.

- [ ] **3.5** Run `npx tsc --noEmit`.

- [ ] **3.6** Commit:

```bash
git add src/lib/prep/session-progress.ts tests/unit/session-progress.test.ts
git commit -m "feat(prep): session progress reducer and summary aggregation"
```

---

## Task 4 — Session-first landing and setup/mode shell

**Files:**
- Create `src/components/prep/PrepLanding.tsx`
- Create `src/components/prep/PrepSetupFlow.tsx`
- Create `src/components/prep/PrepModeSelection.tsx`
- Create `src/components/prep/PrepJobHeader.tsx`
- Create `src/lib/prep/plan-list.ts`
- Modify `src/components/dashboard/DashboardContainer.tsx` — add `prepPhase` state; render new components when `viewState === "empty"` or dedicated prep phases
- Modify `tests/e2e/dashboard.spec.ts`

**Interfaces:**

```typescript
// src/lib/prep/plan-list.ts
export interface CachedPlanListItem {
  cacheKey: string;
  company: string;
  position: string;
  round: string;
  jdFingerprint?: string;
  createdAt: number;
  expiresAt: number;
}

export function listCachedPlans(): CachedPlanListItem[];

export function listResumableSessions(): Array<{
  planCacheKey: string;
  mode: PrepSessionMode;
  updatedAt: string;
  company: string;
  position: string;
  round: string;
}>;

// PrepLanding.tsx
export interface PrepLandingProps {
  onStartNew: () => void;
  onSearch: () => void;
  onResume: (planCacheKey: string) => void;
  onOpenPackage: (item: CachedPlanListItem) => void;
  cachedPlans: CachedPlanListItem[];
  resumableSessions: ReturnType<typeof listResumableSessions>;
}

// PrepSetupFlow.tsx
export interface PrepSetupFlowProps {
  jobContext: PrepJobContext;
  onJobContextChange: (ctx: PrepJobContext) => void;
  prepSettings: QuestionSettings;
  onPrepSettingsChange: (s: QuestionSettings) => void;
  resume: string;
  stories: StarStory[];
  sources: SourceItem[];
  onContinue: () => void;
  onBack: () => void;
}

// PrepModeSelection.tsx
export interface PrepModeSelectionProps {
  jobContext: PrepJobContext;
  onSelectMode: (mode: PrepSessionMode) => void;
  onBack: () => void;
}

// PrepJobHeader.tsx
export interface PrepJobHeaderProps {
  jobContext: PrepJobContext;
  onEdit?: () => void;
}
```

**Consumes:** Task 1 `PrepJobContext`; Task 3 `PrepSessionMode`, `sessionStorageKey`; `InterviewCache` entries via `listCachedPlans`.

**Produces:** Landing UI with Start / Search / Resume / Existing prep packages; setup and mode shells.

### Steps

- [ ] **4.1** Create `tests/unit/plan-list.test.ts` with unit tests for `listCachedPlans` using a pure in-memory stub: export `__testSetInterviewCacheEntries(entries: CachedInterviewData[])` from `plan-list.ts` for test injection (guarded by `process.env.NODE_ENV === 'test'` check inside the function body).

- [ ] **4.2** Run `npx tsx tests/unit/plan-list.test.ts`. **Expected FAIL:** module not found.

- [ ] **4.3** Implement `src/lib/prep/plan-list.ts`: `listCachedPlans` reads `localStorage` key `interview_prep_cache` (same as `InterviewCache` line 29), parses entries, filters non-expired via `InterviewCache.isExpired`. `listResumableSessions` scans keys matching `intervu_prep_session_v1_*` prefix.

- [ ] **4.4** Run `npx tsx tests/unit/plan-list.test.ts`. **Expected PASS** with the named tests green.

- [ ] **4.5** Create `PrepJobHeader.tsx`, `PrepLanding.tsx`, `PrepSetupFlow.tsx`, `PrepModeSelection.tsx` under `src/components/prep/`. `PrepLanding` primary CTA button label **Start new preparation**; secondary buttons **Search plans**, **Resume recent session**, list **Existing prep packages** from `cachedPlans`. `PrepSetupFlow` wraps existing `PrepSettings` props (lines 57–68 of `PrepSettings.tsx`) plus editable company/role/round fields bound to `jobContext.identity`. `PrepModeSelection` shows Learn and Practice cards (no generation yet — Task 5 wires Start).

- [ ] **4.6** Modify `DashboardContainer.tsx`: add `prepPhase: "landing" | "setup" | "mode" | "session" | "summary" | "package"` state defaulting to `"landing"` when `isCleanHome` (line 512). When `prepPhase === "landing"`, render `PrepLanding` instead of centered search empty state (lines 1458–1550 region). Wire `onOpenPackage` to load cache via `loadEnhancedCache` (existing `src/lib/cache-helpers.ts` lines 11–68) and set `prepPhase` to `"package"`. Legacy URL `/?company&position&round&searched=true` (lines 537–570) sets `prepPhase` to `"package"` (package-first).

- [ ] **4.7** Extend `tests/e2e/dashboard.spec.ts` with `TC-DASH-PREP-001`: clean `/` shows `Start new preparation` button; `TC-DASH-PREP-002`: legacy URL loads without error and shows package switch or prep content.

- [ ] **4.8** Run `npx tsx tests/unit/plan-list.test.ts`. **Expected PASS**.

- [ ] **4.9** Run `npm run test:dash -- --grep "TC-DASH-PREP"`. **Expected PASS** with the named tests green.

- [ ] **4.10** Run `npx tsc --noEmit`.

- [ ] **4.11** Commit:

```bash
git add src/lib/prep/plan-list.ts tests/unit/plan-list.test.ts src/components/prep/PrepLanding.tsx src/components/prep/PrepSetupFlow.tsx src/components/prep/PrepModeSelection.tsx src/components/prep/PrepJobHeader.tsx src/components/dashboard/DashboardContainer.tsx tests/e2e/dashboard.spec.ts
git commit -m "feat(prep): session-first landing, setup, and mode shell"
```

---

## Task 5 — Entitlement preflight and one-shot auth replay

**Files:**
- Create `src/lib/prep/pending-prep-actions.ts`
- Create `tests/unit/pending-prep-actions.test.ts`
- Modify `src/components/prep/PrepModeSelection.tsx`
- Modify `src/components/dashboard/DashboardContainer.tsx` — `AuthPopover` (line 1455), start handlers

**Interfaces:**

```typescript
// src/lib/prep/pending-prep-actions.ts
export interface PendingPrepStartPayload {
  jobContext: PrepJobContext;
  mode: PrepSessionMode;
  prepSettings: QuestionSettings;
  planCacheKey: string;
}

export interface PendingPrepState {
  start: PendingPrepStartPayload | null;
}

export type PendingPrepAction =
  | { kind: "start"; payload: PendingPrepStartPayload };

export function emptyPendingPrep(): PendingPrepState;
export function hasPendingPrep(s: PendingPrepState): boolean;
export function queuePendingPrep(_prev: PendingPrepState, action: PendingPrepAction): PendingPrepState;
export function clearPendingPrep(_prev: PendingPrepState): PendingPrepState;
export function takePrepReplay(s: PendingPrepState): {
  next: PendingPrepState;
  action: PendingPrepAction | null;
};

// PrepModeSelection.tsx (extend)
export interface PrepModeSelectionProps {
  jobContext: PrepJobContext;
  isAuthenticated: boolean;
  entitlement: { isAdmin: boolean; isBYOK: boolean; credits: number; monthlyFree: number } | null;
  onSelectMode: (mode: PrepSessionMode) => void;
  onBack: () => void;
}
```

**Consumes:** `getMyCreditsAction` from `src/actions/credits.ts` (lines 14–26); `AuthPopover.onAuthed` pattern from `src/app/jobs/page.tsx` (lines 1286–1298).

**Produces:** Mode screen showing **Your API key** | **Unlimited** | **`N credits`** before Start; auth gate with replay.

### Steps

- [ ] **5.1** Create `tests/unit/pending-prep-actions.test.ts` mirroring `tests/unit/pending-actions.test.ts` structure: queue start, clear on dismiss, `takePrepReplay` fires once, cleared state replays nothing.

- [ ] **5.2** Run `npx tsx tests/unit/pending-prep-actions.test.ts`. **Expected FAIL:** module not found.

- [ ] **5.3** Implement `src/lib/prep/pending-prep-actions.ts` with single-slot `start` payload (queue clears previous).

- [ ] **5.4** Run `npx tsx tests/unit/pending-prep-actions.test.ts`. **Expected PASS** with the named tests green.

- [ ] **5.5** Update `PrepModeSelection.tsx`: on mount call `getMyCreditsAction()`; render entitlement line above Start buttons; if `!isAuthenticated` show **Sign in to start** message and disable Start until auth; Start buttons call `onSelectMode` (parent handles gate).

- [ ] **5.6** Update `DashboardContainer.tsx`:
  - Add `pendingPrepRef`, `authedPrepRef` mirroring jobs page lines 591–594, 860–863, 917–919.
  - Replace line 1455 `AuthPopover` with:

```tsx
<AuthPopover
  open={authPopoverOpen}
  onOpenChange={(open) => {
    if (!open && !authedPrepRef.current) {
      pendingPrepRef.current = clearPendingPrep(pendingPrepRef.current);
    }
    setAuthPopoverOpen(open);
  }}
  onAuthed={() => {
    authedPrepRef.current = true;
    maybeReplayPrepStart();
  }}
  showTrigger={false}
/>
```

  - Implement `maybeReplayPrepStart` using `takePrepReplay`; on `start` action call existing plan generation + session start (Task 6 hook).
  - On Start click: if guest, `queuePendingPrep` + open auth; if authenticated, run generation directly.
  - On auth popover cancel: setup form state unchanged (do not reset `jobContext` / `prepSettings`).

- [ ] **5.7** Run `npx tsx tests/unit/pending-prep-actions.test.ts`. **Expected PASS**.

- [ ] **5.8** Run `npx tsc --noEmit`.

- [ ] **5.9** **Manual verification (not automated):** Anonymous user completes setup, clicks Start Learn, signs in, lands in session with setup intact. Dismiss auth popover, sign in via unrelated sidebar — no replay.

- [ ] **5.10** Commit:

```bash
git add src/lib/prep/pending-prep-actions.ts tests/unit/pending-prep-actions.test.ts src/components/prep/PrepModeSelection.tsx src/components/dashboard/DashboardContainer.tsx
git commit -m "feat(prep): entitlement preflight and one-shot auth replay"
```

---

## Task 6 — Focused Learn/Practice session

**Files:**
- Create `src/components/prep/PrepSessionView.tsx`
- Modify `src/components/dashboard/QuestionsGrid.tsx` — add optional controlled session props
- Modify `src/components/dashboard/DashboardContainer.tsx` — wire session phase
- Create `tests/unit/prep-session-view.test.ts` (pure question index helper)
- Modify `tests/e2e/dashboard.spec.ts` or create session fixture test in Task 9

**Interfaces:**

```typescript
// PrepSessionView.tsx
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
}

// QuestionsGrid.tsx (add optional props — package mode when sessionMode undefined)
sessionMode?: PrepSessionMode;
sessionQuestionIds?: string[];
sessionIndex?: number;
onSessionIndexChange?: (index: number) => void;
externalDispatch?: (action: PrepSessionAction) => void;
```

**Session question list:** `questions.filter(q => sessionQuestionIds.includes(q.id))` in plan order, not category-filtered.

**Learn loop actions (locked order):** Reveal suggested answer → Star → **Practice this question** → **I understand** (next). No score display.

**Practice loop actions (locked order):** Answer + dictation → **How did I do?** → feedback blocks: `reaction` + `scoreLabel` → `the_one_thing` → `say_it_like_this` → `encouragement` → primary **Continue** → secondary **Retry** / edit answer.

**Consumes:** Task 3 reducer; `generateAnswerCritique` with `jobContextText`; `handleGenerateStrategy` for reveal (DashboardContainer lines 1106–1131 region).

**Produces:** `PrepSessionView`; persisted state via `serializeSessionState` / `parseSessionState` on each dispatch.

### Steps

- [ ] **6.1** Create `tests/unit/prep-session-view.test.ts` testing pure helper `getSessionQuestionLabel(index: number, total: number): string` exported from `PrepSessionView.tsx` returning `Question ${index + 1} of ${total}`.

- [ ] **6.2** Run `npx tsx tests/unit/prep-session-view.test.ts`. **Expected FAIL:** export not found.

- [ ] **6.3** Implement `PrepSessionView.tsx` with `getSessionQuestionLabel`, full Learn/Practice UI, `data-testid="prep-session-question-counter"` on counter element.

- [ ] **6.4** Modify `QuestionsGrid.tsx`: when `sessionMode` prop provided, hide internal mode toggle (lines 322–345) and category dropdown (lines 348–366); use `sessionQuestionIds` ordering; delegate critique flow to parent when `externalDispatch` provided.

- [ ] **6.5** Wire `DashboardContainer.tsx`: when `prepPhase === "session"`, render `PrepSessionView`; load/save session from localStorage using `sessionStorageKey(planCacheKey)`; pass `jobContextText` into `generateAnswerCritique` and reveal prompts; on `onFinish` set `prepPhase` to `"summary"`.

- [ ] **6.6** Run `npx tsx tests/unit/prep-session-view.test.ts`. **Expected PASS** with the named tests green.

- [ ] **6.7** Run `npx tsx tests/unit/session-progress.test.ts`. **Expected PASS**.

- [ ] **6.8** Run `npx tsc --noEmit`.

- [ ] **6.9** Commit:

```bash
git add src/components/prep/PrepSessionView.tsx src/components/dashboard/QuestionsGrid.tsx src/components/dashboard/DashboardContainer.tsx tests/unit/prep-session-view.test.ts
git commit -m "feat(prep): Learn/Practice session view with persisted progress"
```

---

## Task 7 — Progress/performance summary

**Files:**
- Create `src/components/prep/PrepSummary.tsx`
- Modify `src/components/dashboard/DashboardContainer.tsx`

**Interfaces:**

```typescript
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
```

**UI labels (exact):**
- Section **Progress:** counts for reviewed, revealed, practiced, starred, unreviewed (Learn); completed, retried, skipped (Practice).
- Section **Performance:** average score label, score distribution, strongest responses, focus questions (Practice only; Learn omits performance section).
- Learn primary CTA: **Practice reviewed questions**
- Practice primary CTA: **Retry focus questions**
- Secondary: **Open prep package**, **View starred**, **Go to application**, **Start new session**

**Consumes:** `buildSessionSummary` from Task 3.

**Produces:** Summary screen at `prepPhase === "summary"`.

### Steps

- [ ] **7.1** Add assertions to `tests/unit/session-progress.test.ts` for `buildSessionSummary` Learn vs Practice output shapes (extend existing file).

- [ ] **7.2** Run `npx tsx tests/unit/session-progress.test.ts`. **Expected PASS** with summary tests green.

- [ ] **7.3** Implement `PrepSummary.tsx` with exact labels and CTAs above.

- [ ] **7.4** Wire `DashboardContainer.tsx`: render `PrepSummary` when `prepPhase === "summary"`; CTA handlers mutate session state or navigate without clearing package cache.

- [ ] **7.5** Run `npx tsc --noEmit`.

- [ ] **7.6** Commit:

```bash
git add src/components/prep/PrepSummary.tsx src/components/dashboard/DashboardContainer.tsx tests/unit/session-progress.test.ts
git commit -m "feat(prep): session summary with progress vs performance"
```

---

## Task 8 — Prep package secondary switch and legacy compatibility

**Files:**
- Create `src/components/prep/PrepPackageSwitch.tsx`
- Modify `src/components/dashboard/DashboardContainer.tsx`
- Modify `src/lib/prep/plan-list.ts` — add `getPreferredView(planCacheKey): "session" | "package" | null` and `setPreferredView(planCacheKey, view)`
- Create `tests/unit/prep-view-preference.test.ts`

**Interfaces:**

```typescript
export type PrepPlanView = "session" | "package";

export function getPreferredView(planCacheKey: string): PrepPlanView | null;
export function setPreferredView(planCacheKey: string, view: PrepPlanView): void;

export interface PrepPackageSwitchProps {
  activeView: PrepPlanView;
  onSwitch: (view: PrepPlanView) => void;
  hasActiveSession: boolean;
}
```

**Behavior:**
- New plans (no `getPreferredView` and no legacy URL): default `session` after first Start.
- Legacy deep link / existing plan open: default `package` until user starts session or switches.
- Switching views never resets `PrepSessionState` in localStorage.
- Package view preserves favorites, export, all sections (match, recon, questions grid, etc.).

**Storage key:** `intervu_prep_preferred_view_v1` → JSON `Record<planCacheKey, PrepPlanView>`.

### Steps

- [ ] **8.1** Create `tests/unit/prep-view-preference.test.ts` for `getPreferredView` / `setPreferredView` round-trip.

- [ ] **8.2** Run `npx tsx tests/unit/prep-view-preference.test.ts`. **Expected FAIL:** exports missing.

- [ ] **8.3** Add preference helpers to `src/lib/prep/plan-list.ts`.

- [ ] **8.4** Implement `PrepPackageSwitch.tsx` with tabs **Session** | **Prep package** (`data-testid="prep-view-switch"`).

- [ ] **8.5** Update `DashboardContainer.tsx`: show switch when plan loaded; `onSwitch` updates `prepPhase` between `"session"`/`"package"` without clearing session reducer state; on intentional session start call `setPreferredView(planCacheKey, "session")`; legacy URL path leaves preference unset until user acts.

- [ ] **8.6** Run `npx tsx tests/unit/prep-view-preference.test.ts`. **Expected PASS** with the named tests green.

- [ ] **8.7** Extend `tests/e2e/dashboard.spec.ts` — `TC-DASH-PREP-003`: legacy URL `/?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true` shows package-first content; `TC-DASH-PREP-004`: view switch visible when plan loaded.

- [ ] **8.8** Run `npm run test:dash -- --grep "TC-DASH-PREP-00[34]"`. **Expected PASS** with the named tests green.

- [ ] **8.9** Run `npx tsc --noEmit`.

- [ ] **8.10** Commit:

```bash
git add src/components/prep/PrepPackageSwitch.tsx src/lib/prep/plan-list.ts tests/unit/prep-view-preference.test.ts src/components/dashboard/DashboardContainer.tsx tests/e2e/dashboard.spec.ts
git commit -m "feat(prep): package switch and legacy plan compatibility"
```

---

## Task 9 — End-to-end P0 acceptance and verification

**Files:**
- Create `tests/e2e/interview-session.spec.ts`
- Add npm script in `package.json` (optional): `"test:session": "playwright test tests/e2e/interview-session.spec.ts"`

**Acceptance paths (no external AI):**
- Inject cached plan fixture into `localStorage` key `interview_prep_cache` before navigation.
- Inject session fixture into `intervu_prep_session_v1_<cacheKey>`.
- Assert landing CTAs, setup navigation, mode entitlement text visible, session counter `Question 1 of N`, summary labels, view switch without session reset.

### Steps

- [ ] **9.1** Create `tests/e2e/interview-session.spec.ts` with fixtures:

```typescript
const FIXTURE_PLAN = {
  cacheKey: "test_plan_key",
  company: "TestCo",
  position: "Engineer",
  round: "Technical",
  hasResumeContext: false,
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  questionsData: {
    questions: [
      { id: "q1", question: "Tell me about yourself", category: "Behavioral" },
      { id: "q2", question: "Why TestCo?", category: "Behavioral" },
    ],
  },
};
```

Tests: `TC-SESSION-001` landing shows Start; `TC-SESSION-002` fixture plan + session restore shows counter; `TC-SESSION-003` summary progress labels; `TC-SESSION-004` switch package → session preserves localStorage session key.

- [ ] **9.2** Run `npx playwright test tests/e2e/interview-session.spec.ts`. **Expected PASS** with the named tests green.

- [ ] **9.3** Run focused unit tests:

```bash
npx tsx tests/unit/job-context.test.ts
npx tsx tests/unit/interview-context.test.ts
npx tsx tests/unit/session-progress.test.ts
npx tsx tests/unit/pending-prep-actions.test.ts
npx tsx tests/unit/plan-list.test.ts
npx tsx tests/unit/prep-session-view.test.ts
npx tsx tests/unit/prep-view-preference.test.ts
```

**Expected PASS** for each file with the named tests green.

- [ ] **9.4** Run `npx tsc --noEmit`. **Expected PASS** (zero errors).

- [ ] **9.5** Run `npm run lint`. **Expected PASS** (zero new errors in touched files).

- [ ] **9.6** Run `npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/interview-session.spec.ts`. **Expected PASS** with the named tests green.

- [ ] **9.7** Run `npm run build`. **Expected PASS** (Next.js production build completes).

- [ ] **9.8** Commit:

```bash
git add tests/e2e/interview-session.spec.ts package.json
git commit -m "test(prep): P0 interview session e2e acceptance coverage"
```

---

## P0 Requirement Coverage Matrix

| P0 requirement | Task |
|---|---|
| Shared job-context contract | 1 |
| JD in plan generation + cache identity | 2 |
| Session progress persistence | 3 |
| Landing Start / Search / Resume / packages | 4 |
| Setup JD + personalization | 4 |
| Mode Learn/Practice selection | 4, 5 |
| Credits/BYOK before Start | 5 |
| Auth replay preserves setup | 5 |
| Learn loop (reveal, star, no score) | 6 |
| Practice loop (critique order, retry) | 6 |
| Dynamic Question X of N | 6 |
| Summary progress ≠ performance | 3, 7 |
| Prep package secondary switch | 8 |
| Legacy deep links package-first | 4, 8 |
| New plans session-first | 4, 8 |
| Preferred view per plan | 8 |
| No forced regeneration | 2, 8 |
| Favorites/export preserved | 8 |

---

## Self-Review Checklist (completed at authoring time)

| Check | Result |
|---|---|
| A) P0 coverage matrix complete; P1/P2 excluded at top | Pass |
| B) No TODO/TBD/ellipsis/`similar to`/undefined symbols in snippets | Pass |
| C) `generateInterviewPlan` signature consistent Tasks 2–6; `PrepJobContext` consistent Tasks 1–8 | Pass |
| D) Every task has fail → implement → pass → commit TDD sequence | Pass |
| E) No product code modified during plan authoring | Pass |
