/**
 * A saved résumé fills the person's search preferences where they never set
 * them themselves — the roles it names, where it says they are, the level it
 * reads — so Settings, the setup checklist and their connected agent show
 * what the résumé says instead of blanks, and a NEW résumé updates what the
 * old one filled ("the résumé I upload does not update my search
 * preferences", review 2026-10-13).
 *
 * It never overwrites a value the person set (Settings, setup's steps, their
 * agent's `set_preferences`): only an empty field, or one an earlier résumé
 * filled (`sources`, preference-sources.ts), is written. A value the résumé
 * filled stays a mirror: fit reads the résumé for it (`statedSearch`), so the
 * sync can never make an old résumé outrank a new one.
 *
 * Server only (writes through preferences.ts, which holds the Admin SDK).
 */
import { candidateLocationFromResume } from "@/lib/jobs/candidate-signals";
import { resumeSeniority, targetRoles } from "@/lib/jobs/resume-match";
import { isRoleTitlePhrase } from "@/lib/resume/title-text";
import type { ResumeData } from "@/types/resume";
import { getAgentPreferences, setAgentPreferences, type AgentPreferences, type SearchPreferences } from "./preferences";
import { RESUME_SYNCED_FIELDS } from "./preference-sources";

/** How many of the résumé's own titles fill the Roles field. */
const RESUME_ROLES_MAX = 3;

/** What the résumé says for each synced field; a field it says nothing about is absent. */
export function resumePreferenceValues(resume: ResumeData): Partial<Pick<SearchPreferences, "query" | "location" | "experienceLevel">> {
    const roles = targetRoles(resume)
        .own.filter((title) => isRoleTitlePhrase(title))
        .slice(0, RESUME_ROLES_MAX);
    const location = candidateLocationFromResume(resume);
    const level = resumeSeniority(resume);
    return {
        ...(roles.length > 0 ? { query: roles.join(", ") } : {}),
        ...(location ? { location } : {}),
        ...(level ? { experienceLevel: level } : {}),
    };
}

/**
 * Pure: the search patch a résumé makes to `existing`, or `null` for none.
 * A field is written only when it is empty or an earlier résumé filled it,
 * and only when the value changes.
 */
export function resumePreferencePatch(
    existing: Pick<AgentPreferences, "search" | "sources">,
    resume: ResumeData,
    previous?: ResumeData | null,
): Partial<SearchPreferences> | null {
    const values = resumePreferenceValues(resume);
    // A value equal to what the OLD résumé says was filled from it, even when it was saved before
    // sources were tracked or through setup's prefilled roles step: a new upload replaces it
    // (Vivek, 2026-10-13: "every time I upload a new resume the recommendations do not refresh").
    const old = previous ? resumePreferenceValues(previous) : {};
    const patch: Partial<SearchPreferences> = {};
    for (const field of RESUME_SYNCED_FIELDS) {
        const next = values[field];
        if (next == null) continue;
        const current = existing.search[field];
        const empty = current == null || (typeof current === "string" && current.trim() === "");
        const filledByResume =
            existing.sources?.[field] === "resume" ||
            (old[field] != null && String(old[field]).trim().toLowerCase() === String(current ?? "").trim().toLowerCase());
        if (!empty && !filledByResume) continue; // the person set it
        if (current === next) continue;
        (patch as Record<string, unknown>)[field] = next;
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

/** Write `resumePreferencePatch` for this account. Returns the patch written, or `null`. */
export async function syncPreferencesFromResume(
    uid: string,
    resume: ResumeData,
    previous?: ResumeData | null,
): Promise<Partial<SearchPreferences> | null> {
    const existing = await getAgentPreferences(uid);
    const patch = resumePreferencePatch(existing, resume, previous);
    if (!patch) return null;
    await setAgentPreferences(uid, { search: patch }, "resume");
    return patch;
}
