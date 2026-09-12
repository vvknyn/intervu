/**
 * One-shot job-search prefs onboarding on `/jobs` — completion is durable in
 * localStorage; signed-in Skip also persists via `saveAgentPreferencesAction({})`
 * so `agent_preferences.configured` becomes true server-side.
 */
import { readBrowserFlag, setBrowserFlag } from "@/lib/jobs/browser-storage";

export const PREFS_ONBOARDING_COMPLETED_KEY = "intervu.jobs.prefs-onboarding.completed";

export function readPrefsOnboardingCompleted(): boolean {
    return readBrowserFlag(PREFS_ONBOARDING_COMPLETED_KEY);
}

export function writePrefsOnboardingCompleted(): void {
    setBrowserFlag(PREFS_ONBOARDING_COMPLETED_KEY);
}

export interface ShouldShowPrefsOnboardingInput {
    localCompleted: boolean;
    signedIn: boolean;
    agentPrefsReady: boolean;
    configured: boolean;
    localAiEnabled: boolean;
    hasUsableResume: boolean;
}

export function shouldShowPrefsOnboarding(input: ShouldShowPrefsOnboardingInput): boolean {
    if (input.localCompleted) return false;
    if (input.signedIn) {
        return input.agentPrefsReady && !input.configured;
    }
    return input.localAiEnabled && input.hasUsableResume;
}
