/**
 * The ONE place a candidate's search-relevant facts are resolved.
 *
 * Inputs are the parsed résumé and the candidate's saved agent preferences
 * (`profiles.agent_preferences`). Every signal carries where it came from:
 * `explicit` (the candidate said so in preferences — always wins),
 * `resume` (read off the résumé), or `unknown` (neither has it). Nothing is
 * inferred: an unknown signal stays unknown so callers can score it neutral
 * and say so, instead of dropping it from an average.
 *
 * Pure and isomorphic — the preferences import is type-only, so this never
 * pulls the Firebase Admin SDK into a client bundle. Consumers: the pack
 * filters (for-you/pack-filters.ts), `rankForYou` and `scoreJobAgainstResume`.
 */
import type { AgentPreferences } from "@/lib/agent/preferences";
import { deriveResumeLocationFacets } from "@/lib/jobs/resume-location";
import { seniorityFromYears, topSkills, type Seniority } from "@/lib/jobs/resume-match";
import { sanitizeLocation } from "@/lib/resume/contact-line";
import { locationFromResumePlainText } from "@/lib/resume/structure-resume-text";
import type { ResumeData } from "@/types/resume";

export type SignalSource = "explicit" | "resume" | "unknown";

export interface Signal<T> {
    value: T | null;
    source: SignalSource;
}

export interface CandidateLocation {
    /** Canonical country names the place resolves to. Empty when the text names no country. */
    countries: string[];
    /** Sanitized place text as written (city / region / country). */
    place: string;
}

export interface CandidateRelocation {
    open: boolean;
    /** Countries the candidate named. Empty with `open` means no destination was named. */
    countries: string[];
}

export interface CandidateSignals {
    location: Signal<CandidateLocation>;
    /** Only ever `explicit`: a résumé does not state a remote preference. */
    remotePreference: Signal<"remote_only">;
    /** Only ever `explicit`: a résumé does not state willingness to relocate. */
    relocation: Signal<CandidateRelocation>;
    seniority: Signal<Seniority>;
    roleFamily: Signal<string>;
    skills: Signal<string[]>;
}

const SKILLS_CAP = 12;

/** `EXPERIENCE_LEVELS` (agent/facets.ts) → the `experience_level` facet vocabulary. */
const SENIORITY_FROM_PREFERENCE: Record<string, Seniority> = {
    intern: "entry",
    entry: "entry",
    mid: "mid",
    senior: "senior",
    lead: "senior",
    executive: "senior",
};

const NOT_RELOCATING = /\b(no|not|never|won'?t|can'?t|cannot|unwilling|none|n\/a)\b/i;
const RELOCATING = /\b(yes|anywhere|open|willing|happy|keen|able|can|relocat\w*|move)\b/i;
/** Words around a destination in a free-text answer. Removed before place lookup so that
 *  "or" / "can" / "on" never read as the Oregon / Canada / Ontario codes. */
const RELOCATION_FILLER =
    /\b(yes|open|willing|happy|keen|able|can|relocat\w*|mov\w*|to|in|the|a|i|am|would|be|or|and|for|anywhere|please)\b/gi;

const unknown = <T>(): Signal<T> => ({ value: null, source: "unknown" });
const signal = <T>(value: T, source: Exclude<SignalSource, "unknown">): Signal<T> => ({ value, source });

export type LocationResume = {
    profile?: { location?: string | null } | null;
    generatedSummary?: string | null;
    experience?: { description?: string | null }[] | null;
    projects?: { description?: string | null }[] | null;
};

function bodyText(resume: LocationResume): string {
    return [
        resume.generatedSummary ?? "",
        ...(resume.experience ?? []).map((entry) => entry.description ?? ""),
        ...(resume.projects ?? []).map((entry) => entry.description ?? ""),
    ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n");
}

/**
 * City/region the résumé actually contains.
 * `profile.location` wins. If that field is empty, a place line later in
 * the stored text is used. No match → "".
 */
export function candidateLocationFromResume(resume: LocationResume | null | undefined): string {
    if (!resume) return "";
    const direct = sanitizeLocation(resume.profile?.location);
    if (direct) return direct;
    return locationFromResumePlainText(bodyText(resume)) || "";
}

/** Canonical countries a place text names; `[]` when it names none we can match. */
export function countriesOfPlace(place: string): string[] {
    return deriveResumeLocationFacets(place).location_country ?? [];
}

function locationOf(place: string): CandidateLocation {
    return { countries: countriesOfPlace(place), place };
}

function resolveLocation(resume: LocationResume | null, prefs: AgentPreferences | null): Signal<CandidateLocation> {
    const explicit = sanitizeLocation(prefs?.search.location);
    if (explicit) return signal(locationOf(explicit), "explicit");
    const fromResume = candidateLocationFromResume(resume);
    return fromResume ? signal(locationOf(fromResume), "resume") : unknown();
}

function resolveRelocation(prefs: AgentPreferences | null): Signal<CandidateRelocation> {
    const text = prefs?.answers.relocation?.trim();
    if (!text) return unknown();
    if (NOT_RELOCATING.test(text)) return signal({ open: false, countries: [] }, "explicit");
    if (!RELOCATING.test(text) && countriesOfPlace(text).length === 0) return unknown();
    const destination = text
        .replace(RELOCATION_FILLER, ",")
        .split(/[,;/]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ");
    if (!destination) return signal({ open: true, countries: [] }, "explicit");
    const countries = countriesOfPlace(destination);
    // A destination we cannot resolve is unknown — never widened to "anywhere".
    return countries.length > 0 ? signal({ open: true, countries }, "explicit") : unknown();
}

function resolveSeniority(resume: ResumeData | null, prefs: AgentPreferences | null): Signal<Seniority> {
    const stated = SENIORITY_FROM_PREFERENCE[(prefs?.search.experienceLevel ?? "").trim().toLowerCase()];
    if (stated) return signal(stated, "explicit");
    const fromYears = seniorityFromYears(resume?.profile?.yearsOfExperience ?? 0);
    return fromYears ? signal(fromYears, "resume") : unknown();
}

function resolveRoleFamily(resume: ResumeData | null, prefs: AgentPreferences | null): Signal<string> {
    const stated = prefs?.search.query?.trim();
    if (stated) return signal(stated, "explicit");
    const fromResume = resume?.profile?.profession?.trim() || resume?.experience?.[0]?.role?.trim();
    return fromResume ? signal(fromResume, "resume") : unknown();
}

/**
 * `resume` and `agentPreferences` may each be absent. Explicit preferences
 * override the résumé; a field neither has resolves to `unknown`.
 * `remoteOnly: false` is not treated as a statement: the settings form saves
 * `false` for a toggle the candidate never touched.
 */
export function resolveCandidateSignals(
    resume: ResumeData | null | undefined,
    agentPreferences?: AgentPreferences | null,
): CandidateSignals {
    const prefs = agentPreferences?.configured ? agentPreferences : null;
    const r = resume ?? null;
    const skills = r ? topSkills(r, SKILLS_CAP) : [];
    return {
        location: resolveLocation(r, prefs),
        remotePreference: prefs?.search.remoteOnly ? signal("remote_only", "explicit") : unknown(),
        relocation: resolveRelocation(prefs),
        seniority: resolveSeniority(r, prefs),
        roleFamily: resolveRoleFamily(r, prefs),
        skills: skills.length > 0 ? signal(skills, "resume") : unknown(),
    };
}

/** The candidate's countries, or `[]` when the location is unknown or names no country. */
export function candidateCountries(signals: CandidateSignals): string[] {
    return signals.location.value?.countries ?? [];
}
