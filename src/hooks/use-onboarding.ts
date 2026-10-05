"use client";

/**
 * A new account's setup as one shared store, so the welcome strip, the setup
 * sheet, the /jobs panel, the account menu and Today all read the same
 * answer (rules: lib/onboarding/state.ts).
 *
 * Read once per account per page load (`getOnboardingAction`) and kept in
 * this browser per account, so the strip paints with the page on the next
 * load instead of popping in after a round trip. An account with no setup
 * (made before it existed) or a finished one is remembered as such and never
 * read again on this device.
 */
import { useSyncExternalStore } from "react";
import { getOnboardingAction, updateOnboardingAction, type OnboardingView } from "@/actions/onboarding";
import { captureEvent } from "@/lib/analytics/events";
import { readLocalAiResume } from "@/lib/local-ai/resume-storage";
import {
    answeredCount,
    applyOnboardingPatch,
    doneCount,
    firstOpenStep,
    localDay,
    parseOnboardingRecord,
    setupOpen,
    stepOutcomes,
    stripDecision,
    SETUP_STEPS,
    type OnboardingPatch,
    type SetupFacts,
    type SetupStep,
    type StepOutcome,
    type StepOutcomes,
} from "@/lib/onboarding/state";

export type SetupSurface = "strip" | "menu" | "jobs_page" | "email";

interface Snapshot {
    uid: string | null;
    /** Null: nothing to offer this account. Undefined: not known yet. */
    view: OnboardingView | null | undefined;
    /** A résumé kept in this browser (a guest's, carried into the account). */
    localResume: boolean;
    sheet: SetupSurface | null;
    /** /jobs shows setup as the page itself, so the strip steps aside. */
    inlinePanels: number;
}

const CACHE_PREFIX = "velai.onboarding.";
const NONE = "none";
/** Right after sign-in the server cookie can trail the client by a beat, as in use-agent-preferences.ts. */
const ATTEMPTS = 4;
const RETRY_MS = 400;
/** A tab coming back after this long re-reads, so a search saved in another tab ticks its step off. */
const STALE_MS = 60_000;

let snapshot: Snapshot = { uid: null, view: undefined, localResume: false, sheet: null, inlinePanels: 0 };
let loadingUid: string | null = null;
let lastReadAt = 0;
let finishSent = false;
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** A view as the server sends it; undefined when the value isn't one (an old cache, a garbled reply). */
function parseView(raw: unknown): OnboardingView | null | undefined {
    if (raw === null) return null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const view = raw as Partial<OnboardingView>;
    const record = parseOnboardingRecord(view.record);
    if (!record || !view.facts || typeof view.facts !== "object") return undefined;
    return { ...(view as OnboardingView), record };
}

function readCache(uid: string): OnboardingView | null | undefined {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + uid);
        if (raw === null) return undefined;
        if (raw === NONE) return null;
        return parseView(JSON.parse(raw));
    } catch {
        return undefined;
    }
}

function writeCache(uid: string, view: OnboardingView | null) {
    try {
        localStorage.setItem(CACHE_PREFIX + uid, view ? JSON.stringify(view) : NONE);
    } catch {
        // Private mode or full storage: the next load reads the account again.
    }
}

/** Any résumé parsed into this browser counts; the shell skips the match-query check to stay light. */
function hasLocalResume(): boolean {
    return readLocalAiResume() !== null;
}

