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

/** Match: the candidate's own role title + seniority. Deterministic, free. */
export function buildMatchQuery(resume: ResumeData): DerivedQuery {
    const q = (resume?.profile?.profession ?? "").trim();
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
 * Explore fallback: skills-only, role/seniority dropped → a wider, related net.
 * Used when the AI adjacency call fails or returns nothing.
 */
export function buildExploreBroadenQuery(resume: ResumeData): DerivedQuery {
    return { q: topSkills(resume, 6).join(" "), facets: {} };
}
