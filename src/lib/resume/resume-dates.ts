/**
 * Date vocabulary shared by the résumé extractor and the query-phrase validator.
 * Pure (no imports) so search-side modules can use it without pulling the extractor.
 */
export const MONTH =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** U+0027 straight apostrophe or U+2019 curly apostrophe before 2-digit year (e.g. September '21). */
const APOSTROPHE_YEAR = "(?:['’]\\d{2})";

/** "Mar 2020", "Sept '21", "05/2019", "05-2019", "01.09.2015", "2019". */
export const DATE_TOKEN = `(?:${MONTH}\\.?\\s+(?:\\d{4}|${APOSTROPHE_YEAR})|(?:\\d{1,2}[./-])?\\d{1,2}[./-]\\d{4}|\\d{4})`;

/** The end of a range that is still running: "Present", "Current", "till date", "to date". */
export const OPEN_END = "(?:(?:till|to|until)\\s+)?date\\b|(?:present|current|now|today|ongoing)\\b";

/** Requires a range separator — bare graduation years like "2016" do not match. */
export const DATE_RANGE_RE = new RegExp(
    `(${DATE_TOKEN})\\s*(?:[-–—\\u2010-\\u2015\\u2212]+|\\s+(?:to|till|until)\\s+)\\s*(${DATE_TOKEN}|${OPEN_END})`,
    "i",
);

/** How long a role lasted, printed instead of or beside its dates: "2 years 6 months", "3 yrs 10 mos". */
export const DURATION = "\\d{1,2}\\+?\\s*(?:years?|yrs?|months?|mos?)\\b(?:,?\\s*(?:and\\s+)?\\d{1,2}\\s*(?:months?|mos?)\\b)?";

/**
 * The dates an entry prints: a range, with the duration some add after it
 * ("Jan 2021 - Present (3 years 10 months)", "2019 – 2021 · 2 yrs"), or only
 * the duration, on a line of its own ("2 years 6 months") or in the line's
 * last cell ("Quality Lead | 2 yrs 3 mos", a right-aligned tab stop).
 */
export const ENTRY_DATES_RE = new RegExp(
    `${DATE_RANGE_RE.source}(?:\\s*(?:\\(|·|\\|)\\s*${DURATION}\\)?)?|(?:^|(?<=[|·]\\s*))\\(?${DURATION}\\)?$`,
    "i",
);

/** Any month-year, year, or open-ended range word — a job title never contains one. */
export const HAS_DATE_RE = new RegExp(`${DATE_TOKEN}|\\b(?:Present|Current)\\b`, "i");
