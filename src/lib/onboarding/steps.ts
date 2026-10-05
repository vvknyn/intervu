/**
 * The pure halves of setup's three steps (components/onboarding/SetupSteps.tsx):
 * which step comes next, what step 2's place starts from and says it came
 * from, the relocation answers it writes, and the search step 3 offers to
 * email. Kept here so every rule is unit-tested for any role and country.
 */
import { hrefFromJobsUrlState, jobsUrlStateFromSavedHref, suggestSavedSearchName } from "@/lib/jobs/saved-searches";
import { DEFAULT_URL_STATE, type JobsUrlState } from "@/lib/jobs/url-state";
import { SETUP_STEPS, type SetupStep, type StepOutcomes } from "./state";

/** The open step after `from` (wrapping round), or null when every step is answered. */
export function nextOpenStep(outcomes: StepOutcomes, from: SetupStep): SetupStep | null {
    const at = SETUP_STEPS.indexOf(from);
    const order = [...SETUP_STEPS.slice(at + 1), ...SETUP_STEPS.slice(0, at + 1)];
    return order.find((s) => outcomes[s] === null) ?? null;
}

export type PlaceSource = "settings" | "resume" | "connection";

/** Step 2's starting place: what Settings holds, else the résumé's, else the connection's country, with where it came from. */
export function startingPlace(input: {
    settings: string | null;
    resume: string | null;
    connectionCountry: string | null;
}): { value: string; source: PlaceSource | null } {
    if (input.settings?.trim()) return { value: input.settings.trim(), source: "settings" };
    if (input.resume?.trim()) return { value: input.resume.trim(), source: "resume" };
    if (input.connectionCountry?.trim()) return { value: input.connectionCountry.trim(), source: "connection" };
    return { value: "", source: null };
}

export const PLACE_SOURCE_LINE: Record<PlaceSource, string> = {
    settings: "From Settings › Preferences.",
    resume: "From your résumé.",
    connection: "Based on your internet connection today. Change it if you work somewhere else.",
};

export type RelocationChoice = "no" | "anywhere" | "to";

/**
 * The relocation answer written to Settings › Preferences › Relocation, worded
 * so the fit labels' reader (`resolveRelocation`, candidate-signals.ts) reads
 * it the way it was meant: closed, open anywhere, or open to those places.
 */
export function relocationAnswer(choice: RelocationChoice, places: string): string | null {
    if (choice === "no") return "Not open to relocating";
    if (choice === "anywhere") return "Open to relocating anywhere";
    const to = places.trim().replace(/\s+/g, " ");
    return to ? `Open to relocating to ${to}` : null;
}

/** An answer this step wrote, read back into its choice; anything typed elsewhere starts unselected. */
export function relocationChoiceOf(answer: string | null): { choice: RelocationChoice | null; places: string } {
    const text = answer?.trim() ?? "";
    if (text === "Not open to relocating") return { choice: "no", places: "" };
    if (text === "Open to relocating anywhere") return { choice: "anywhere", places: "" };
    const m = text.match(/^Open to relocating to (.+)$/);
    return m ? { choice: "to", places: m[1] } : { choice: null, places: "" };
}

const NAME_MAX = 120;

/**
 * The search step 3 offers to email weekly: the roles (typed, or read from the
 * résumé) where they said they can work, remote only when they said so; else
 * the search they were on. Null when there is nothing to search for yet.
 *
 * The place goes in exactly as the board's location box puts a typed place
 * (`location_country`, resolved by the search's own place reader, any city,
 * region or country), with its commas turned to spaces: the URL splits a
 * place on commas, so "Toronto, ON" would otherwise search Toronto OR all
 * of Ontario.
 */
export function setupSearch(input: {
    roles: string | null;
    place: string | null;
    remoteOnly: boolean;
    currentSearchHref: string | null;
}): { name: string; href: string; state: JobsUrlState } | null {
    const roles = input.roles?.trim().replace(/\s+/g, " ") ?? "";
    if (roles) {
        const place = input.place?.replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim() ?? "";
        const facets: JobsUrlState["facets"] = {};
        if (place) facets.location_country = [place];
        if (input.remoteOnly) facets.work_type = ["remote"];
        const state: JobsUrlState = { ...DEFAULT_URL_STATE, q: roles, facets };
        const name = `${roles}${input.place?.trim() ? ` in ${input.place.trim()}` : ""}${input.remoteOnly ? " (remote only)" : ""}`;
        return { name: name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name, href: hrefFromJobsUrlState(state), state };
    }
    if (input.currentSearchHref) {
        const state = jobsUrlStateFromSavedHref(input.currentSearchHref);
        if (!state.q.trim()) return null;
        return { name: suggestSavedSearchName(state), href: hrefFromJobsUrlState(state), state };
    }
    return null;
}
