/**
 * Résumé ↔ job match score — "The Match Receipt".
 *
 * Arithmetic, not oracle: every number here comes from comparing the ONE
 * upload parse (already produced once, at upload, entirely on-device by
 * `parseResumeLocally` — see lib/local-ai/parse-resume.ts) against a job's
 * own fields. No LLM call lives in this module or is reachable from it.
 * This is also the single scoring
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
 *
 * Redesign (2026-08): the previous version scored `skills` and `occupation`
 * as two independent, individually-optional components, then renormalized
 * the weighted total over whichever components actually had data. That let
 * a job/résumé pair with NO topical overlap at all — skills didn't share a
 * tag, no occupation on either side — still land at 100 purely because
 * `seniority` happened to match; renormalizing "found nothing on the
 * subject, but the level matches" up to a full score is not an honest
 * receipt. `scoreSkills` had a second, independent bug: it divided by the
 * RÉSUMÉ's own full skill count, so a candidate with a long, real skill list
 * that only PARTIALLY overlaps a job's own (short) ask got crushed toward
 * zero by their own thoroughness — the fraction shrinks as the résumé lists
 * more skills, regardless of how well those skills cover what the job
 * actually wants.
 *
 * `relevance` replaces both `skills` and `occupation` with one token-overlap
 * component whose denominator is the JOB's own vocabulary (title + tags +
 * occupation + hydrated description when present, rank words stripped), not
 * the résumé's. The résumé side compares skills, profession, role titles, and
 * responsibility text (experience/project bullets + summary + skills, via
 * resumeDutyTokens). That fixes both bugs
 * at once: coverage is always "how much of what this role asks for is in
 * your résumé" — a longer résumé can only help (more terms to match against
 * the same fixed job vocabulary) — and it's now REQUIRED, so a pair with no
 * topical overlap returns `null` (no chip) rather than falling back to a
 * seniority-only 100. `seniority` stays as an optional modifier on top.
 */
import { classifyCountryValue } from "@/lib/jobs/country-classification";
import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { resumeCountriesFromLocation } from "@/lib/jobs/resume-location";
import { topSkills } from "@/lib/jobs/resume-match";
import { RANK_WORDS, resumeDutyTokens } from "@/lib/match/duty-signals";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type MatchComponentKey = "relevance" | "seniority" | "location";

