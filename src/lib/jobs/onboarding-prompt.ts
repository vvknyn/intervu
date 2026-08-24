/**
 * When to offer the job-search setup wizard, and what to do with what it
 * collects before there is an account to put it in.
 *
 * Owner's call (Vivek, 2026-08-23): prompt a SIGNED-OUT visitor after a few
 * interactions — not on arrival. Someone who has run a couple of searches has
 * already shown the intent the wizard asks about, so the offer reads as help
 * rather than a toll gate, and it lands at the moment signing in is finally
 * worth something to them.
 *
 * Pure, so the policy is testable without a browser, a session or Firestore:
 * the page owns counting and storage, this owns the decisions.
 */
import { browserStorage as storage, readBrowserFlag, setBrowserFlag } from "./browser-storage";

/**
 * What the wizard collects. Defined here rather than in the component because
 * the stash, the flush and the search all handle this shape without rendering
 * anything — a lib module reaching back into `components/` for its own core
 * type is the import pointing the wrong way.
 */
export interface SearchPrefsValues {
    query: string;
    location: string;
    remoteOnly: boolean;
    salaryMin: number;
}

/** Interactions before the offer. High enough that a glance at the page never
 *  triggers it, low enough to still catch someone inside one session. */
export const PROMPT_AFTER_INTERACTIONS = 3;

export const INTERACTIONS_KEY = "intervu.jobs.onboarding.interactions";
export const DISMISSED_KEY = "intervu.jobs.onboarding.dismissed";
export const STASH_KEY = "intervu.jobs.onboarding.prefs";

export interface OnboardingPromptInput {
    /** Searches this visitor has run in this browser. */
    interactions: number;
    /** Whether Firebase has resolved someone. */
    signedIn: boolean;
    /** They closed the wizard once — asking again is nagging, not onboarding. */
    dismissed: boolean;
    /** Preferences already exist (a returning account, or a local stash). */
    configured: boolean;
}

/**
 * The offer is deliberately scoped to signed-out visitors, per the owner's
 * call. A signed-in account that never configured preferences is a DIFFERENT
 * case with a different right answer (it has somewhere to save, and a Settings
 * surface that already edits the same store), so it is not folded in here on
 * a guess — `signedIn` short-circuits rather than falling through.
 */
export function shouldPromptOnboarding(input: OnboardingPromptInput): boolean {
    if (input.signedIn) return false;
    if (input.dismissed || input.configured) return false;
    return input.interactions >= PROMPT_AFTER_INTERACTIONS;
}

/**
 * Where the wizard's answers belong once it closes.
 *
 * `saveAgentPreferencesAction` writes to `profiles/<uid>`, so a signed-out
 * visitor has nowhere to persist to — and the action returns
 * `{ error: "Unauthorized" }` rather than throwing, which is exactly how the
 * wizard used to promise "we'll save it to your account" and then quietly not.
 * Naming the two destinations makes the caller handle both.
 */
export type PrefsDestination = "account" | "browser";

export function prefsDestination(signedIn: boolean): PrefsDestination {
    return signedIn ? "account" : "browser";
}

/**
 * The locally-stashed preferences to push up now that someone has signed in,
 * or null to leave the account alone.
 *
 * Returns the VALUE rather than a yes/no on purpose: a boolean would leave the
 * caller holding a `SearchPrefsValues | null` it still had to re-check before
 * using, and a second check is a second place for the rule to drift.
 *
 * The stash only wins when the account has nothing yet. A returning user who
 * already configured preferences on another device must not have them
 * overwritten by whatever a logged-out session typed into this browser — that
 * would turn signing in into data loss.
 */
export function prefsToFlush(input: {
    signedIn: boolean;
    stash: SearchPrefsValues | null;
    accountConfigured: boolean;
}): SearchPrefsValues | null {
    if (!input.signedIn || input.accountConfigured) return null;
    return input.stash;
}

/**
 * Parse a stashed value back into preferences, defensively — it is raw
 * localStorage written by an older build, hand-edited, or truncated. A stash
 * without a usable query is worth nothing to the search, so it reads as absent
 * rather than as an empty-query "preference".
 */
export function readStash(raw: string | null): SearchPrefsValues | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const v = parsed as Partial<SearchPrefsValues>;
    const query = typeof v.query === "string" ? v.query.trim() : "";
    if (!query) return null;
    return {
        query,
        location: typeof v.location === "string" ? v.location.trim() : "",
        remoteOnly: v.remoteOnly === true,
        salaryMin: typeof v.salaryMin === "number" && v.salaryMin > 0 ? v.salaryMin : 0,
    };
}

/* ------------------------------------------------------------------ *
 * Browser storage. Same defensive idiom as `auth/guest-save-gate.ts`:
 * every access is null-guarded and try/caught, because localStorage is
 * absent during SSR and THROWS (not returns null) in some private modes.
 * ------------------------------------------------------------------ */

// Deliberately not exported: nothing renders the count, so the only honest
// way to read it is as the return of the increment that produced it. An
// exported getter would invite a component to hold a copy that goes stale.
function readInteractions(): number {
    const n = parseInt(storage()?.getItem(INTERACTIONS_KEY) ?? "0", 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
}

/** Increment the interaction counter and return the new count. */
export function recordOnboardingInteraction(): number {
    const next = readInteractions() + 1;
    try {
        storage()?.setItem(INTERACTIONS_KEY, String(next));
    } catch {
        /* quota exceeded / private mode */
    }
    return next;
}

export function isOnboardingDismissed(): boolean {
    return readBrowserFlag(DISMISSED_KEY);
}

export function dismissOnboarding(): void {
    setBrowserFlag(DISMISSED_KEY);
}

export function getStashedPrefs(): SearchPrefsValues | null {
    return readStash(storage()?.getItem(STASH_KEY) ?? null);
}

export function stashPrefs(values: SearchPrefsValues): void {
    try {
        storage()?.setItem(STASH_KEY, JSON.stringify(values));
    } catch {
        /* quota exceeded / private mode */
    }
}

export function clearStashedPrefs(): void {
    try {
        storage()?.removeItem(STASH_KEY);
    } catch {
        /* private mode */
    }
}
