/**
 * Resume → search intent.
 *
 * The jobs corpus is searched with Meilisearch (keyword, not semantic — see
 * lib/jobs/meilisearch.ts), so a resume can't be "matched" by similarity. These
 * pure helpers translate a parsed `ResumeData` into the same `{ q, facets }`
 * shape the search action already takes:
 *
 *   - Match   — the candidate's own role + seniority (free, deterministic).
 *   - Explore — adjacent roles, suggested by AI (see suggestAdjacentRolesAction
 *               in actions/jobs.ts); `buildExploreBroadenQuery` is the
 *               deterministic fallback when AI is unavailable.
 *
 * Type-only imports keep this module runtime-dependency-free so it loads under
 * `tsx` for unit tests without `@/` path resolution.
 */
import type { ResumeData } from "@/types/resume";
import type { FacetKey } from "./types";

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

/**
 * Match: the candidate's own role title + seniority. Deterministic, free.
 * Falls back to the résumé's own skills (same terms `buildExploreBroadenQuery`
 * uses) when there's no profession to match on — a résumé with skills but no
 * stated title still deserves a non-empty query, not a silent "newest first"
 * that keeps the "Ranked by your résumé" chip lit over an unranked browse.
 * `resumeIsUsable` is defined in terms of this function's own output (see
 * resume-usable.ts) precisely so the two can't drift apart again.
 */
export function buildMatchQuery(resume: ResumeData): DerivedQuery {
    const profession = (resume?.profile?.profession ?? "").trim();
    const q = profession || capExploreTerms(topSkills(resume, 6)).join(" ");
    const facets: Partial<Record<FacetKey, string[]>> = {};
    const seniority = seniorityFromYears(resume?.profile?.yearsOfExperience ?? 0);
    if (seniority) facets.experience_level = [seniority];
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
