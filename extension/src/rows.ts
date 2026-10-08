/**
 * One search hit as the side panel shows it, built from the same helpers the
 * velai.app job rows use (`JobCard`), so a role reads the same in the panel
 * and on the site: title and company from `presentJob`, the posted age from
 * `postedAgeShort`, and the Relisted / Possibly stale / worth-verifying marks
 * from `rowExceptionMark`.
 */
import { presentJob } from "@/lib/presentation";
import { LOCATION_UNKNOWN_TEXT, postedAgeShort } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { jobPath } from "@/lib/jobs/job-slug";
import { sanitizeTimestamp } from "@/lib/jobs/posting-freshness";
import type { PublicJob } from "@/lib/jobs/types";
import { hostOf } from "./page-query";

export const VELAI_ORIGIN = "https://velai.app";

export interface PanelMark {
    text: string;
    /** The panel's CSS class for the mark's colour. */
    tone: "stale" | "relisted" | "review";
}

export interface PanelRow {
    id: string;
    title: string;
    company: string;
    /** Company, place and posted age, in the order the site's rows use. */
    meta: string[];
    marks: PanelMark[];
    /** Why the marks are there, in the site's own words; null when there are none. */
    explain: string | null;
    velaiUrl: string;
    /** The employer's own posting, and its host to name the link. */
    applyUrl: string | null;
    applyHost: string | null;
}

/** Same posted-time rule as `derivePostedTs` (lib/jobs/meilisearch.ts), which
 *  can't be bundled here without the search client it sits beside. */
function postedTs(job: PublicJob, nowMs: number): number | null {
    return sanitizeTimestamp(job.posted_at, nowMs) ?? sanitizeTimestamp(job.first_seen_at, nowMs) ?? null;
}

/** The mark's colour from the class `rowExceptionMark` gives it on the site. */
function toneOf(className: string): PanelMark["tone"] {
    if (className.includes("st-closed")) return "stale";
    if (className.includes("st-intv")) return "review";
    return "relisted";
}

/** Pure: a search hit as a panel row. */
export function panelRow(job: PublicJob, nowMs: number): PanelRow {
    const presented = presentJob(job);
    const locationKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
    const age = postedAgeShort(postedTs(job, nowMs), nowMs);
    const mark = rowExceptionMark(job, nowMs);
    const applyHost = job.apply_url ? hostOf(job.apply_url) : null;
    return {
        id: job.id,
        title: presented.title,
        company: presented.company.name,
        meta: [presented.company.name, locationKnown ? presented.location : null, age].filter(
            (part): part is string => Boolean(part),
        ),
        marks: mark ? mark.parts.map((part) => ({ text: part.text, tone: toneOf(part.className) })) : [],
        explain: mark ? mark.explain : null,
        velaiUrl: `${VELAI_ORIGIN}${jobPath(job)}`,
        applyUrl: applyHost ? job.apply_url : null,
        applyHost,
    };
}

/** The velai.app search page for a query, for "see all on Velai". */
export function velaiSearchUrl(q: string): string {
    return `${VELAI_ORIGIN}/jobs?q=${encodeURIComponent(q)}`;
}
