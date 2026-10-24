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
import { statedSearch } from "@/lib/agent/preference-sources";
import { deriveResumeLocationFacets } from "@/lib/jobs/resume-location";
import { resumeHoldsPastSenior } from "@/lib/jobs/role-level";
import { normalizeLanguages, resumeLanguages } from "@/lib/match/posting-language";
import { resumeSeniorityBasis, splitPreferredRoles, topSkills, type Seniority, type SeniorityBasis } from "@/lib/jobs/resume-match";
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
    /** With what the résumé's level was read from (`resumeSeniorityBasis`), when it was. */
    /**
     * `pastSenior`: roles past Senior (Staff, Principal, Director...) are this person's own class: they stated Lead
     * or Executive, or, with no stated level, their résumé holds such a title. `levelStated`: they picked a level in
     * Settings, which bounds their results (`omitsPastSenior`).
     */
    seniority: Signal<Seniority> & { basis?: SeniorityBasis; pastSenior?: true; levelStated?: true };
    roleFamily: Signal<string>;
    skills: Signal<string[]>;
    /** Only ever `explicit`: how recent a role they want to see (Settings › Posted within), in days. */
    postedWithinDays?: Signal<number>;
    /**
     * The languages they read postings in, lowercase names ("english", "french"): what they chose (Settings › Languages, the
     * list's own control, an agent's `set_preferences`) else what their résumé is written in, with English beside a résumé in
     * another language. A posting written in none of them is left out (`MatchScore.language`). `unknown` when the résumé says
     * too little to tell: no posting is judged by it then.
     */
    languages?: Signal<string[]>;
}

const SKILLS_CAP = 12;

/** `EXPERIENCE_LEVELS` (agent/facets.ts) → the three-step scale levels are compared on. */
const SENIORITY_OF_LEVEL: Record<string, Seniority> = {
    intern: "entry",
    entry: "entry",
    mid: "mid",
    senior: "senior",
    lead: "senior",
    executive: "senior",
};

/** An `experience_level` value, from Settings or a listing, on the three-step scale; null when it names none. */
export function seniorityOfLevel(level: string | null | undefined): Seniority | null {
    const key = (level ?? "").trim().toLowerCase();
    return Object.hasOwn(SENIORITY_OF_LEVEL, key) ? SENIORITY_OF_LEVEL[key]! : null;
}

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

/**
 * Settings' place wins when it names a country, by its own words or by the
 * server's gazetteer read of a city (`placeCountries`: "Toronto" → Canada).
 * A place that names none still leaves the résumé's country in charge: a
 * Settings "Toronto" over a Toronto, ON résumé made the person's country
 * unknown, so US-only roles read Good instead of "Outside Canada" (2026-10-05).
 */
