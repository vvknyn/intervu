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
 * `resolveExploreOutcome` extends this file's scope slightly — it's not a
 * `{q, facets}` derivation, but the pure decision behind Explore's own
 * success/auth/fallback/failure branching, kept here so it stays testable
 * alongside the query builder it calls (`buildExploreBroadenQuery`) without
 * a network/timer mock.
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

/** What `runExplore` (src/app/jobs/page.tsx) should do with a settled Explore attempt. */
export type ExploreOutcome =
    | { kind: "success"; q: string; titles: string[] }
    | { kind: "auth" }
    | { kind: "fallback"; q: string; credits: boolean }
    | { kind: "no-fallback" }
    | { kind: "failed" };

/**
 * Decide the outcome of one Explore attempt from its settled AI-suggest
 * result — pulled out of `runExplore` so the branching (success / auth /
 * credits-or-soft-error fallback / no-fallback-possible / hard failure) is
 * unit-testable without mocking a network call or a timer. This is also
 * where the browser can't verify the failure path (Explore is auth-gated,
 * see the caller's own doc comment) — this function is the substitute.
 *
 * `settled` is `null` for a timeout or thrown rejection (the caller wraps
 * the suggest call in `withSettleGuard`, `EXPLORE_SUGGEST_TIMEOUT_MS`) — a
 * genuinely unexpected failure, mapped to `"failed"` (a visible error band)
 * rather than silently degraded like the action's OWN soft-error sentinels
 * below (no-lying-fallbacks: a hung request isn't a "no suggestions" case).
 *
 * `sentinel` is the caller's own `classifySentinel(settled.error)`
 * (lib/llm/sentinels.ts) result, passed in rather than imported here to keep
 * this module runtime-dependency-free (see header comment).
 */
export function resolveExploreOutcome(
    settled: { titles?: string[]; error?: string } | null,
    resume: ResumeData,
    sentinel: "auth" | "credits" | null,
): ExploreOutcome {
    if (settled === null) return { kind: "failed" };
    if (settled.error) {
        if (sentinel === "auth") return { kind: "auth" };
        const { q } = buildExploreBroadenQuery(resume);
        if (!q) return { kind: "no-fallback" };
        return { kind: "fallback", q, credits: sentinel === "credits" };
    }
    const titles = settled.titles ?? [];
    return { kind: "success", q: titles.join(" "), titles };
}
