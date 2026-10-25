/**
 * Should a `/co/[slug]` page be submitted to search engines?
 *
 * Before this gate, `sitemap.ts` submitted one `/co/` URL per elite-board
 * domain straight off the allowlist — 442 URLs, nothing checking whether the
 * page behind each one had anything on it. Measured against the live index
 * 2026-08-11: 132 of those 442 (30%) have ZERO live roles, so those pages
 * render a heading, four KPI tiles (three of them "—", see below) and no
 * content whatsoever. That is a soft 404 by Google's definition, and
 * submitting 132 of them is the kind of site-wide quality signal that drags
 * down the pages which DO have content. This gate takes 442 submitted URLs
 * to 263.
 *
 * THE RULE (S2, one only): a page is indexable exactly when its company is in
 * the sitemap set — the directory model's listed companies (directory-model.ts):
 * at least {@link MIN_SITEMAP_ROLES} live roles as `company_directory` measures
 * it, a real company under its own name, the top {@link SITEMAP_COMPANY_CAP} by live count.
 * Nothing else gates it: the page states only the facts it holds, so a member without, say, a stated country is still a full page.
 * Every other company page still renders in full, as `noindex, follow`. The earlier 3-role page floor and the
 * track-record OR are gone: they let ~10-role pages and pages with only a
 * track record be indexable while the sitemap (25 roles) never listed them.
 *
 * UPDATE 2026-08-13: `fetchIndexableCompanyDomains` below no longer sources
 * candidates from `getBoardDomains("elite")` (442 curated domains —
 * `/co/[slug]` was never actually keyed to that list) nor from the
 * NOT-IN-paginated `company_domain` facet walk PR #186 shipped (reverted in
 * #187: it re-issued that walk on every `/sitemap.xml` request and timed out
 * once the corpus reached tens of thousands of domains). The durable
 * replacement is a separate publisher, `push-company-directory.mjs`
 * (subspace repo, off-app, admin key), which pages the jobs index ONCE on
 * its own schedule and writes one pre-aggregated `{ domain, open_role_count
 * }` doc per company to a dedicated `company_directory` Meilisearch index.
 * This module just reads that index with the search key this app already
 * has — the same shift `market-stats.ts` made for `/trends`'s closed-count
 * figure, and for the same reason: an app-request-time walk of the live
 * corpus does not scale, a pre-computed publish does.
 *
 * NOT in the gate, deliberately, both measured rather than assumed:
 *
 *   - `nameSource === "domain"` (the name was derived from the domain rather
 *     than found in the corpus). 141 of 442 domains, but 132 of those have
 *     zero live roles and are already excluded by the count — it is 96%
 *     redundant. The 6 pages where it is NOT redundant are checkout.com (184
 *     live roles), primer.io (38), qdrant.tech (12), magic.dev (10),
 *     fireflies.ai (7) and fathom.video (5): companies whose corpus `company`
 *     string IS their domain, which `cleanCompany` strips as domain-shaped,
 *     leaving perfectly readable labels ("Checkout", "Primer", "Qdrant"). It
 *     also does not catch the mangled titles it looks like it would — a
 *     live "Is 23andme hiring?" is a zero-role page (already excluded on
 *     count) and a live "Is 1password hiring?" is `corpus-flat`, not
 *     `"domain"`. Suppressing a 184-role page over a name this predicate
 *     misidentifies is a worse trade than fixing the name.
 *   - `ghostFlaggedPct`. It is computed over the fetched role window (at most
 *     `COMPANY_JOBS_FETCH_LIMIT` roles), not company-wide — see its doc on
 *     `CompanyPageData`. A sample-derived number has no business deciding
 *     whether a whole page is fit to submit.
 *
 * Mirrors the robots policy `/jobs/[slug]` already applies inline (see its
 * `generateMetadata` — closed/ghost/unscored postings get `noindex, follow`),
 * extracted here as a pure, unit-tested function because a SECOND surface —
 * `sitemap.ts` — now has to agree with it exactly. A sitemap that lists URLs
 * the page itself marks `noindex` is a self-contradicting submission.
 */
