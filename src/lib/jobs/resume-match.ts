/**
 * Resume → search intent.
 *
 * The jobs corpus is searched with Meilisearch (keyword, not semantic — see
 * lib/jobs/meilisearch.ts), so a resume can't be "matched" by similarity. These
 * pure helpers translate a parsed `ResumeData` into the same `{ q, facets }`
 * shape the search action already takes:
 *
 *   - Rank / `sort=fit` — generalized role-title retrieval via `buildMatchQuery`
 *     (experience titles + adjacent roles + headline splits, capped); scoring on
 *     returned hits remains `scoreJobAgainstResume` in lib/match/score.ts.
 *   - Explore — adjacent roles; `suggestAdjacentRolesLocal` (adjacent-roles.ts)
 *               is the deterministic no-LLM helper; `buildExploreBroadenQuery`
 *               is the skills-only fallback used on /jobs today.
 *
 * Type-only imports keep this module runtime-dependency-free so it loads under
 * `tsx` for unit tests without `@/` path resolution.
 */
import type { ResumeData } from "@/types/resume";
import type { FacetKey } from "./types";
import { splitRoleTitles, suggestAdjacentRolesLocal } from "./adjacent-roles";

export interface DerivedQuery {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
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

/** Distinct experience role titles in résumé order (most recent first). */
function experienceRoleTitles(resume: ResumeData): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of resume?.experience ?? []) {
        const role = (entry?.role ?? "").trim();
        if (!role) continue;
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

/**
 * Match / Rank (`sort=fit`): role-title retrieval beyond the headline profession.
 * Builds an ordered candidate list (experience → adjacent → headline splits →
 * skills), caps to 4 title phrases, and widens seniority so adjacent mid-level
 * PM/TAM/CSM roles stay visible.
 *
 * Falls back to top skills when there is no profession, no experience titles,
 * and adjacency yields nothing — skills-only résumés still get a non-empty q.
 * `resumeIsUsable` is defined in terms of this function's output (see
 * resume-usable.ts) precisely so the two can't drift apart again.
 */
export function buildMatchQuery(resume: ResumeData): DerivedQuery {
    const profession = (resume?.profile?.profession ?? "").trim();
    const professionParts = profession ? splitRoleTitles(profession) : [];
    const expTitles = experienceRoleTitles(resume);
    const skills = topSkills(resume, 6);

    const candidates: string[] = [];

    // 1. Most recent experience title, then adjacent roles (high-signal for fit).
    if (expTitles.length > 0) {
        candidates.push(cleanRoleTitle(expTitles[0]));
    }

    const allTitlesForAdjacent = [...professionParts, ...expTitles];
    if (allTitlesForAdjacent.length > 0) {
        candidates.push(...suggestAdjacentRolesLocal(allTitlesForAdjacent, skills, 8));
    }

    // Remaining experience titles (recent-first, after adjacency so PM/TAM/CSM fit).
    for (let i = 1; i < expTitles.length; i++) {
        candidates.push(cleanRoleTitle(expTitles[i]));
    }

    // 3. Headline profession parts — never the raw pipe-joined blob when splits exist.
    if (professionParts.length > 0) {
        candidates.push(...professionParts);
    } else if (profession) {
        candidates.push(profession);
    }

    let terms = capExploreTerms(candidates, 4);
    if (terms.length === 0) {
        terms = capExploreTerms(skills, 4);
    }

    const q = terms.join(" ");
    const facets: Partial<Record<FacetKey, string[]>> = {};
    const seniority = seniorityFromYears(resume?.profile?.yearsOfExperience ?? 0);
    if (seniority === "senior") {
        // Senior candidates often fit adjacent mid-level PM/TAM/CSM postings; senior-only
        // would hide most of those titles from Rank retrieval.
        facets.experience_level = ["mid", "senior"];
    } else if (seniority === "mid") {
        facets.experience_level = ["mid"];
    } else if (seniority === "entry") {
        facets.experience_level = ["entry"];
    }
    return { q, facets };
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
 * Meilisearch treats a space-joined query as an OR across every term, so
 * joining all 6-8 suggested titles (or a longer skills list) widens the
 * match instead of narrowing it — measured failure: 15 joined terms surfaced
 * a 100k-hit relevance mush instead of a tight adjacency signal. Deduping
 * case-insensitively here also stops a repeated term from silently eating
 * one of the 4 slots.
 */
export function capExploreTerms(terms: string[], max = 4): string[] {
    const out: string[] = [];
    for (const raw of terms) {
        const term = (raw ?? "").trim();
        if (!term) continue;
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
    return { q: capExploreTerms(topSkills(resume, 6)).join(" "), facets: {} };
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
