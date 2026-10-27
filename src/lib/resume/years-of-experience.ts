/**
 * Pure, testable derivation of years-of-experience from a résumé's parsed
 * work-history dates.
 *
 * The model's own `yearsOfExperience` guess (see src/actions/resume.ts) drifts
 * with its training-cutoff notion of "now" — e.g. it once computed Feb 2013 →
 * "now" as 12 years when the real answer (anchored to the actual current date)
 * was 13. Rather than trust that number, we recompute it in code from the
 * `dates` string on each experience entry, anchored to a caller-supplied `now`.
 * No React, no I/O — unit-testable in isolation.
 */

import type { ResumeExperience } from "@/types/resume";

const MONTHS: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
};

const PRESENT_RE = /^(present|current|now|ongoing|till date|to date)$/i;

const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/** Whole calendar months elapsed between two dates (day-of-month aware, like an age calculation). */
function fullMonthsBetween(start: Date, end: Date): number {
    return monthIndex(end) - monthIndex(start) - (end.getDate() < start.getDate() ? 1 : 0);
}

/** Parse a single date token ("Feb 2020", "02/2020", "2020") into a Date (1st of month). Null if unparseable. */
function parseDateToken(token: string): Date | null {
    const t = token.trim();
    if (!t) return null;

    const monthYear = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
    if (monthYear) {
        const month = MONTHS[monthYear[1].toLowerCase()];
        if (month !== undefined) return new Date(Number(monthYear[2]), month, 1);
    }

    const monthYearShort = t.match(/^([A-Za-z]{3,9})\.?\s+[''\u2019]?(\d{2})$/);
    if (monthYearShort) {
        const month = MONTHS[monthYearShort[1].toLowerCase()];
        if (month !== undefined) {
            const yy = Number(monthYearShort[2]);
            const year = yy <= 29 ? 2000 + yy : 1900 + yy;
            return new Date(year, month, 1);
        }
    }

    const numeric = t.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (numeric) {
        const month = Number(numeric[1]) - 1;
        if (month >= 0 && month <= 11) return new Date(Number(numeric[2]), month, 1);
    }

    const yearOnly = t.match(/^(\d{4})$/);
    if (yearOnly) return new Date(Number(yearOnly[1]), 0, 1);

    return null;
}

interface ParsedRange {
    start: Date;
    end: Date; // clamped to `now` when current/ongoing/unparseable/future
}

/**
 * Split a free-text `dates` field ("Feb 2020 - Present", "2019-2023", "Mar 2022")
 * into a start/end range resolved against `now`. Null if no usable start date.
 */
function parseDateRange(dates: string, now: Date): ParsedRange | null {
    if (!dates || !dates.trim()) return null;

    const parts = dates.split(/\s*(?:-|–|—|to)\s*/i).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const start = parseDateToken(parts[0]);
    if (!start) return null;

    // Future-dated start: the role hasn't begun yet, so it can't add to past
    // experience. Exclude it rather than let it inflate or invert the span.
    if (start > now) return null;

    const endToken = parts[1];
    let end: Date;
    if (!endToken || PRESENT_RE.test(endToken)) {
        // No end token (a bare "Mar 2022") or an explicit "Present" both mean
        // the role is ongoing as of `now`.
        end = now;
    } else {
        const parsedEnd = parseDateToken(endToken);
        end = parsedEnd && parsedEnd <= now ? parsedEnd : now;
    }

    return { start, end };
}

/**
 * Parse a standalone duration string ("1 year 7 months", "3 years 6 months", "6 months")
 * into total whole months. Null when `dates` does not state a duration.
 */
function parseDurationMonths(dates: string): number | null {
    if (!dates || !dates.trim()) return null;
    const yearsMatch = dates.match(/\b(\d{1,2})\s*(?:years?|yrs?)\b(?!\s+of\b)/i);
    const monthsMatch = dates.match(/\b(\d{1,2})\s*(?:months?|mos?)\b(?!\s+of\b)/i);
    if (!yearsMatch && !monthsMatch) return null;
    const years = yearsMatch ? Number(yearsMatch[1]) : 0;
    const months = monthsMatch ? Number(monthsMatch[1]) : 0;
    const total = years * 12 + months;
    return total > 0 ? total : null;
}

/**
 * Compute total years of experience as the sum of the merged role spans: overlapping
 * roles count once, gaps between roles do not count, and an ongoing role runs to `now`.
 * Dates are month-granular ("Dec 2019" parses as Dec 1), so a role starting the month
 * after another ends is back-to-back, not a gap. Entries with duration spans ("1 year
 * 7 months", "6 months") contribute their stated months when they hold no calendar
 * range. Returns null when no entry had a usable date or duration.
 */
export function computeYearsOfExperience(experience: ResumeExperience[], now: Date): number | null {
    const ranges: ParsedRange[] = [];
    let durationMonths = 0;
    let hasDuration = false;

    for (const exp of experience || []) {
        const rawDates = exp?.dates ?? "";
        const range = parseDateRange(rawDates, now);
        if (range) {
            ranges.push(range);
            continue;
        }
        const dur = parseDurationMonths(rawDates);
        if (dur !== null) {
            durationMonths += dur;
            hasDuration = true;
        }
    }

    if (ranges.length === 0 && !hasDuration) return null;

    let rangeMonths = 0;
    if (ranges.length > 0) {
        ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
        const merged: ParsedRange[] = [{ ...ranges[0] }];
        for (const r of ranges.slice(1)) {
            const last = merged[merged.length - 1];
            if (monthIndex(r.start) <= monthIndex(last.end) + 1) {
                if (r.end > last.end) last.end = r.end;
            } else {
                merged.push({ ...r });
            }
        }
        rangeMonths = merged.reduce((sum, r) => sum + Math.max(0, fullMonthsBetween(r.start, r.end)), 0);
    }

    return Math.floor((rangeMonths + durationMonths) / 12);
}