import { hasMeilisearch, host, meiliFetch, searchKey } from "@/lib/jobs/meilisearch";
import { stripFormatChars } from "@/lib/jobs/presentation";

/** Live roles a company needs to be in the sitemap set, and so to be indexable. */
export const MIN_SITEMAP_ROLES = 25;

/** Hard cap on `/co/` URLs submitted — the top employers by live role count
 *  after {@link MIN_SITEMAP_ROLES} filtering. */
export const SITEMAP_COMPANY_CAP = 3000;

/** Candidates read before the directory's rules exclude any (see directory-model.ts): the cap plus
 *  room for the exclusions, so they do not shrink what is listed. On Oct 23 data 3700 candidates leave
 *  3152 after the exclusions (about 15% go), 152 over the cap to absorb drift between reads; 3650 left 109. */
export const DIRECTORY_POOL_SIZE = 3700;

export interface CompanyIndexabilityInput {
  /** The domain is in the set `sitemap.ts` submits (see
   *  {@link fetchCompanyInSitemapSet}). */
  inSitemapSet: boolean;
}

export interface CompanyIndexability {
  /** Should this domain be a `/sitemap.xml` `/co/` entry? */
  inSitemap: boolean;
  /** Should THIS request's page render indexable (no `noindex`)? */
  pageIndexable: boolean;
}

/**
 * THE seam, and the only indexability rule: indexable ⇔ in the sitemap set.
 * Both flags are that one boolean, so a page can never be indexable without
 * being submitted nor submitted while `noindex` — the recurring GSC
 * "Submitted URL marked noindex" class this seam exists to close.
 */
export function resolveCompanyIndexability({ inSitemapSet }: CompanyIndexabilityInput): CompanyIndexability {
  return { inSitemap: inSitemapSet, pageIndexable: inSitemapSet };
}

/** One company the `company_directory` index carries, with the live-role
 *  count that earned it inclusion. Read straight off the published doc's
 *  `open_role_count` field — never recomputed here — so this reader can
 *  never disagree with what the publisher measured. */
export interface IndexableCompanyDomain {
  domain: string;
  openRoleCount: number;
  /** `push-company-directory.mjs`'s `new Date().toISOString()` at publish
   *  time — when this domain's role count was last measured, not when the
   *  employer's board actually changed. `null` when the doc omits it or
   *  carries something `Date.parse` can't read; `sitemap.ts` reads this as
   *  "unknown" and omits `lastModified` rather than stamping today's date. */
  computedAt: string | null;
  /** The company's own homepage name candidates, in source order (`site_names`). Absent when the doc has none. */
  siteNames?: string[];
  /** `wikidata_names` then `row_names`, deduped: spellings that may only space or case a glued domain label (`labelSpelling`), never rename a name. Absent when empty. */
  labelSpellings?: string[];
  /** `wikidata_industries`: one entry per Wikidata item whose official site is this domain, with its English industry (P452) labels. Absent when the doc has none. */
  wikidataIndustries?: WikidataItem[];
}

/** One Wikidata item matched to a domain: its English label and its industry labels (may be empty), plus each identity fact the doc carries (absent when unknown). */
export interface WikidataItem {
  label: string;
  industries: string[];
  /** Wikidata QID, e.g. "Q95". */
  id?: string;
  founded?: number;
  /** ISO 3166-1 alpha-2. */
  hqCountry?: string;
  employees?: number;
  /** Year the employee count was stated. */
  employeesAsOf?: number;
  /** CC0 description. */
  description?: string;
}

const COMPANY_DIRECTORY_INDEX = "company_directory";

/** Meilisearch's own per-request cap on `limit`; also this walk's page size,
 *  so every page short of it is legible as "the last page" without a second
 *  round trip to confirm. */
