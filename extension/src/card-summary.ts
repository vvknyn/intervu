/**
 * What the on-page Velai card says about a job: the person's fit and a few
 * facts about the posting. Every line names where it comes from (your
 * résumé, the page, or Velai and when it checked), and a fact that isn't
 * known is left out rather than shown as a guess.
 */
import { ghostMetaFor, postedAgeShort, shortDate } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { sanitizeTimestamp } from "@/lib/jobs/posting-freshness";
import { presentJob } from "@/lib/presentation";
import type { AgentPreferences } from "@/lib/agent/preferences";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { fitReport, type FitReport } from "./report";
import { jobPath } from "@/lib/jobs/job-slug";
import { VELAI_ORIGIN } from "./rows";
import { relevanceTerms, termAsWritten } from "@/lib/match/score";

export interface CardLine {
    text: string;
    /** "the page", "Velai, checked 3h ago", "your résumé". */
    source: string;
    tone: "ok" | "warn" | "bad" | "neutral";
}

/** What "I applied" sends to the person's Velai tracker. */
export interface TrackJob {
    title: string;
    company: string;
    /** The page the person applied on. */
    applyUrl: string;
    /** Velai's posting, when it has it, so the tracker links the same job. */
    jobId?: string;
}

/** The terms the fit label counts (the role's title and tags), split by whether the résumé has them, as the job writes them. */
export interface FitTerms {
    matched: string[];
    missing: string[];
}

/** Terms shown as chips on the card; the panel lists them all. */
export const CARD_TERM_LIMIT = 4;

/** Pure: the fit label's terms for the chips, or null when the role names none. */
export function fitTerms(resume: ResumeData, job: PublicJob): FitTerms | null {
    const { matched, missing } = relevanceTerms(resume, job);
    if (!matched.length && !missing.length) return null;
    return { matched: matched.map((t) => termAsWritten(t, job)), missing: missing.map((t) => termAsWritten(t, job)) };
}

export interface CardSummary {
    title: string;
    company: string | null;
    /** null when signed out, without a résumé, or when the résumé and role don't overlap. */
    fit: Pick<FitReport, "label" | "tone"> | null;
    /** With a fit label: the terms it counts, ✓ on the résumé or ✗ not. */
    terms: FitTerms | null;
    /** Why there's no fit line, when there isn't one. */
    account: "signed-out" | "no-resume" | "no-overlap" | "unavailable" | null;
    lines: CardLine[];
    /** The posting on velai.app, when Velai has it. */
    velaiUrl: string | null;
    /** What "I applied" would save; null when signed out or the employer isn't known. */
    track: TrackJob | null;
}

export interface CardInput {
    pageJob: PublicJob;
    /** Velai's copy of the posting, when it has one. */
    velaiJob: PublicJob | null;
    /** The page's own apply-by date. */
    applyBy: string | null;
    /** null when velai.app didn't answer. */
    signedIn: boolean | null;
    resume: ResumeData | null;
    prefs: AgentPreferences | null;
    resumeUpdatedAt?: string | null;
    nowMs: number;
}

/** Most lines a card shows; the panel has the rest. */
export const CARD_LINE_LIMIT = 4;

function age(at: string | null | undefined, nowMs: number): string | null {
    return postedAgeShort(sanitizeTimestamp(at, nowMs), nowMs);
}

/** Pure: the card for a job page. */
export function cardSummary(input: CardInput): CardSummary {
    const { pageJob, velaiJob, applyBy, nowMs } = input;
    const job = velaiJob ?? pageJob;
    const lines: CardLine[] = [];

    if (velaiJob) {
        const meta = ghostMetaFor(velaiJob, nowMs);
        const checked = age(velaiJob.ghost_checked_at, nowMs);
        if (meta && checked) {
            const tone: CardLine["tone"] = velaiJob.ghost_badge === "likely_ghost" ? "bad" : velaiJob.ghost_badge === "clear" ? "ok" : "warn";
            lines.push({ text: meta.label, source: `Velai, checked ${checked}`, tone });
        }
        const mark = rowExceptionMark(velaiJob, nowMs);
        for (const part of mark?.parts ?? []) {
            if (part.text === meta?.label) continue;
            lines.push({ text: part.text, source: "Velai", tone: part.className.includes("st-closed") ? "bad" : "warn" });
        }
    }

    // Posted: the page's own date first; Velai's first sighting only when the page states none.
    const pagePosted = sanitizeTimestamp(pageJob.posted_at, nowMs);
    const velaiPosted = velaiJob ? (sanitizeTimestamp(velaiJob.posted_at, nowMs) ?? sanitizeTimestamp(velaiJob.first_seen_at, nowMs)) : null;
    if (pagePosted) lines.push({ text: `Posted ${postedAgeShort(pagePosted, nowMs)}`, source: "the page", tone: "neutral" });
    else if (velaiPosted) lines.push({ text: `Posted ${postedAgeShort(velaiPosted, nowMs)}`, source: "Velai", tone: "neutral" });

    const pagePay = presentJob(pageJob).salary;
    const velaiPay = velaiJob ? presentJob(velaiJob).salary : null;
    if (pagePay) lines.push({ text: pagePay, source: "the page", tone: "neutral" });
    else if (velaiPay) lines.push({ text: velaiPay, source: "Velai", tone: "neutral" });

    const deadline = applyBy ? Date.parse(applyBy) : NaN;
    if (Number.isFinite(deadline)) {
        lines.push(
            deadline < nowMs
                ? { text: `Applications closed ${shortDate(deadline)}`, source: "the page", tone: "bad" }
                : { text: `Apply by ${shortDate(deadline)}`, source: "the page", tone: "neutral" },
        );
    }

    const open = velaiJob?.company_open_count;
    if (typeof open === "number" && open > 1) {
        lines.push({ text: `${open} open roles at ${presentJob(velaiJob!).company.name}`, source: "Velai", tone: "neutral" });
    }

    let fit: CardSummary["fit"] = null;
    let terms: FitTerms | null = null;
    let account: CardSummary["account"] = null;
    if (input.signedIn === null) account = "unavailable";
    else if (!input.signedIn) account = "signed-out";
    else if (!input.resume) account = "no-resume";
    else {
        const report = fitReport(input.resume, input.prefs, job, input.resumeUpdatedAt);
        if (report) {
            fit = { label: report.label, tone: report.tone };
            terms = fitTerms(input.resume, job);
        }
        else account = "no-overlap";
    }

    const presented = presentJob(job);
    const employer = job.company?.trim() || pageJob.company?.trim() || "";
    const track: TrackJob | null =
        input.signedIn && employer
            ? { title: job.title, company: employer, applyUrl: pageJob.apply_url, ...(velaiJob ? { jobId: velaiJob.id } : {}) }
            : null;
    return {
        title: presented.title,
        company: job.company ? presented.company.name : null,
        fit,
        terms,
        account,
        lines: lines.slice(0, CARD_LINE_LIMIT),
        velaiUrl: velaiJob ? `${VELAI_ORIGIN}${jobPath(velaiJob)}` : null,
        track,
    };
}