export interface MatchComponent {
    key: MatchComponentKey;
    label: string;
    /** Honest, computed verdict text — e.g. "7 of 12 terms this role names", "senior — fits". */
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
 * Component weights. The ONLY place these live; the total is a weighted
 * average renormalized over whichever components actually scored (see
 * `scoreJobAgainstResume`) — but `relevance` is REQUIRED (the whole match is
 * `null` without it), so that renormalization only ever adjusts for
 * `seniority` being present or absent, never leaves `relevance` out.
 */
export const MATCH_WEIGHTS: Readonly<Record<MatchComponentKey, number>> = {
    relevance: 0.75,
    seniority: 0.25,
    location: 0.10,
};

/** Qualitative fit bands on the 0–100 integer `MatchScore.total` scale. */
export type MatchBand = "stretch" | "good" | "strong";

/** Lower bound (inclusive) for Good — Stretch is strictly below this. */
export const MATCH_BAND_GOOD_MIN = 60;
/** Lower bound (inclusive) for Strong — Good is 60–79 inclusive. */
export const MATCH_BAND_STRONG_MIN = 80;

/** Chip renders with a brand-color outline for Strong (≥80); below it, the default muted border. */
export const MATCH_CHIP_BRAND_THRESHOLD = MATCH_BAND_STRONG_MIN;

/** Maps a 0–100 match total to Stretch / Good / Strong. */
export function matchBand(score: number): MatchBand {
    if (!Number.isFinite(score)) return "stretch";
    if (score >= MATCH_BAND_STRONG_MIN) return "strong";
    if (score >= MATCH_BAND_GOOD_MIN) return "good";
    return "stretch";
}

export function matchBandLabel(band: MatchBand): "Stretch" | "Good" | "Strong" {
    if (band === "strong") return "Strong";
    if (band === "good") return "Good";
    return "Stretch";
}

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

/** SERP hits usually omit description; cap keeps detail/hydrated jobs cheap. */
const JOB_DESCRIPTION_SLICE_CHARS = 1500;
const JOB_DESCRIPTION_MAX_TOKENS = 32;

function normalize(s: string): string {
    return s.trim().toLowerCase();
}

/** `meaningfulTitleTokens` (stop-words stripped) with rank words ALSO stripped — the shared step both vocabularies below run through. */
function relevanceTokens(s: string): string[] {
    return meaningfulTitleTokens(s).filter((t) => !RANK_WORDS.has(t));
}

/** Simple singular/plural tolerance carried over from the pre-redesign skills
 *  comparison (no fuzzy/embedding matching) — a job token matches a résumé
 *  vocabulary that has it verbatim OR off by exactly one trailing "s". */
function vocabHasToken(vocab: ReadonlySet<string>, token: string): boolean {
    return vocab.has(token) || vocab.has(`${token}s`) || (token.endsWith("s") && vocab.has(token.slice(0, -1)));
}

/**
 * A job's own topical vocabulary: title + tags + occupation, plus a bounded
 * slice of `description` when it is already present (detail / hydrated hit).
 * SERP Meili hits typically omit description — this path is a no-op for them.
 */
function jobVocabulary(job: PublicJob): Set<string> {
    const tokens = [
        ...relevanceTokens(job.title ?? ""),
        ...(job.tags ?? []).flatMap((tag) => relevanceTokens(tag)),
        ...relevanceTokens(job.occupation ?? ""),
    ];
    const description = job.description?.trim();
    if (description) {
        const slice = description.slice(0, JOB_DESCRIPTION_SLICE_CHARS);
        tokens.push(...relevanceTokens(slice).slice(0, JOB_DESCRIPTION_MAX_TOKENS));
    }
    return new Set(tokens);
}

/**
 * A résumé's topical vocabulary: skills, profession, role titles, and
 * responsibility tokens from resumeDutyTokens (summary + experience/project
 * bullets + skills — see resumeMatchText). `topSkills(resume, Infinity)`
 * (not the default cap of 8) so a long, real skill list is never truncated
 * out of contention.
 */
function resumeVocabulary(resume: ResumeData): Set<string> {
    const tokens = [
        ...topSkills(resume, Number.POSITIVE_INFINITY).flatMap((skill) => relevanceTokens(skill)),
        ...relevanceTokens(resume.profile?.profession ?? ""),
        ...(resume.experience ?? []).flatMap((exp) => relevanceTokens(exp.role ?? "")),
        ...resumeDutyTokens(resume),
    ];
    return new Set(tokens);
}

/**
 * REQUIRED component (see module doc for why): how much of the job's own
 * vocabulary shows up in the résumé's. `score = min(1, coverage / 0.6)` — a
 * candidate covering 60%+ of a role's own terms already reads as a strong
 * match; the curve doesn't demand near-total overlap (job vocabulary
 * includes incidental terms — a stray tag, a boilerplate word in the title —
 * that no real candidate's résumé would ever fully enumerate).
 */
const RELEVANCE_COVERAGE_FLOOR = 0.6;

function scoreRelevance(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const jobVocab = jobVocabulary(job);
    const resumeVocab = resumeVocabulary(resume);
    if (jobVocab.size === 0 || resumeVocab.size === 0) return null;

    const matched = [...jobVocab].filter((token) => vocabHasToken(resumeVocab, token));
    const coverage = matched.length / jobVocab.size;
    const score = Math.min(1, coverage / RELEVANCE_COVERAGE_FLOOR);
    return {
        key: "relevance",
        label: "Relevance to this role",
        detail: `${matched.length} of ${jobVocab.size} terms this role names`,
        score,
    };
}

function isRemoteWorkType(workType: string | null | undefined): boolean {
    return /remote/i.test(workType ?? "");
}

function jobHasKnownLocation(job: PublicJob): boolean {
    if (job.location?.trim()) return true;
    if (job.location_city?.trim()) return true;
    if (job.location_state?.trim()) return true;
    if (job.location_country) {
        const raw = Array.isArray(job.location_country) ? job.location_country : [job.location_country];
        if (raw.some((c) => (c ?? "").trim())) return true;
    }
    return false;
}

function jobCountries(job: PublicJob): string[] {
    const raw = job.location_country;
    if (!raw) return [];
    const values = Array.isArray(raw) ? raw : [raw];
    const out = new Set<string>();
    for (const value of values) {
        const classified = classifyCountryValue((value ?? "").trim());
        if (classified.kind === "country") out.add(classified.canonical);
    }
    return [...out];
}

/** Résumé place vs job location — optional; absent when either side lacks data. */
function scoreLocation(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const resumeLoc = (resume.profile?.location ?? "").trim();
    if (!resumeLoc) return null;

    const remote = isRemoteWorkType(job.work_type);
    if (!remote && !jobHasKnownLocation(job)) return null;

    const resumeCountries = resumeCountriesFromLocation(resumeLoc);
    const jobCountryList = jobCountries(job);

    if (remote) {
        if (jobCountryList.length > 0) {
            if (resumeCountries.length > 0) {
                const sameCountry = resumeCountries.some((rc) => jobCountryList.includes(rc));
                if (sameCountry) {
                    return {
                        key: "location",
                        label: "Location",
                        detail: "remote — same country",
                        score: 1,
                    };
                }
                const jobCountryStr = jobCountryList.join(", ");
                return {
                    key: "location",
                    label: "Location",
                    detail: `remote — based in ${jobCountryStr}`,
                    score: 0.65,
                };
            }
            return {
                key: "location",
                label: "Location",
                detail: "remote — open to this location",
                score: 1,
            };
        }

        return {
            key: "location",
            label: "Location",
            detail: "remote — open to any location",
            score: 1,
        };
    }

    if (resumeCountries.length === 0 || jobCountryList.length === 0) return null;

    const sameCountry = resumeCountries.some((rc) => jobCountryList.includes(rc));
    if (sameCountry) {
        return {
            key: "location",
            label: "Location",
            detail: "same country",
            score: 1,
        };
    }

    return {
        key: "location",
        label: "Location",
        detail: "different country",
        score: 0.35,
    };
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
 * The one scoring function. `relevance` is REQUIRED — no topical overlap
 * between résumé and job means no honest match to report, so this returns
 * `null` (no chip) rather than falling back to any other component alone.
 * When `relevance` does score, the total folds in `seniority` too when
 * comparable (renormalized weighted average), or stands alone otherwise.
 */
export function scoreJobAgainstResume(resume: ResumeData, job: PublicJob): MatchScore | null {
    const relevance = scoreRelevance(resume, job);
    if (!relevance) return null;

    const seniority = scoreSeniority(resume, job);
    const location = scoreLocation(resume, job);
    const components = [relevance, seniority, location].filter((c): c is MatchComponent => c !== null);

    const weightSum = components.reduce((sum, c) => sum + MATCH_WEIGHTS[c.key], 0);
    const weighted = components.reduce((sum, c) => sum + MATCH_WEIGHTS[c.key] * c.score, 0);
    const total = Math.round((weighted / weightSum) * 100);

    return { total, components };
}
