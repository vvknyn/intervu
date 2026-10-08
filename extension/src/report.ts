/**
 * The panel's report for one job, built only from Velai's own rules so it
 * reads the same as velai.app:
 *  - fit: `scoreJobAgainstResume` with the person's saved preferences
 *    (`resolveCandidateSignals`), labelled by `matchLabel`, explained by
 *    `explainMatch`, with the same receipt rows as the site's MatchChip;
 *  - job checks: Velai's status verdict and row marks when Velai has the
 *    posting, otherwise only what the page itself states;
 *  - tailored résumé: the heuristic tailor behind the gate that drops any edit
 *    adding a word or number the résumé doesn't already have (`groundDraft`),
 *    then the job's lines and skills moved first (`orderForRole`).
 */
import { explainMatch } from "@/lib/match/explain";
import { labelNamesPlace, matchBand, matchLabel, scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import { resolveCandidateSignals } from "@/lib/jobs/candidate-signals";
import { GHOST_META, ghostMetaFor, postedAgeShort, shortDate } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { sanitizeTimestamp } from "@/lib/jobs/posting-freshness";
import { presentJob } from "@/lib/presentation";
import { heuristicTailorResume, resumeFullText, roleTermsForJob, type TailorBulletDiff } from "@/lib/local-ai/tailor-resume";
import { groundDraft, jobToTailorInput } from "@/lib/local-ai/tailor-ground";
import { storedResumeData } from "@/lib/resume/stored-resume-data";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { AgentPreferences } from "@/lib/agent/preferences";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { postingKey } from "./page-reader";
import { orderForRole } from "./tailor-order";

/** What GET velai.app/api/extension/me answers. */
export interface MeResponse {
    signedIn: boolean;
    resume?: { data: ResumeData | null; text: string | null; updatedAt: string | null } | null;
    preferences?: AgentPreferences | null;
}

/** Same wording as the site's match receipt (MatchChip's "Not counted" row). */
export const NOT_COUNTED_DETAIL = "salary — your call to weigh";

export interface FitReport {
    label: string;
    tone: "strong" | "good" | "stretch" | "outside";
    /** "Why Strong — against your résumé of oct 7", as the site's receipt heads it. */
    heading: string;
    why: string;
    rows: { label: string; value: string }[];
}

/** Pure: the person's résumé from what the endpoint returned, structured the
 *  way every velai.app surface structures it; null when there's none usable. */
export function resumeFromMe(me: MeResponse): ResumeData | null {
    if (!me.resume) return null;
    const data = storedResumeData(me.resume.data ?? undefined, me.resume.text);
    return data && resumeIsUsable(data) ? data : null;
}

function asOf(updatedAt: string | null | undefined): string | null {
    if (!updatedAt) return null;
    const ms = Date.parse(updatedAt);
    return Number.isFinite(ms) ? shortDate(ms).toLowerCase() : null;
}

/** Pure: the fit report, or null when the résumé and the role don't overlap
 *  (the site shows no fit label then either). */
export function fitReport(resume: ResumeData, prefs: AgentPreferences | null, job: PublicJob, updatedAt?: string | null): FitReport | null {
    const score: MatchScore | null = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs));
    if (!score) return null;
    const label = matchLabel(score);
    const namesPlace = labelNamesPlace(score);
    const date = asOf(updatedAt);
    const named = namesPlace ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
    return {
        label,
        tone: namesPlace ? "outside" : matchBand(score.total),
        heading: `Why ${named}${date ? ` — against your résumé of ${date}` : ""}`,
        why: explainMatch(score),
        rows: [
            ...score.components.map((c) => ({ label: c.label, value: c.detail })),
            { label: "Not counted", value: NOT_COUNTED_DETAIL },
        ],
    };
}

export interface TailoredResume {
    /** The résumé to download: reworded lines, then the job's lines and skills first. */
    resume: ResumeData;
    /** Lines whose wording changed (only those; an unchanged line isn't listed). */
    reworded: TailorBulletDiff[];
    /** The summary's new wording, or null when it stayed as written. */
    summary: string | null;
    /** Roles whose lines were reordered so the ones using the job's words come first. */
    movedRoles: string[];
    /** Skills moved to the front of their group because the job names them. */
    leadingSkills: string[];
}

/**
 * Pure: the résumé tailored to this job — the site's heuristic tailor behind
 * the gate that drops any edit adding a word or number the résumé doesn't
 * already have (`groundDraft`), then ordered so the job's lines and skills
 * come first (`orderForRole`).
 */
