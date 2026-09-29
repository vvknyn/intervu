/**
 * Date vocabulary shared by the résumé extractor and the query-phrase validator.
 * Pure (no imports) so search-side modules can use it without pulling the extractor.
 */
const MONTH =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** U+0027 straight apostrophe or U+2019 curly apostrophe before 2-digit year (e.g. September '21). */
const APOSTROPHE_YEAR = "(?:['’]\\d{2})";

export const DATE_TOKEN = `(?:${MONTH}\\.?\\s+(?:\\d{4}|${APOSTROPHE_YEAR})|\\d{1,2}\\/\\d{4}|\\d{4})`;

/** Requires a range separator — bare graduation years like "2016" do not match. */
export const DATE_RANGE_RE = new RegExp(
    `(${DATE_TOKEN})\\s*(?:-|–|—|\\s+to\\s+|\\s+-\\s+)\\s*(${DATE_TOKEN}|Present|Current|Now)`,
    "i",
);

/** Any month-year, year, or open-ended range word — a job title never contains one. */
export const HAS_DATE_RE = new RegExp(`${DATE_TOKEN}|\\b(?:Present|Current)\\b`, "i");
