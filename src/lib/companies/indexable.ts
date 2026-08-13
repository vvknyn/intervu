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
 * The rule is deliberately data-driven and has no company list in it: a page
 * is indexable when it carries content a search result can actually rank on.
 * Two independent sources of that content exist on this page —
 *
 *   1. the open-roles list (title, location, salary, seniority, ghost signal
 *      per role), and
 *   2. the employer track record (`opened90d`/`closed90d`) — the numbers that
 *      make this page something other than a roles list.
 *
 * — so either one alone earns indexation. (2) can only ever UPGRADE a page,
 * never be a precondition: it is structurally absent right now (the Meili
 * documents carry no `company_*` aggregate fields at all, so `hasTrackRecord`
 * is false for every employer today), and requiring it would noindex all 442
 * pages and empty the `/co/` section of the sitemap — the exact
 * "we removed everything" signal this change exists to avoid. Written as an
 * OR, this gate widens on its own the moment that sync lands, no code change.
 *
 * UPDATE 2026-08-13: `sitemap.ts` no longer sources its candidate set from
 * the curated "elite" board (`getBoardDomains("elite")`) — that list is 442
 * domains a human curated for the board UI, and `/co/[slug]` was never
 * actually keyed to it. `get-company.ts` renders a page for ANY domain-shaped
 * slug with at least one live role (`boards.length === 0` does not 404 it),
 * and this gate's own robots decision (`buildCompanyPageMetadata`) already
 * runs per-page for every one of those, elite or not. A sitemap keyed only to
 * the curated list was under-listing every real, indexable page outside it.
 * `fetchIndexableCompanyDomains` below discovers the full candidate set from
 * the corpus itself instead of from that list.
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
import { LIVE_VACANCY_FILTER, hasMeilisearch, meiliMultiSearch } from "@/lib/jobs/meilisearch";
import type { CompanyPageData } from "./types";

/**
 * How many live roles a page needs before it stops being thin.
 *
 * Three. Each individual role is already fully represented by its OWN
 * canonical `/jobs/<slug>-<uuid>` page, so a company page wrapping one or two
 * of those links adds nothing original and competes with them for the same
 * query — it starts saying something only its own URL can say (this
 * employer's roles as a SET) once there are several. Measured against the
 * live index 2026-08-11, the cost of 3 over 1 is small and the corpus is
 * nowhere near it: 263 of 442 domains pass at >=3 vs 310 at >=1, against a
 * median of 6 live roles and a mean of 48. The 47 pages that difference
 * covers are one- and two-role pages; they stay reachable and crawlable via
 * `/jobs`, they are just not submitted as destinations.
 */
export const MIN_INDEXABLE_ROLES = 3;

/**
 * The minimum a caller must know to apply the rule. Narrower than
 * `CompanyPageData` on purpose: `sitemap.ts` decides this for ~442 domains in
 * one batched aggregation query and never materializes a full page payload
 * (nor could it — an aggregation response carries counts, not job hits).
 * Both callers therefore run the SAME predicate instead of the sitemap
 * reimplementing a lookalike threshold that could drift from the page's.
 */
export interface CompanyIndexSignals {
  /** Live roles the page will actually render. Never a claimed aggregate —
   *  see `isCompanyIndexable` on why this is `jobs.length`. */
  openRoleCount: number;
  /**
   * Whether the employer track-record KPIs resolved to real numbers.
   * OMITTED means "this caller cannot observe it" — never pass `false` to
   * stand in for unobserved. Absent and `false` both fail to open the gate on
   * their own, but only one of them is a claim.
   */
  hasTrackRecord?: boolean;
}

/** The rule itself. Pure, so both callers and the tests share one copy. */
export function hasIndexableCompanyContent(signals: CompanyIndexSignals): boolean {
  if (signals.hasTrackRecord === true) return true;
  return signals.openRoleCount >= MIN_INDEXABLE_ROLES;
}

/**
 * `CompanyPageData`-facing form — what `/co/[slug]`'s `generateMetadata`
 * calls.
 *
 * Counts `jobs.length`, NOT `openCount`. `openCount` prefers the indexed
 * `company_open_count` aggregate, which can claim roles the page does not
 * render (a stale aggregate against an empty hit list) — and the question
 * this gate answers is "is there content on the page", which only the
 * rendered roles can answer. `openCount` being a lower bound
 * (`openCountIsLowerBound`) is a display concern, not an indexation one.
 */
export function isCompanyIndexable(data: CompanyPageData): boolean {
  return hasIndexableCompanyContent({
    openRoleCount: data.jobs.length,
    hasTrackRecord: data.hasTrackRecord,
  });
}