export function tailoredResume(resume: ResumeData, job: PublicJob): TailoredResume {
    // The tailor edits in place; hand it a copy so the stored résumé stays as loaded.
    const copy = structuredClone(resume);
    const input = jobToTailorInput(job);
    const draft = groundDraft(resumeFullText(copy), heuristicTailorResume(copy, input));
    const ordered = orderForRole(draft.tailored, roleTermsForJob(input));
    const summary = draft.summaryAfter && draft.summaryAfter !== draft.summaryBefore ? draft.summaryAfter : null;
    return {
        resume: ordered.resume,
        reworded: draft.bullets.filter((b) => b.after.trim() !== b.before.trim()),
        summary,
        movedRoles: ordered.movedRoles,
        leadingSkills: ordered.leadingSkills,
    };
}

function norm(text: string | null | undefined): string {
    return (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Pure: Velai's copy of the posting on the page, when one of the search hits
 * is it — the same posting URL, or failing that the same title at the same
 * company. Null when none is, so the panel never passes a different role off
 * as this one.
 */
export function sameJob(hits: PublicJob[], pageUrl: string, page: Pick<PublicJob, "title" | "company">): PublicJob | null {
    const key = postingKey(pageUrl);
    const byUrl = key ? hits.find((hit) => postingKey(hit.apply_url) === key) : undefined;
    if (byUrl) return byUrl;
    if (!page.company) return null;
    return hits.find((hit) => norm(hit.title) === norm(page.title) && norm(hit.company) === norm(page.company)) ?? null;
}

export interface CheckLine {
    label: string;
    detail: string | null;
    tone: "ok" | "warn" | "bad" | "neutral";
}

function tonePart(className: string): CheckLine["tone"] {
    return className.includes("st-closed") ? "bad" : "warn";
}

/**
 * Pure: the job checks for Velai's copy of a posting — Velai's status verdict
 * (`ghostMetaFor`, the same chokepoint as the site's badge and banner), a
 * Relisted mark when the site's row would carry one, when it was posted, and
 * the pay as the site states it.
 */
export function velaiChecks(job: PublicJob, nowMs: number): CheckLine[] {
    const lines: CheckLine[] = [];
    const meta = ghostMetaFor(job, nowMs);
    if (meta) {
        const tone: CheckLine["tone"] =
            job.ghost_badge === "likely_ghost" ? "bad" : job.ghost_badge === "caution" || meta.label !== GHOST_META.clear?.label ? "warn" : "ok";
        lines.push({ label: meta.label, detail: meta.explain, tone });
    } else {
        lines.push({ label: "Not checked yet", detail: "Velai hasn't run its freshness checks on this posting yet.", tone: "neutral" });
    }
    const mark = rowExceptionMark(job, nowMs);
    for (const part of mark?.parts ?? []) {
        if (part.text === meta?.label) continue;
        lines.push({ label: part.text, detail: mark?.kind === "relisted" ? mark.explain : null, tone: tonePart(part.className) });
    }
    const posted = postedAgeShort(sanitizeTimestamp(job.posted_at, nowMs) ?? sanitizeTimestamp(job.first_seen_at, nowMs), nowMs);
    lines.push({ label: posted ? `Posted ${posted}` : "Posting date not listed", detail: null, tone: "neutral" });
    const pay = presentJob(job).salary;
    lines.push({ label: pay ? `Pay ${pay}` : "Pay not listed", detail: null, tone: "neutral" });
    return lines;
}

/**
 * Pure: what can be said about a posting Velai doesn't have — only what the
 * page itself states (its posted and apply-by dates and pay), and plainly
 * that Velai hasn't checked it.
 */
export function pageChecks(job: PublicJob, applyBy: string | null, nowMs: number): CheckLine[] {
    const lines: CheckLine[] = [
        { label: "Not on Velai yet", detail: "Velai hasn't found this posting on a careers page, so it hasn't checked how fresh it is.", tone: "neutral" },
    ];
    const posted = sanitizeTimestamp(job.posted_at, nowMs);
    lines.push({ label: posted ? `The page says it was posted ${shortDate(posted)}` : "The page doesn't say when it was posted", detail: null, tone: "neutral" });
    const deadline = applyBy ? Date.parse(applyBy) : NaN;
    if (Number.isFinite(deadline)) {
        lines.push(
            deadline < nowMs
                ? { label: `The page says applications closed ${shortDate(deadline)}`, detail: null, tone: "bad" }
                : { label: `The page says apply by ${shortDate(deadline)}`, detail: null, tone: "neutral" },
        );
    }
    const pay = presentJob(job).salary;
    lines.push({ label: pay ? `Pay ${pay}` : "The page doesn't list pay", detail: null, tone: "neutral" });
    return lines;
}
