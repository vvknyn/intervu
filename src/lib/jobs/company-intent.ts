/**
 * Company-name query intent (search-quality wave, 2026-08-11).
 *
 * WHY THIS EXISTS
 * ---------------
 * Meilisearch's `exactness` ranking rule has an ExactAttribute tier: a
 * document whose whole searchable attribute EQUALS the query outranks every
 * document that merely contains it. On this corpus that single rule does two
 * opposite things depending on which attribute it lands on:
 *
 *   - on `title`  — pathological. Bare "Product Manager" rows form a tier
 *     1,073 documents deep (2,238 for "software engineer", 4,037 for
 *     "registered nurse", measured live 2026-08-11), so every SPECIFIC title
 *     ("Product Manager, E-Invoicing" — exactness 0.667) is gated below all
 *     of them and can never reach page 1.
 *   - on `company` — load-bearing. For q="stripe" it is the ONLY thing that
 *     keeps real Stripe listings above "FOREMAN - SEAL & STRIPE" (a title
 *     match, exactness 0.333).
 *
 * Demoting `exactness` in `rankingRules` fixes the first and breaks the
 * second, because Meilisearch applies one global rule order to both query
 * intents and cannot scope a ranking rule per attribute. This module removes
 * that coupling at QUERY time: when the corpus says the typed text IS an
 * employer's name, the search is scoped to `attributesToSearchOn: ["company"]`,
 * which reproduces the company-precision that `exactness` was silently
 * providing — without depending on `exactness` at all. That makes the
 * rankingRules change safe to apply (see scripts/apply-ranking-rules-v2.mjs).
 *
 * WHY A DOMINANCE RATIO AND NOT `probeCompanyMatch`'s BOOLEAN
 * ----------------------------------------------------------
 * `probeCompanyMatch` answers "does ANY company match every word", which is
 * far too loose to gate on — measured live against the company attribute:
 * "accountant" → 91 companies, "software engineer" → 34 ("Software
 * Engineering"), "product manager" → 1 ("IT Product Manager (All Gender)"),
 * and there is an employer literally named "Registered Nurse". Scoping those
 * role searches to `company` would destroy them. What actually separates the
 * two intents is whether the matches are DOMINATED by an employer whose name
 * IS the query: "stripe"/"cloudflare"/"databricks" return 5/5 exact-name
 * matches, every role query above returns 0/5 or 1/4.
 *
 * The gate is therefore a property of the match distribution, never a list of
 * company names — a newly-indexed employer is covered by construction, and
 * nothing here needs editing when the corpus changes.
 *
 * FAILING OPEN IS THE SAFE DIRECTION: a false negative just runs the normal
 * whole-document search (today's behaviour). A false positive would hide
 * legitimate title matches, so both thresholds below are set for precision.
 */

/** How many company-scoped hits to inspect when judging intent. */
export const COMPANY_INTENT_SAMPLE = 10;

/**
 * Minimum number of exactly-named listings required. Guards the degenerate
 * case where the corpus holds ONE junk employer named after a role (e.g. the
 * single company literally called "Registered Nurse"): a 1/1 sample would be
 * a perfect ratio but is not evidence of company intent. An employer with
 * fewer than this many open roles simply keeps the normal search path.
 */
export const COMPANY_INTENT_MIN_EXACT = 3;

/** Minimum share of the sample whose company name IS the query. */
export const COMPANY_INTENT_MIN_RATIO = 0.6;

/** One company-attribute probe's result — the raw material for the decision. */
export interface CompanyNameSample {
  /** Total documents whose `company` matched every word of the query. */
  total: number;
  /** `company` values from the top of that company-scoped search. */
  companies: string[];
}

/**
 * Case/whitespace/punctuation-insensitive company-name comparison. Trailing
 * legal suffixes are NOT stripped: "Stripe" and "Stripe Inc" are different
 * strings here on purpose, because the corpus stores whichever form the ATS
 * published and we only want to claim intent when the typed text matches
 * what is actually indexed.
 */
export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does the typed query name an employer the corpus knows, strongly enough to
 * scope the search to the `company` attribute?
 *
 * Pure — the caller supplies the probe result, so this is unit-testable with
 * no Meilisearch and no mocks.
 */
export function isCompanyNameQuery(q: string, sample: CompanyNameSample): boolean {
  const needle = normalizeCompanyName(q);
  if (!needle) return false;
  const inspected = sample.companies.length;
  if (inspected === 0) return false;
  const exact = sample.companies.filter((c) => normalizeCompanyName(c ?? "") === needle).length;
  if (exact < COMPANY_INTENT_MIN_EXACT) return false;
  return exact / inspected >= COMPANY_INTENT_MIN_RATIO;
}
