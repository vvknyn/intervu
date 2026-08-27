/**
 * Résumé ↔ job match score — "The Match Receipt".
 *
 * Arithmetic, not oracle: every number here comes from comparing the ONE
 * upload parse (already produced once, at upload, by `parseResumeWithAI` —
 * see actions/resume.ts) against a job's own fields. No LLM call lives in
 * this module or is reachable from it. This is also the single scoring
 * function — the SERP card chip, the job-detail header chip, and `sort=fit`'s
 * client-side reorder all call `scoreJobAgainstResume` directly, so they can
 * never disagree about a score.
 *
 * Pure TS, no server/client imports (mirrors resume-match.ts's isomorphic
 * convention) — this runs client-side on `/jobs` and can run server-side on
 * `/co` without change.
 *
 * Honest gaps: a component only appears when both sides actually have the
 * field to compare. A job/résumé pair with NO comparable field returns
 * `null` (no chip), never a fabricated 0.
 */
import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { topSkills } from "@/lib/jobs/resume-match";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type MatchComponentKey = "skills" | "occupation" | "seniority";

export interface MatchComponent {
    key: MatchComponentKey;
    label: string;
    /** Honest, computed verdict text — e.g. "7 of your 9", "same occupation", "senior — fits". */
    detail: string;
    /** This component's own match quality, 0..1. */
    score: number;
}

export interface MatchScore {
    /** 0-100 integer. */
    total: number;
    components: MatchComponent[];
}

/**
 * Component weights — skills overlap dominant, occupation + seniority
 * secondary. The ONLY place these live; the total is a weighted average
 * renormalized over whichever components actually scored (see
 * `scoreJobAgainstResume`), so a job missing one comparable field doesn't
 * silently drag the score toward zero.
 */
export const MATCH_WEIGHTS: Readonly<Record<MatchComponentKey, number>> = {
    skills: 0.6,
    occupation: 0.25,
    seniority: 0.15,
};

/** Chip renders with a brand-color outline at/above this total; below it, the default muted border. */
export const MATCH_CHIP_BRAND_THRESHOLD = 75;

/**
 * Years-of-experience → seniority label, upper-bound-inclusive per tier
 * (same convention as `seniorityFromYears` in resume-match.ts: exactly 2y
 * lands in the LOWER tier, not the next one up). The one place this ladder
 * is defined — both the receipt's "senior — fits" text and the tier used to
 * compare against a job's `experience_level` read this array, not a copy.
 */
export const SENIORITY_LADDER: ReadonlyArray<{ maxYears: number; label: string }> = [
    { maxYears: 2, label: "junior" },
    { maxYears: 5, label: "mid" },
    { maxYears: 9, label: "senior" },
    { maxYears: Infinity, label: "lead/principal" },
];

/**
 * `PublicJob.experience_level`'s real vocabulary, in ladder order (see
 * `Seniority` in resume-match.ts: "entry | mid | senior | unknown"). A job
 * whose value isn't in this list — including "unknown" — has no index, so
 * the seniority component is absent rather than guessed. Matched on the
 * VALUE itself (indexOf), not by enumerating "unknown" as a special case.
 */
const JOB_EXPERIENCE_LEVEL_ORDER = ["entry", "mid", "senior"] as const;

function normalize(s: string): string {
    return s.trim().toLowerCase();
}

/** Simple singular/plural tolerance — no fuzzy/embedding matching. */
function looseEquals(a: string, b: string): boolean {
    return a === b || a === `${b}s` || b === `${a}s`;
}

/**
 * Skills ∩ job tags. `topSkills(resume, Infinity)` is used (not the default
 * cap of 8) — the receipt's "N of your M" must report the real total, and
 * truncating the résumé's own skill list would misreport M.
 */
function scoreSkills(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const skills = topSkills(resume, Number.POSITIVE_INFINITY).map(normalize).filter(Boolean);
    const tags = (job.tags ?? []).map(normalize).filter(Boolean);
    if (skills.length === 0 || tags.length === 0) return null;

    const matched = skills.filter((skill) => tags.some((tag) => looseEquals(skill, tag)));
    const score = matched.length / skills.length;
    return {
        key: "skills",
        label: "Skills in common",
        detail: `${matched.length} of your ${skills.length}`,
        score,
    };
}

/** Parsed profession vs job occupation — deterministic token overlap, no fuzzy matching. */
function scoreOccupation(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const profession = (resume.profile?.profession ?? "").trim();
    const occupation = (job.occupation ?? "").trim();
    if (!profession || !occupation) return null;

    const professionTokens = meaningfulTitleTokens(profession);
    const occupationTokens = meaningfulTitleTokens(occupation);
    if (professionTokens.length === 0 || occupationTokens.length === 0) return null;

    const matched = professionTokens.filter((pt) =>
        occupationTokens.some((ot) => looseEquals(pt, ot)),
    );
    const score = matched.length / professionTokens.length;
    const detail =
        score === 1 ? "same occupation" : score > 0 ? "related occupation" : "different occupation";
    return { key: "occupation", label: "Role vs your title", detail, score };
}

/** Years-derived seniority vs a job's `experience_level`. */
function scoreSeniority(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const years = resume.profile?.yearsOfExperience;
    if (!Number.isFinite(years) || (years as number) < 0) return null;

    const jobIndex = JOB_EXPERIENCE_LEVEL_ORDER.indexOf(
        normalize(job.experience_level ?? "") as (typeof JOB_EXPERIENCE_LEVEL_ORDER)[number],
    );
    if (jobIndex === -1) return null;

    const ladderIndex = SENIORITY_LADDER.findIndex((tier) => (years as number) <= tier.maxYears);
    const tier = SENIORITY_LADDER[ladderIndex === -1 ? SENIORITY_LADDER.length - 1 : ladderIndex];
    // Job vocabulary tops out at "senior" — a lead/principal candidate still
    // compares against that top rung rather than falling off the ladder.
    const candidateIndex = Math.min(ladderIndex, JOB_EXPERIENCE_LEVEL_ORDER.length - 1);

    const diff = candidateIndex - jobIndex;
    const score = diff === 0 ? 1 : diff > 0 ? 0.65 : 0.25;
    const verdict = diff === 0 ? "fits" : diff > 0 ? "exceeds ask" : "below ask";
    return { key: "seniority", label: "Seniority", detail: `${tier.label} — ${verdict}`, score };
}

/**
 * The one scoring function. Returns `null` when no component had comparable
 * data on both sides (honest gap — never a fabricated 0). Otherwise returns
 * the weighted-average total (renormalized over whichever components scored)
 * plus each component's own honest detail, in weight order.
 */
export function scoreJobAgainstResume(resume: ResumeData, job: PublicJob): MatchScore | null {
    const components = [scoreSkills(resume, job), scoreOccupation(resume, job), scoreSeniority(resume, job)].filter(
        (c): c is MatchComponent => c !== null,
    );
    if (components.length === 0) return null;

    const weightSum = components.reduce((sum, c) => sum + MATCH_WEIGHTS[c.key], 0);
    const weighted = components.reduce((sum, c) => sum + MATCH_WEIGHTS[c.key] * c.score, 0);
    const total = Math.round((weighted / weightSum) * 100);

    return { total, components };
}
