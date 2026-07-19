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

/**
 * Full calendar years elapsed between two dates (the "age" calculation — decrement
 * unless the end date's month/day has reached the start date's anniversary). This
 * avoids the off-by-one that an average-ms-per-year division introduces: e.g.
 * dividing by 365.2425 days/year floors an exact 5-year span (2021-01-01 to
 * 2026-01-01 = 1826 days, one leap day short of 5 * 365.2425) down to 4.
 */
function fullYearsBetween(start: Date, end: Date): number {
    let years = end.getFullYear() - start.getFullYear();
    const monthDiff = end.getMonth() - start.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && end.getDate() < start.getDate())) {
        years--;
    }
    return years;
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
 * Compute total years of experience by spanning the earliest parsed start date
 * to the latest parsed end date (or `now` for current/ongoing roles) across all
 * work-history entries. Entries with unparseable or future-only dates are
 * excluded, not guessed at. Returns null when no entry had a usable date —
 * callers should fall back to the model's own estimate only in that case.
 */
export function computeYearsOfExperience(experience: ResumeExperience[], now: Date): number | null {
    const ranges = (experience || [])
        .map(exp => parseDateRange(exp?.dates ?? "", now))
        .filter((r): r is ParsedRange => r !== null);

    if (ranges.length === 0) return null;

    const earliestStart = ranges.reduce((min, r) => (r.start < min ? r.start : min), ranges[0].start);
    const latestEnd = ranges.reduce((max, r) => (r.end > max ? r.end : max), ranges[0].end);

    return Math.max(0, fullYearsBetween(earliestStart, latestEnd));
}