const COMPANY_DIRECTORY_PAGE_SIZE = 1000;

/** A finite number, or null — same guard as `market-stats.ts`'s `num()`:
 *  `Number(null)` is `0` and IS finite, so a bare `isFinite` check would
 *  turn a missing `open_role_count` into a false zero-but-valid count. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A parseable ISO-8601 date string, or null. Same nullable shape as
 *  `market-stats.ts`'s `sourceComputedAt` — this is NOT a gate field like
 *  `domain`/`openRoleCount`: a company with no (or malformed) `computed_at`
 *  is still indexable, it's just a page `sitemap.ts` can't date, so it omits
 *  `lastModified` for that one entry rather than guessing. */
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

/** The string entries of a doc field, cleaned of invisible format characters (the one read of `site_names`, `wikidata_names`, `row_names`), or null when it is not an array. */
const stringsOf = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((n): n is string => typeof n === "string").map(stripFormatChars).filter(Boolean) : null;

/** The well-formed `wikidata_industries` entries of a doc field (a labelled item with string industries), or [] when it is not an array. */
const wikidataItemsOf = (v: unknown): WikidataItem[] =>
  (Array.isArray(v) ? v : []).flatMap((e: unknown) => {
    const { label, industries, id, founded, hq_country, employees, employees_as_of, description } = (e ?? {}) as Record<string, unknown>;
    const name = typeof label === "string" ? stripFormatChars(label) : "";
    if (!name || !Array.isArray(industries)) return [];
    const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined);
    const text = typeof description === "string" ? stripFormatChars(description).trim() : "";
    const item: WikidataItem = {
      label: name,
      industries: stringsOf(industries) ?? [],
      ...(typeof id === "string" && /^Q\d+$/.test(id) && { id }),
      ...(count(founded) && { founded: count(founded) }),
      ...(typeof hq_country === "string" && /^[A-Z]{2}$/.test(hq_country) && { hqCountry: hq_country }),
      ...(count(employees) && { employees: count(employees) }),
      ...(count(employees_as_of) && { employeesAsOf: count(employees_as_of) }),
      ...(text && { description: text }),
    };
    return [item];
  });

/**
 * Pure: shape one `company_directory` hit, or `null` if it can't be trusted.
 * Isolated from the fetch so a malformed doc's handling is unit-testable
 * without a network round trip — same split as `market-stats.ts`'s
 * `parseMarketStatsDoc`.
 */
export function parseCompanyDirectoryHit(hit: unknown): IndexableCompanyDomain | null {
  if (!hit || typeof hit !== "object") return null;
  const h = hit as Record<string, unknown>;
  const domain = typeof h.domain === "string" && h.domain.trim() ? h.domain : null;
  const openRoleCount = num(h.open_role_count);
  if (domain === null || openRoleCount === null) return null;
  // Only homepage `site_names` are names (whatever their source); Wikidata/row names never become one, they only respell a glued label.
  const homepageNames = stringsOf(h.site_names);
  const siteNames = homepageNames?.length ? homepageNames : null;
  const labelSpellings = [...new Set([...(stringsOf(h.wikidata_names) ?? []), ...(stringsOf(h.row_names) ?? [])])];
  const wikidataIndustries = wikidataItemsOf(h.wikidata_industries);
  return { domain, openRoleCount, computedAt: isoDate(h.computed_at), ...(siteNames && { siteNames }), ...(labelSpellings.length > 0 && { labelSpellings }), ...(wikidataIndustries.length > 0 && { wikidataIndustries }) };
}

/** One `company_directory` `/search` request body — pulled out as its own
 *  shape (rather than assembled inline) so a test can assert on exactly what
 *  was sent, e.g. that the `MIN_SITEMAP_ROLES` filter clause is really in
 *  the request and not just applied conceptually. */
