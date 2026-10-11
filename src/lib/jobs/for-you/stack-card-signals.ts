import { deriveGhostSignals } from "@/components/jobs/job-detail-facts";
import { deckOverlapSentence } from "@/lib/jobs/for-you/deck-detail";
import { NO_SCORE_MESSAGES, noScoreReason } from "@/lib/jobs/for-you/infer-reasons";
import type { PostingFreshness } from "@/lib/jobs/posting-freshness";
import { yearsAsked } from "@/lib/jobs/role-level";
import { LOCATION_UNKNOWN_TEXT, placeWithWorkMode, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";
import { presentJob } from "@/lib/presentation";
import type { ResumeData } from "@/types/resume";

/**
 * What a stacked role card says, split by where it came from (Vivek,
 * 2026-09-30): the left side is the summary plus what Velai worked out about
 * the role against the résumé; the right side is what the posting itself
 * states. Pure, so each line is testable without mounting the card.
 */

export type InferredTone = "good" | "neutral" | "caution";

export interface InferredRow {
    text: string;
    tone: InferredTone;
}

export interface StatedDetail {
    label: string;
    value: string;
}

/** A component at or above this score reads as in the role's favour, below
 *  `NEUTRAL_MIN` as against it. The same cut the fit bands use (60/100). */
const GOOD_MIN = 0.75;
const NEUTRAL_MIN = 0.6;

function capitalize(text: string): string {
    return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function toneForScore(score: number): InferredTone {
    if (score >= GOOD_MIN) return "good";
    if (score >= NEUTRAL_MIN) return "neutral";
    return "caution";
}

/** "Asks for 5+ years of experience", "Asks for 3 to 5 years of experience", or null. */
export function yearsAskedText(job: Pick<PublicJob, "min_years_experience" | "max_years_experience">): string | null {
    const min = yearsAsked(job.min_years_experience);
    const max = yearsAsked(job.max_years_experience);
    if (min != null && max != null && max > min) return `Asks for ${min} to ${max} years of experience`;
    if (min != null) return `Asks for ${min}+ ${min === 1 ? "year" : "years"} of experience`;
    return null;
}

/**
 * The "What we inferred" rows, strongest evidence first:
 * 1. a résumé role the title overlaps (`deckOverlapSentence`);
 * 2. each fit component we could actually compare, in the score's own words
 *    (an `unknown` component compared nothing, so it is left out); with no
 *    score at all, the one line that says why;
 * 3. the years the posting asks for and its visa stance, when it states one;
 * 4. the posting checks that carry a verdict: freshness, and a thin description.
 */
export function stackInferredRows(input: {
    job: PublicJob;
    score: MatchScore | null;
    resume: ResumeData | null;
    freshness: PostingFreshness;
    descBlockCount: number;
    nowMs: number;
}): InferredRow[] {
    const { job, score, resume, freshness, descBlockCount, nowMs } = input;
    const rows: InferredRow[] = [];

    const overlap = deckOverlapSentence(job, resume);
    if (overlap) rows.push({ text: overlap, tone: "good" });

    if (score) {
        for (const component of score.components) {
            if (component.unknown) continue;
            rows.push({ text: `${component.label}: ${component.detail}`, tone: toneForScore(component.score) });
        }
    } else {
        rows.push({ text: NO_SCORE_MESSAGES[noScoreReason(resume)], tone: "neutral" });
    }

    const years = yearsAskedText(job);
    if (years) rows.push({ text: years, tone: "neutral" });

    if (job.visa_sponsorship === true) rows.push({ text: "Sponsors visas, per the posting", tone: "good" });
    else if (job.visa_sponsorship === false) rows.push({ text: "No visa sponsorship, per the posting", tone: "caution" });

    for (const signal of deriveGhostSignals(job, freshness, descBlockCount, nowMs)) {
        if (signal.kind === "freshness" && signal.status !== "unknown") {
            rows.push({ text: capitalize(signal.text), tone: signal.status === "favorable" ? "good" : "caution" });
        } else if (signal.kind === "description" && signal.status === "unfavorable") {
            rows.push({ text: capitalize(signal.text), tone: "caution" });
        }
    }

    return rows;
}

/** The place under the title: the location with its work mode, never the mode twice. */
export function stackCardPlace(job: PublicJob): string | null {
    const location = presentJob(job).location;
    const known = location && location !== LOCATION_UNKNOWN_TEXT ? location : "";
    const place = placeWithWorkMode(known, job.work_type);
    return place || null;
}

/** The posting's own facts for the details grid. Absent facts are left out, never "Unknown". */
export function stackCardDetails(job: PublicJob, postedRelative: string | null): StatedDetail[] {
    const details: StatedDetail[] = [];
    const location = presentJob(job).location;
    if (location && location !== LOCATION_UNKNOWN_TEXT) details.push({ label: "Location", value: location });
    const workplace = prettyEnum(job.work_type);
    if (workplace) details.push({ label: "Workplace", value: workplace });
    const type = prettyEnum(job.employment_type);
    if (type) details.push({ label: "Type", value: type });
    const seniority = prettyEnum(job.experience_level);
    if (seniority) details.push({ label: "Seniority", value: seniority });
    const salary = salaryText(job);
    if (salary) details.push({ label: "Salary", value: salary });
    if (postedRelative) details.push({ label: "Posted", value: postedRelative });
    return details;
}
