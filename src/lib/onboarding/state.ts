/**
 * New-account setup: the three steps a brand-new account is offered after it
 * lands where it signed in (onboarding map, 2026-10-05). Pure: the record
 * lives at `profiles/<uid>.onboarding` (store.ts), the browser keeps a copy
 * (hooks/use-onboarding.ts), and the strip, the sheet, the /jobs panel and
 * the account menu all decide from these functions, so they never disagree.
 *
 * The record is written once, with the sign-up claim (`claimSignupOnProfile`),
 * so whichever door made the account (Create account, a Google sign-in that
 * turned out to be new, password sign-up) it counts, and an account made
 * before this shipped never has one and never sees setup.
 */

export const SETUP_STEPS = ["resume", "place", "email"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepOutcome = "done" | "skipped";

/** The strip shows on the first day plus this many more visit days in all; then only the account menu offers setup. */
export const STRIP_VISIT_DAYS = 3;

export interface OnboardingRecord {
    state: "open" | "finished";
    started_at: string;
    /** What the person chose per step; a step with no entry may still read done from what the account holds (`stepOutcomes`). */
    steps: Partial<Record<SetupStep, StepOutcome>>;
    /** Local days (YYYY-MM-DD) the strip showed on, oldest first, at most `STRIP_VISIT_DAYS`. */
    strip_days: string[];
    /** "Later" on this local day hides the strip until the next one. */
    hidden_day: string | null;
}

/** What the account already holds that answers a step without the person doing it again. */
export interface SetupFacts {
    resumeOnFile: boolean;
    /** Settings › Preferences › Roles. */
    roles: string | null;
    /** Settings › Preferences › Location. */
    location: string | null;
    remoteOnly: boolean;
    savedSearches: number;
}

export type StepOutcomes = Record<SetupStep, StepOutcome | null>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function newOnboardingRecord(nowIso: string): OnboardingRecord {
    return { state: "open", started_at: nowIso, steps: {}, strip_days: [], hidden_day: null };
}

/** The stored field shaped defensively; null for an account without one (made before setup existed). */
export function parseOnboardingRecord(raw: unknown): OnboardingRecord | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (r.state !== "open" && r.state !== "finished") return null;
    const steps: Partial<Record<SetupStep, StepOutcome>> = {};
    const rawSteps = r.steps && typeof r.steps === "object" ? (r.steps as Record<string, unknown>) : {};
    for (const step of SETUP_STEPS) {
        const v = rawSteps[step];
        if (v === "done" || v === "skipped") steps[step] = v;
    }
    const days = Array.isArray(r.strip_days) ? r.strip_days.filter((d): d is string => typeof d === "string" && DAY_RE.test(d)) : [];
    return {
        state: r.state,
        started_at: typeof r.started_at === "string" ? r.started_at : "",
        steps,
        strip_days: [...new Set(days)].sort().slice(0, STRIP_VISIT_DAYS),
        hidden_day: typeof r.hidden_day === "string" && DAY_RE.test(r.hidden_day) ? r.hidden_day : null,
    };
}

/** The person's local calendar day, as the strip counts visit days. */
export function localDay(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isLocalDay(value: unknown): value is string {
    return typeof value === "string" && DAY_RE.test(value);
}

/**
 * Each step's outcome: what the person chose, else "done" when the account
 * already answers it (a résumé or typed roles; a location or remote-only; a
 * saved search), else null (still open).
 */
export function stepOutcomes(record: OnboardingRecord, facts: SetupFacts): StepOutcomes {
    const held: Record<SetupStep, boolean> = {
        resume: facts.resumeOnFile || Boolean(facts.roles?.trim()),
        place: Boolean(facts.location?.trim()) || facts.remoteOnly,
        email: facts.savedSearches > 0,
    };
    return Object.fromEntries(
        SETUP_STEPS.map((step) => [step, record.steps[step] ?? (held[step] ? "done" : null)]),
    ) as StepOutcomes;
}

export function answeredCount(outcomes: StepOutcomes): number {
    return SETUP_STEPS.filter((s) => outcomes[s] !== null).length;
}

export function doneCount(outcomes: StepOutcomes): number {
    return SETUP_STEPS.filter((s) => outcomes[s] === "done").length;
}

/** The first step still open, or null when every step is answered. */
export function firstOpenStep(outcomes: StepOutcomes): SetupStep | null {
    return SETUP_STEPS.find((s) => outcomes[s] === null) ?? null;
}

/** Whether setup is still on offer at all (account menu, sheet). */
export function setupOpen(record: OnboardingRecord | null, outcomes: StepOutcomes | null): boolean {
    return record?.state === "open" && outcomes !== null && firstOpenStep(outcomes) !== null;
}

/** What one write changes; every field optional. */
export interface OnboardingPatch {
    step?: { step: SetupStep; outcome: StepOutcome };
    /** A day the strip showed on. */
    stripDay?: string;
    /** "Later" (or the sheet closed) on this day. */
    laterDay?: string;
    /** Every step answered: setup is over for good. */
    finish?: boolean;
}

/** Applies one write to a record; a day past the cap or a malformed value changes nothing. */
export function applyOnboardingPatch(record: OnboardingRecord, patch: OnboardingPatch): OnboardingRecord {
    const next: OnboardingRecord = { ...record, steps: { ...record.steps }, strip_days: [...record.strip_days] };
    if (patch.step && (SETUP_STEPS as readonly string[]).includes(patch.step.step)) {
        if (patch.step.outcome === "done" || patch.step.outcome === "skipped") next.steps[patch.step.step] = patch.step.outcome;
    }
    if (isLocalDay(patch.stripDay) && !next.strip_days.includes(patch.stripDay) && next.strip_days.length < STRIP_VISIT_DAYS) {
        next.strip_days = [...next.strip_days, patch.stripDay].sort();
    }
    if (isLocalDay(patch.laterDay)) next.hidden_day = patch.laterDay;
    if (patch.finish) next.state = "finished";
    return next;
}