interface CompanyDirectorySearchRequest {
  sort: string[];
  filter: string;
  limit: number;
  offset: number;
}

/** POST one `company_directory` search request with the search key — never
 *  the `/documents` endpoint, which the search key 403s on (verified in
 *  prod; see `market-stats.ts`'s `fetchMarketStats` for the canonical
 *  statement of this constraint). Routed through `meiliFetch`, the repo's
 *  one chokepoint for outbound read-path Meilisearch calls (timeout +
 *  bounded retry + config-error logging) rather than a bespoke `fetch` here. */
async function searchCompanyDirectoryPage(
  request: CompanyDirectorySearchRequest,
): Promise<{ hits: unknown[]; total: number }> {
  const h = host();
  if (!h) throw new Error("MEILISEARCH_HOST not set");
  const res = await meiliFetch(`${h}/indexes/${COMPANY_DIRECTORY_INDEX}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    body: JSON.stringify(request),
    // Same window `market-stats.ts` uses for /trends: `sitemap.ts` is
    // `force-dynamic` but an explicit fetch `revalidate` still populates
    // Next's Data Cache under it, so public requests share one round trip
    // per window rather than one per request.
    next: { revalidate: 1800 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Meilisearch company_directory search failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { hits?: unknown[]; estimatedTotalHits?: number };
  if (typeof body.estimatedTotalHits !== "number") throw new Error("Meilisearch company_directory search answered without estimatedTotalHits");
  return { hits: body.hits ?? [], total: body.estimatedTotalHits };
}

/**
 * Every company domain worth submitting to `/sitemap.xml`, read from the
 * `company_directory` index that `push-company-directory.mjs` (subspace
 * repo, off-app, admin key) publishes on its own schedule — see the file
 * docblock's 2026-08-13 update for why this replaced both the curated
 * "elite" list and the reverted #186 facet walk. Filters server-side on
 * `open_role_count >= MIN_SITEMAP_ROLES` (the pool the directory model
 * lists from) sorted by `open_role_count` descending, capped at {@link DIRECTORY_POOL_SIZE}.
 * When Meilisearch rejects that sort (`invalid_search_sort`: the attribute is not in
 * `sortableAttributes`, set by the publisher), falls back to paging the whole filtered set and
 * sorting in memory before slicing. Either way the pool is ranked AND complete: what was read is
 * checked against the response's own total and a short read throws.
 *
 * THROW POSTURE — deliberately the opposite of `market-stats.ts`'s
 * `fetchMarketStats`, which returns `null` on any failure so `/trends` can
 * render without that one figure. This function cannot offer that: the
 * `/co/` section of the sitemap either has candidates or it doesn't, there
 * is no partial page to render around a missing set. So:
 *
 *   - zero hits on the FIRST page throws — the publisher hasn't run yet, or
 *     the index doesn't exist. Read as "not published", never as "zero
 *     companies qualify" (see `sitemap.ts`'s FAILURE POSTURE docblock: an
 *     empty `/co/` section reads as "we removed everything").
 *   - any non-OK HTTP response throws (via `searchCompanyDirectoryPage`).
 *
 * A future reader tempted to make this match `fetchMarketStats`'s `null`
 * pattern should re-read the paragraph above first — the two functions
 * front different failure domains, not the same one written twice.
 *
 * A hit missing `domain` or carrying a non-finite `open_role_count` is
 * skipped (via `parseCompanyDirectoryHit`) rather than aborting its whole
 * page or letting `NaN`/`undefined` through; skips are counted and logged
 * once at the end, not silently dropped.
 *
 * `search` is injectable (default-parameter DI, same pattern the reverted
 * #186 used for `multiSearch`) so tests never hit the network.
 */
const SORT_REJECTED = /invalid_search_sort/;
const SITEMAP_FILTER = `open_role_count >= ${MIN_SITEMAP_ROLES}`;

function parseCompanyDirectoryPage(hits: unknown[]): { parsed: IndexableCompanyDomain[]; skipped: number } {
  const parsed: IndexableCompanyDomain[] = [];
  let skipped = 0;
  for (const hit of hits) {
    const row = parseCompanyDirectoryHit(hit);
    if (row) parsed.push(row);
    else skipped += 1;
  }
  return { parsed, skipped };
}

function capSitemapCompanies(companies: IndexableCompanyDomain[]): IndexableCompanyDomain[] {
  return companies
    .slice()
    .sort((a, b) => b.openRoleCount - a.openRoleCount || a.domain.localeCompare(b.domain))
    .slice(0, DIRECTORY_POOL_SIZE);
}

/** A pool is read in full or not at all: `read` docs where the response itself reported `want`. */
function assertPoolComplete(read: number, want: number): void {
  if (read !== want) throw new Error(`company_directory pool incomplete: read ${read} of ${want} docs`);
}

function zeroHitsOnFirstPageError(): Error {
  return new Error(
    "company_directory returned zero hits on the first page — either the publisher " +
      "(push-company-directory.mjs) hasn't run yet, or no company clears MIN_SITEMAP_ROLES. " +
      "Not treating this as 'zero indexable companies' — see fetchIndexableCompanyDomains's docblock.",
  );
}

async function fetchSitemapCompaniesSorted(
  search: typeof searchCompanyDirectoryPage,
): Promise<IndexableCompanyDomain[]> {
  const { hits, total } = await search({
    sort: ["open_role_count:desc"],
    filter: SITEMAP_FILTER,
    limit: DIRECTORY_POOL_SIZE,
    offset: 0,
  });
  if (hits.length === 0) throw zeroHitsOnFirstPageError();
  assertPoolComplete(hits.length, Math.min(total, DIRECTORY_POOL_SIZE));
  const { parsed, skipped } = parseCompanyDirectoryPage(hits);
  if (skipped > 0) {
    console.warn(`fetchIndexableCompanyDomains: skipped ${skipped} malformed company_directory hit(s)`);
  }
  return parsed;
}

async function fetchSitemapCompaniesPaged(
  search: typeof searchCompanyDirectoryPage,
): Promise<IndexableCompanyDomain[]> {
  const indexable: IndexableCompanyDomain[] = [];
  let skipped = 0;
  let read = 0;
  let total = 0;
  for (let offset = 0; ; offset += COMPANY_DIRECTORY_PAGE_SIZE) {
    const page = await search({
      sort: ["domain:asc"],
      filter: SITEMAP_FILTER,
      limit: COMPANY_DIRECTORY_PAGE_SIZE,
      offset,
    });
    if (offset === 0) total = page.total;
    if (page.hits.length === 0) {
      if (offset === 0) throw zeroHitsOnFirstPageError();
      break;
    }
    const parsedPage = parseCompanyDirectoryPage(page.hits);
    indexable.push(...parsedPage.parsed);
    skipped += parsedPage.skipped;
    read += page.hits.length;
    if (page.hits.length < COMPANY_DIRECTORY_PAGE_SIZE) break;
  }
  assertPoolComplete(read, total);
  if (skipped > 0) {
    console.warn(`fetchIndexableCompanyDomains: skipped ${skipped} malformed company_directory hit(s)`);
  }
  return capSitemapCompanies(indexable);
}

export async function fetchIndexableCompanyDomains(
  search: typeof searchCompanyDirectoryPage = searchCompanyDirectoryPage,
): Promise<IndexableCompanyDomain[]> {
  if (!hasMeilisearch()) {
    throw new Error("MEILISEARCH_HOST is not set — cannot discover which company pages have content.");
  }
  try {
    return await fetchSitemapCompaniesSorted(search);
  } catch (error) {
    if (!SORT_REJECTED.test(error instanceof Error ? error.message : String(error))) throw error;
    return fetchSitemapCompaniesPaged(search);
  }
}
