/**
 * Resume → search intent.
 *
 * The jobs corpus is searched with Meilisearch (keyword, not semantic — see
 * lib/jobs/meilisearch.ts), so a resume can't be "matched" by similarity. These
 * pure helpers translate a parsed `ResumeData` into the same `{ q, facets }`
 * shape the search action already takes:
 *
 *   - Rank / `sort=fit` — generalized role-title retrieval via `buildMatchQuery`
 *     (experience titles + duty-inferred families + headline splits, capped);
 *     scoring on returned hits remains `scoreJobAgainstResume` in lib/match/score.ts.
 *   - Explore — adjacent roles; `suggestAdjacentRolesLocal` (adjacent-roles.ts)
 *               is the deterministic no-LLM helper; `buildExploreBroadenQuery`
 *               is the skills-only fallback used on /jobs today.
 *
 * Type-only imports keep this module runtime-dependency-free so it loads under
 * `tsx` for unit tests without `@/` path resolution.
 */
import {
    dutyDerivedRoleTitles,
    familiesNamedBy,
    familyRetrievalTitles,
    type RoleFamilyId,
} from "@/lib/match/duty-signals";
import type { ResumeData } from "@/types/resume";
import type { FacetKey } from "./types";
import { splitRoleTitles, suggestAdjacentRolesLocal } from "./adjacent-roles";
import { isRoleTitlePhrase } from "@/lib/resume/title-text";
import { formatQuotedOrQuery } from "./fit-phrases";
import { resumeIndustry, type IndustryId } from "./resume-industry";

export interface DerivedQuery {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    /** Capped role/skill phrases before quoted-OR serialization into `q`. */
    phrases: string[];
}

/** `experience_level` facet values are exactly entry | mid | senior | unknown. */
export type Seniority = "entry" | "mid" | "senior";

/** Map years of experience to a seniority facet value. 0 / unknown → null (no facet). */
export function seniorityFromYears(years: number): Seniority | null {
    if (!Number.isFinite(years) || years <= 0) return null;
    if (years <= 2) return "entry";
    if (years <= 6) return "mid";
    return "senior";
}

/**
 * The `experience_level` facet values a candidate at `seniority` retrieves.
 * Senior candidates often fit adjacent mid-level PM/TAM/CSM postings; senior-only
 * would hide most of those titles from Rank retrieval.
 */
export function experienceLevelFacet(seniority: Seniority | null): string[] | null {
    if (seniority === "senior") return ["mid", "senior"];
    return seniority ? [seniority] : null;
}

/** A past role that ended this many years ago no longer says what the candidate does now. */
export const STALE_ROLE_YEARS = 5;

