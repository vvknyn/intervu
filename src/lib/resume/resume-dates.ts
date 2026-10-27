/**
 * Date vocabulary shared by the résumé extractor and the query-phrase validator.
 * Pure (no imports) so search-side modules can use it without pulling the extractor.
 */
export const MONTH =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** U+0027 straight apostrophe or U+2019 curly apostrophe before 2-digit year (e.g. September '21). */
const APOSTROPHE_YEAR = "(?:['’]\\d{2})";

export const DATE_TOKEN = `(?:${MONTH}\\.?\\s+(?:\\d{4}|${APOSTROPHE_YEAR})|\\d{1,2}\\/\\d{4}|\\d{4})`;

/** Requires a range separator — bare graduation years like "2016" do not match. */
export const DATE_RANGE_RE = new RegExp(
    `(${DATE_TOKEN})\\s*(?:-|–|—|\\s+to\\s+|\\s+-\\s+)\\s*(${DATE_TOKEN}|Present|Current|Now)`,
    "i",
);

/**
 * Standalone duration span on a role header line ("1 year 7 months", "3 years 6 months",
 * "6 months", "2 yrs 4 mos"), excluding prose phrases like "5 years of experience".
 */
export const DURATION_SPAN_RE =
    /\b(\d{1,2}\s*(?:years?|yrs?)(?:\s*,?\s*(?:and\s+)?\d{1,2}\s*(?:months?|mos?))?|\d{1,2}\s*(?:months?|mos?))\b(?!\s+(?:of\b|in\b|at\b|with\b|experience\b|old\b|ago\b))/i;

/** Either a calendar date range ("Jan 2020 – Present") or a standalone duration span ("1 year 7 months"). */
export const DATE_OR_DURATION_RE = new RegExp(
    `${DATE_RANGE_RE.source}|${DURATION_SPAN_RE.source}`,
    "i",
);

/** Any month-year, year, or open-ended range word — a job title never contains one. */
export const HAS_DATE_RE = new RegExp(`${DATE_TOKEN}|\\b(?:Present|Current)\\b|${DURATION_SPAN_RE.source}`, "i");