async function read(uid: string) {
    if (loadingUid === uid) return;
    loadingUid = uid;
    lastReadAt = Date.now();
    try {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const res = await getOnboardingAction(uid).catch(() => null);
            if (snapshot.uid !== uid) return;
            const view = parseView(res?.data);
            if (view !== undefined) {
                writeCache(uid, view);
                set({ view });
                return;
            }
            if (attempt < ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
    } finally {
        if (loadingUid === uid) loadingUid = null;
    }
}

/** Points the store at the signed-in account (or none); the strip's root calls this on every auth change. */
export function loadOnboarding(uid: string | null) {
    if (snapshot.uid === uid) return;
    finishSent = false;
    if (!uid) {
        set({ uid: null, view: undefined, sheet: null, localResume: false });
        return;
    }
    const cached = readCache(uid);
    set({ uid, view: cached, localResume: hasLocalResume() });
    // No setup, or setup finished, is final for an account: it is only ever written at sign-up.
    if (cached !== null && cached?.record.state !== "finished") void read(uid);
}

/** Sign-out: forget the account's setup in this browser (lib/auth/session-client-stores.ts). */
export function forgetOnboarding() {
    const { uid } = snapshot;
    if (uid) {
        try {
            localStorage.removeItem(CACHE_PREFIX + uid);
        } catch {
            // Private mode: nothing was kept.
        }
    }
    set({ uid: null, view: undefined, sheet: null, localResume: false });
}

/** Re-read when a tab comes back to the page after a while. */
export function refreshOnboardingIfStale() {
    const { uid, view } = snapshot;
    if (!uid || view === null || view?.record.state === "finished" || Date.now() - lastReadAt < STALE_MS) return;
    void read(uid);
}

function setView(view: OnboardingView) {
    if (snapshot.uid) writeCache(snapshot.uid, view);
    set({ view });
}

/** What another part of the page just changed (a résumé imported, roles or a place saved, a search saved). */
export function noteSetupFacts(facts: Partial<SetupFacts>) {
    const view = snapshot.view;
    if (facts.resumeOnFile) set({ localResume: snapshot.localResume || hasLocalResume() });
    if (!view) return;
    setView({ ...view, facts: { ...view.facts, ...facts, savedSearches: Math.max(view.facts.savedSearches, facts.savedSearches ?? 0) } });
}

/** Also what `resumeOnFile` reads from this browser. */
export function noteResumeOnFile() {
    noteSetupFacts({ resumeOnFile: true });
}

function outcomesOf(s: Snapshot): StepOutcomes | null {
    if (!s.view) return null;
    return stepOutcomes(s.view.record, { ...s.view.facts, resumeOnFile: s.view.facts.resumeOnFile || s.localResume });
}

function write(patch: OnboardingPatch) {
    const view = snapshot.view;
    if (view) setView({ ...view, record: applyOnboardingPatch(view.record, patch) });
    if (snapshot.uid) void updateOnboardingAction(snapshot.uid, patch).catch(() => undefined);
}

/** The person answered (or skipped) a step; the last one finishes setup. */
export function answerStep(step: SetupStep, outcome: StepOutcome, via?: StepVia) {
    const before = outcomesOf(snapshot);
    if (!before) return;
    const after: StepOutcomes = { ...before, [step]: outcome };
    const finish = firstOpenStep(after) === null;
    captureEvent("onboarding_step_answered", { step, outcome, ...(via ? { via } : {}) });
    if (finish) {
        finishSent = true;
        captureEvent("onboarding_finished", { done: doneCount(after), skipped: answeredCount(after) - doneCount(after) });
    }
    write({ step: { step, outcome }, ...(finish ? { finish: true } : {}) });
}

export type StepVia = "resume" | "roles" | "place" | "remote" | "saved_search";

/** Every step reads answered from what the account holds, with no tap on the last one: close setup for good. */
export function finishIfAllHeld() {
    const view = snapshot.view;
    const outcomes = outcomesOf(snapshot);
    if (finishSent || !view || view.record.state !== "open" || !outcomes || firstOpenStep(outcomes) !== null) return;
    finishSent = true;
    captureEvent("onboarding_finished", { done: doneCount(outcomes), skipped: answeredCount(outcomes) - doneCount(outcomes) });
    write({ finish: true });
}

export function markStripDay(day: string, visitDay: number) {
    captureEvent("onboarding_strip_shown", { day: visitDay });
    write({ stripDay: day });
}

/** "Later", or the sheet closed before the last step: the strip waits for the next visit day. */
export function putSetupOff() {
    const outcomes = outcomesOf(snapshot);
    captureEvent("onboarding_later", { answered: outcomes ? answeredCount(outcomes) : 0 });
    write({ laterDay: localDay() });
}

export function openSetupSheet(surface: SetupSurface) {
    captureEvent("onboarding_setup_opened", { surface });
    set({ sheet: surface });
}

export function closeSetupSheet() {
    set({ sheet: null });
}

export function registerInlineSetup(): () => void {
    set({ inlinePanels: snapshot.inlinePanels + 1 });
    return () => set({ inlinePanels: Math.max(0, snapshot.inlinePanels - 1) });
}

export interface OnboardingState {
    uid: string | null;
    view: OnboardingView | null | undefined;
    outcomes: StepOutcomes | null;
    /** Setup still has a step to offer (account menu, sheet). */
    open: boolean;
    strip: ReturnType<typeof stripDecision>;
    answered: number;
    sheet: SetupSurface | null;
    inlinePanelShown: boolean;
    today: string;
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => snapshot;

export function useOnboarding(): OnboardingState {
    const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const outcomes = outcomesOf(s);
    const record = s.view ? s.view.record : null;
    const today = localDay();
    return {
        uid: s.uid,
        view: s.view,
        outcomes,
        open: setupOpen(record, outcomes),
        strip: stripDecision(record, outcomes, today),
        answered: outcomes ? answeredCount(outcomes) : 0,
        sheet: s.sheet,
        inlinePanelShown: s.inlinePanels > 0,
        today,
    };
}

export { SETUP_STEPS };