/** The last year a role's dates name ("Present"/"Current" is `nowYear`); null when they name none. */
export function roleEndYear(dates: string, nowYear: number): number | null {
    if (/\b(present|current|now)\b/i.test(dates)) return nowYear;
    const full = [...dates.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    const short = [...dates.matchAll(/['‘’](\d{2})\b/g)].map((m) => 2000 + Number(m[1]));
    const years = [...full, ...short];
    return years.length > 0 ? Math.max(...years) : null;
}

/**
 * Distinct experience role titles in résumé order (most recent first). The
 * most recent role always counts; an earlier one only while it is recent
 * (`STALE_ROLE_YEARS`) — or when its dates name no year, since an unknown
 * end is not evidence of an old role.
 */
function experienceRoleTitles(resume: ResumeData, nowYear?: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const [index, entry] of (resume?.experience ?? []).entries()) {
        const role = (entry?.role ?? "").trim();
        if (!role) continue;
        if (nowYear !== undefined && index > 0) {
            const ended = roleEndYear(entry?.dates ?? "", nowYear);
            if (ended !== null && nowYear - ended >= STALE_ROLE_YEARS) continue;
        }
        const key = role.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(role);
    }
    return out;
}

/** Drop common prefixes when the remainder is still a meaningful role phrase. */
function cleanRoleTitle(title: string): string {
    const trimmed = title.trim();
    const shortened = trimmed.replace(/^(client-facing|senior)\s+/i, "").trim();
    return shortened || trimmed;
}

/** A headline names a practice ("Technical Account Management"); a posting names the job ("Technical Account Manager"). */
function headlineRoleTitle(title: string): string {
    return cleanRoleTitle(title).replace(/\bManagement$/, "Manager");
}

/** The title a summary opens with: "Senior Customer Success and Technical Account Manager with 12 years…". */
function summaryLeadTitle(summary: string): string {
    const first = (summary ?? "").trim().split(/[.;:\n]/)[0] ?? "";
    return first.split(/\s+(?:with|who|having|driving|focused)\b|,/i)[0]?.trim() ?? "";
}

/** Self-description a summary's first title can open with ("Experienced software engineer"). */
const LEAD_ADJECTIVES = /^(?:(?:highly|seasoned|experienced|accomplished|results-driven|dedicated|passionate|skilled|certified|versatile|strategic|motivated)\s+)+/i;

/** "Technical Account Manager and client-facing product owner" → the two titles it joins. */
function joinedTitles(phrase: string): string[] {
    return phrase
        .split(/\s+(?:and|&)\s+/i)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * The families `phrases` name, in the order the phrases name them. A summary
 * that opens "Technical Account Manager and client-facing product owner" is
 * customer success first, product second; `familiesNamedBy` alone returns its
 * own fixed family order, which put product first and filled a TAM's pack with
 * Product Manager roles.
 */
function familiesInOrder(phrases: string[]): RoleFamilyId[] {
    return [...new Set([...phrases.flatMap(joinedTitles).flatMap((part) => familiesNamedBy([part])), ...familiesNamedBy(phrases)])];
}

export interface TargetRoles {
    /** Role titles in the candidate's own words: the headline they wrote, then their current role. */
    phrases: string[];
    /** Role families the headline, summary, skill groups and current role name, strongest first. */
    families: RoleFamilyId[];
    /**
     * The roles the candidate calls themselves: `phrases` plus the title their
     * summary opens with ("Senior Customer Success and Technical Account
     * Manager…" → Customer Success). A posting with one of these titles is their
     * own role; one that only shares a family with them is a neighbour.
     */
    own: string[];
    /** The families `own` names, strongest first. */
    ownFamilies: RoleFamilyId[];
}

/**
 * What the candidate is looking for, from the résumé's own words, strongest
 * first: the headline they wrote (unless it only repeats their current job
 * title), their current role, and the role families their summary and skill
 * groups name. An old role, or a duty that sounds like another job ("API",
 * "incident" in a product manager's bullets), is not a target.
 */
export function targetRoles(resume: ResumeData): TargetRoles {
    const current = (resume?.experience ?? []).map((e) => (e?.role ?? "").trim()).find(Boolean) ?? "";
    const profession = (resume?.profile?.profession ?? "").trim();
    const headlineIsJobTitle = Boolean(current) && profession.toLowerCase() === current.toLowerCase();
    const headline = profession && !headlineIsJobTitle ? splitRoleTitles(profession).map(headlineRoleTitle) : [];
    const currentTitle = current ? cleanRoleTitle(current) : "";

    const phrases: string[] = [];
    for (const phrase of [...headline, currentTitle]) {
        if (phrase && !phrases.some((p) => p.toLowerCase() === phrase.toLowerCase())) phrases.push(phrase);
    }
    const lead = summaryLeadTitle(resume?.generatedSummary ?? "");
    const categories = (resume?.competencies ?? []).map((group) => (group?.category ?? "").trim()).filter(Boolean);
    const families = [
        ...new Set([
            ...familiesInOrder(headline),
            ...familiesInOrder(lead ? [lead] : []),
            ...familiesInOrder(categories),
            ...familiesInOrder(currentTitle ? [currentTitle] : []),
        ]),
    ];

    // Only the title the summary OPENS with is the candidate's own: in "Technical
    // Account Manager and client-facing product owner" the second half describes
    // the job, it is not a second job they are after.
    const leadTitle = cleanRoleTitle((joinedTitles(lead)[0] ?? "").replace(LEAD_ADJECTIVES, ""));
    const leadIsTitle = Boolean(leadTitle) && isRoleTitlePhrase(leadTitle) && familiesNamedBy([leadTitle]).length > 0;
    const own = [...phrases];
    if (leadIsTitle && !own.some((p) => p.toLowerCase() === leadTitle.toLowerCase())) own.push(leadTitle);
    return { phrases, families, own, ownFamilies: familiesInOrder(own) };
}

/**
 * A headline or role that names no job a posting carries: "Health Science
 * Graduate", "Clinic Volunteer". Searched as a phrase it finds nothing and
 * spends one of the pack's four slots.
 */
const NOT_A_JOB_TITLE = /\b(graduate|student|volunteer|candidate)\s*$/i;

const isJobTitle = (phrase: string) => !NOT_A_JOB_TITLE.test(phrase.trim());

/**
 * `suggestAdjacentRolesLocal` is a table of software and go-to-market jumps
 * (any "manager" → Engineering Manager, any "analyst" → Business Analyst), so
 * it only speaks for résumés in those industries. A Nurse Manager's pack must
 * not search Engineering Manager.
 */
const ADJACENCY_INDUSTRIES: ReadonlySet<IndustryId> = new Set(["tech", "business"]);

/**
 * Match / Rank (`sort=fit`): the role titles a pack searches for, strongest
 * first, capped at 4 (see `capExploreTerms`):
 *
 *   1. the candidate's own words — their headline, then their current role;
 *   2. the standard titles of the role families the résumé names
 *      ("Customer Success Manager", "Technical Account Manager");
 *   3. earlier roles that are still recent (`STALE_ROLE_YEARS`);
 *   4. roles adjacent to the targets (`suggestAdjacentRolesLocal`), for tech
 *      and go-to-market résumés only (`ADJACENCY_INDUSTRIES`);
 *   5. families inferred from duties alone (`dutyDerivedRoleTitles`);
 *   6. top skills, only when nothing else produced a query.
 *
 * Headlines and roles that aren't job titles (`NOT_A_JOB_TITLE`) are skipped.
 * Seniority widens to mid+senior so adjacent mid-level roles stay visible.
 * `resumeIsUsable` is defined in terms of this function's output (see
 * resume-usable.ts) precisely so the two can't drift apart again.
 */
export function buildMatchQuery(resume: ResumeData, nowYear: number = new Date().getFullYear()): DerivedQuery {
    const skills = topSkills(resume, 6);
    const target = targetRoles(resume);
    const ownTitles = target.phrases.filter(isJobTitle);
    const recentTitles = experienceRoleTitles(resume, nowYear).map(cleanRoleTitle).filter(isJobTitle);

    let terms = capExploreTerms(
        [...ownTitles, ...familyRetrievalTitles(target.families), ...recentTitles],
        4,
    );
    if (terms.length < 4 && ownTitles.length > 0 && ADJACENCY_INDUSTRIES.has(resumeIndustry(resume))) {
        terms = capExploreTerms([...terms, ...suggestAdjacentRolesLocal(ownTitles, skills, 8)], 4);
    }
    if (terms.length < 4) {
        terms = capExploreTerms([...terms, ...dutyDerivedRoleTitles(resume)], 4);
    }
    if (terms.length === 0) {
        terms = capExploreTerms(skills, 4);
    }

    const q = formatQuotedOrQuery(terms);
    const facets: Partial<Record<FacetKey, string[]>> = {};
    const levels = experienceLevelFacet(seniorityFromYears(resume?.profile?.yearsOfExperience ?? 0));
    if (levels) facets.experience_level = levels;
    return { q, facets, phrases: terms };
}

/** Flatten competencies into a de-duped (case-insensitive), trimmed skill list, capped at `n`. */
export function topSkills(resume: ResumeData, n = 8): string[] {
    const out: string[] = [];
    for (const group of resume?.competencies ?? []) {
        for (const raw of group?.skills ?? []) {
            const skill = (raw ?? "").trim();
            if (!skill) continue;
            if (out.some((s) => s.toLowerCase() === skill.toLowerCase())) continue;
            out.push(skill);
            if (out.length >= n) return out;
        }
    }
    return out;
}

/**
 * Cap an ORDERED list of explore-query candidates — AI-suggested adjacent
 * titles, or the skills-only fallback below — to the `max` most significant
 * (earliest-ranked) entries. Both callers already hand this a
 * significance-ordered list (the LLM ranks titles by relevance; `topSkills`
 * walks the résumé's own competency order), so keeping a short prefix keeps
 * the query's most meaningful terms.
 *
 * Cap exists so Rank emits a short phrase list; retrieval ORs those phrases
 * via the fit-phrase multi-search lane (`fit-phrases.ts` / `searchMeili`),
 * never by space-joining into one AND query. Space-joining 6–8 titles
 * previously produced AND-of-all-tokens mush under `matchingStrategy: "all"`.
 * Deduping case-insensitively here also stops a repeated term from silently
 * eating one of the 4 slots.
 */
export function capExploreTerms(terms: string[], max = 4): string[] {
    const out: string[] = [];
    for (const raw of terms) {
        const term = (raw ?? "").trim();
        if (!isRoleTitlePhrase(term)) continue;
        if (out.some((t) => t.toLowerCase() === term.toLowerCase())) continue;
        out.push(term);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * Explore fallback: skills-only, role/seniority dropped → a wider, related net.
 * Used when the AI adjacency call fails or returns nothing.
 */
export function buildExploreBroadenQuery(resume: ResumeData): DerivedQuery {
    const terms = capExploreTerms(topSkills(resume, 6));
    return { q: terms.join(" "), facets: {}, phrases: terms };
}

/** Union résumé-derived facets with already-applied ones — commutative, non-mutating. */
export function mergeFacets(
    current: Partial<Record<FacetKey, string[]>>,
    derived: Partial<Record<FacetKey, string[]>>,
): Partial<Record<FacetKey, string[]>> {
    const merged: Partial<Record<FacetKey, string[]>> = { ...current };
    for (const key of Object.keys(derived) as FacetKey[]) {
        const fromDerived = derived[key];
        if (!fromDerived?.length) continue;
        const existing = merged[key] ?? [];
        const seen = new Set(existing);
        const union = [...existing];
        for (const v of fromDerived) {
            if (!seen.has(v)) {
                seen.add(v);
                union.push(v);
            }
        }
        merged[key] = union.sort();
    }
    return merged;
}