/** One domain the discovery walk below found indexable, with the live-role
 *  count that earned it — read from the `company_domain` facet distribution,
 *  never from the `company_open_count` aggregate, which (per `isCompanyIndexable`
 *  above) can claim roles the page itself never renders. */
export interface IndexableCompanyDomain {
  domain: string;
  openRoleCount: number;
}

/**
 * Every company domain in the live index with enough open roles to earn a
 * `/co/[slug]` page — discovered from the corpus itself rather than sourced
 * from `getBoardDomains("elite")` (see the file docblock's 2026-08-13
 * update). Bounded to a `filter`+`facets` aggregation, same request shape
 * `sitemap.ts` always used, so this needs nothing beyond the search-only key
 * the app already runs with — there is no admin "list all documents"
 * shortcut available here.
 *
 * `company_domain`'s facet distribution is capped per query at whatever
 * `maxValuesPerFacet` the live index currently has (300 today via
 * `JOBS_INDEX_SETTINGS`, but — as that setting's own comment notes — a
 * re-provision can silently drop it back to Meilisearch's default of 100).
 * One query therefore only ever surfaces the TOP slice of domains by count,
 * never the whole distribution. This walks past that cap: each round asks
 * for the distribution again with every domain collected so far excluded via
 * `company_domain NOT IN [...]`, so the next round can only return domains
 * not yet seen. A round returning nothing means nothing is left to see.
 *
 * Deliberately does NOT stop early on the first round containing a
 * sub-threshold count. Meilisearch returns facet values sorted by count only
 * because `JOBS_INDEX_SETTINGS.faceting.sortFacetValuesBy` says so — an
 * INDEX setting, not something this request controls — so an early exit that
 * trusted "sorted descending" would go silently wrong the moment that
 * setting reverts to Meilisearch's alphabetical default. Every entry in
 * every round is checked against the gate independently instead.
 *
 * THROWS on a Meilisearch failure (via `meiliMultiSearch`, unchanged) or on
 * exceeding `MAX_DOMAIN_DISCOVERY_ROUNDS` without the distribution
 * exhausting — same posture the retired `fetchLiveRoleCountsByDomain` had:
 * a walk that did not finish must never be reported as having seen
 * everything. `multiSearch` is injectable for tests; production callers use
 * the default.
 */
export const MAX_DOMAIN_DISCOVERY_ROUNDS = 250;

/** Pure: the `filter` clause for one discovery round, given every domain
 *  already collected. Isolated from the round trip so the pagination
 *  boundary (first round vs. every round after) is testable without a
 *  network call. */
export function buildDomainDiscoveryFilter(excludedDomains: readonly string[]): string[] {
  const filter = [LIVE_VACANCY_FILTER];
  if (excludedDomains.length > 0) {
    filter.push(`company_domain NOT IN [${excludedDomains.map((d) => JSON.stringify(d)).join(", ")}]`);
  }
  return filter;
}

/** Pure: what one round's raw `company_domain` facet distribution means —
 *  which of its domains clear the gate, and whether the distribution is now
 *  exhausted (an empty round). Isolated from `meiliMultiSearch` so the gate
 *  application and the exhaustion signal are both testable without a
 *  network call. */
export function processDomainDiscoveryRound(
  facetDistribution: Record<string, number>,
): { indexable: IndexableCompanyDomain[]; exhausted: boolean } {
  const entries = Object.entries(facetDistribution);
  return {
    indexable: entries
      .filter(([, count]) => hasIndexableCompanyContent({ openRoleCount: count }))
      .map(([domain, count]) => ({ domain, openRoleCount: count })),
    exhausted: entries.length === 0,
  };
}

export async function fetchIndexableCompanyDomains(
  multiSearch: typeof meiliMultiSearch = meiliMultiSearch,
): Promise<IndexableCompanyDomain[]> {
  if (!hasMeilisearch()) {
    throw new Error("MEILISEARCH_HOST is not set — cannot discover which company pages have content.");
  }
  const seen = new Set<string>();
  const indexable: IndexableCompanyDomain[] = [];
  for (let round = 0; round < MAX_DOMAIN_DISCOVERY_ROUNDS; round++) {
    const [result] = await multiSearch([
      { filter: buildDomainDiscoveryFilter([...seen]), facets: ["company_domain"] },
    ]);
    const facetDistribution = result.facetDistribution?.company_domain ?? {};
    const outcome = processDomainDiscoveryRound(facetDistribution);
    if (outcome.exhausted) return indexable;
    indexable.push(...outcome.indexable);
    for (const domain of Object.keys(facetDistribution)) seen.add(domain);
  }
  throw new Error(
    `Company-domain discovery did not exhaust the corpus within ${MAX_DOMAIN_DISCOVERY_ROUNDS} rounds — ` +
      "it grew far past what that cap assumed; raise it rather than silently truncating the sitemap.",
  );
}