function resolveLocation(resume: LocationResume | null, prefs: AgentPreferences | null): Signal<CandidateLocation> {
    const explicit = sanitizeLocation(prefs?.search.location);
    const fromResume = candidateLocationFromResume(resume);
    if (explicit) {
        const own = locationOf(explicit);
        const countries = own.countries.length > 0 ? own.countries : (prefs?.placeCountries ?? []);
        if (countries.length > 0) return signal({ countries, place: explicit }, "explicit");
        const resumePlace = fromResume ? locationOf(fromResume) : null;
        if (resumePlace && resumePlace.countries.length > 0) return signal(resumePlace, "resume");
        return signal(own, "explicit");
    }
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

function resolveSeniority(resume: ResumeData | null, prefs: AgentPreferences | null): CandidateSignals["seniority"] {
    const level = resolveSeniorityLevel(resume, prefs);
    // A stated level wins: Lead or Executive makes roles past Senior their own class, any other level leaves them
    // out whatever the résumé once held (a stated Mid beside a "Head of Growth" résumé, 2026-10-24). With no stated
    // level the résumé decides: a Staff, Principal or Director title on it (`pastSenior`, match/score.ts).
    const statedLevel = (prefs?.search.experienceLevel ?? "").trim().toLowerCase();
    const stated = seniorityOfLevel(statedLevel) != null;
    const holdsPast = stated ? statedLevel === "lead" || statedLevel === "executive" : resumeHoldsPastSenior(resume);
    return { ...level, ...(holdsPast ? { pastSenior: true as const } : {}), ...(stated ? { levelStated: true as const } : {}) };
}

/**
 * Whether roles past Senior are left out for this person: never when they are their own class (`pastSenior`);
 * otherwise on every surface and sort when they picked a level, and with none picked, only in a fit-ranked list
 * (the résumé ranks, it does not filter elsewhere; Vivek, 2026-10-22). The ONE decision every caller reads.
 */
export function omitsPastSenior(seniority: CandidateSignals["seniority"] | null | undefined, fitActive: boolean): boolean {
    return seniority?.pastSenior !== true && (fitActive || seniority?.levelStated === true);
}

function resolveSeniorityLevel(resume: ResumeData | null, prefs: AgentPreferences | null): CandidateSignals["seniority"] {
    const stated = seniorityOfLevel(prefs?.search.experienceLevel);
    const basis = resumeSeniorityBasis(resume);
    // A stated "mid" beside a long career that led people or work reads as the résumé does (senior, which fits
    // mid too): Vivek's Settings said mid beside 13 years with lead roles, and every Senior PM role read Stretch
    // (2026-10-14). Any other stated level stands as said.
    if (stated === "mid" && basis?.led && basis.level === "senior") return { ...signal(basis.level, "resume"), basis };
    if (stated) return signal(stated, "explicit");
    return basis ? { ...signal(basis.level, "resume"), basis } : unknown();
}

/**
 * What they chose, else what their résumé reads in. A résumé written in another language still reads English
 * postings (English is most of what is posted, and an English role is the first thing a bilingual person would
 * miss), so it is added; the person removes it with the same control that adds a language.
 */
function resolveLanguages(resume: ResumeData | null, prefs: AgentPreferences | null): Signal<string[]> {
    const chosen = normalizeLanguages(prefs?.search.languages);
    if (chosen.length > 0) return signal(chosen, "explicit");
    const read = resumeLanguages(resume);
    if (!read) return unknown();
    return signal(read.includes("english") ? read : [...read, "english"], "resume");
}

/** The languages their résumé alone reads in (what `languages` is until they choose), or null when it says too little to tell. */
export function resumeDefaultLanguages(resume: ResumeData | null | undefined): string[] | null {
    return resolveLanguages(resume ?? null, null).value;
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
    // Only what the person stated: a field their résumé filled is read from the résumé itself.
    const prefs = agentPreferences?.configured ? { ...agentPreferences, search: statedSearch(agentPreferences) } : null;
    const r = resume ?? null;
    const skills = r ? topSkills(r, SKILLS_CAP) : [];
    return {
        location: resolveLocation(r, prefs),
        remotePreference: prefs?.search.remoteOnly ? signal("remote_only", "explicit") : unknown(),
        relocation: resolveRelocation(prefs),
        seniority: resolveSeniority(r, prefs),
        roleFamily: resolveRoleFamily(r, prefs),
        ...(typeof prefs?.search.postedWithinDays === "number" && prefs.search.postedWithinDays > 0
            ? { postedWithinDays: signal(prefs.search.postedWithinDays, "explicit") }
            : {}),
        languages: resolveLanguages(r, prefs),
        skills: skills.length > 0 ? signal(skills, "resume") : unknown(),
    };
}

/**
 * The roles the candidate said they want (Settings › Roles, setup's roles
 * step, an agent's `set_preferences`), as titles; `[]` when they said none.
 * A role read off the résumé is not a statement of intent and is not listed.
 */
export function preferredRoles(signals: Pick<CandidateSignals, "roleFamily"> | null | undefined): string[] {
    return signals?.roleFamily.source === "explicit" ? splitPreferredRoles(signals.roleFamily.value) : [];
}

/** The candidate's countries, or `[]` when the location is unknown or names no country. */
export function candidateCountries(signals: CandidateSignals): string[] {
    return signals.location.value?.countries ?? [];
}
