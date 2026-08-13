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

/**
 * Chunk size for the domain facet batch below.
 *
 * 100 because that is Meilisearch's DEFAULT `maxValuesPerFacet`. This repo's
 * `JOBS_INDEX_SETTINGS` raises it to 300, but that setting lives on the index,
 * not in this repo (a re-provision can drop it — the same caveat
 * `filterableAttributes` carries in meilisearch.ts). Asking for at most 100
 * facet values per query means a silently-unraised index cannot truncate the
 * distribution: a truncated facet response is indistinguishable from
 * "these domains have zero live roles", which would quietly drop real,
 * content-carrying pages out of the sitemap. Sized so truncation is
 * impossible rather than detected after the fact.
 */
const DOMAIN_FACET_CHUNK = 100;

/**
 * Live role count per domain, for every domain passed in — the batched
 * counterpart to `getCompanyPageData`'s per-company search.
 *
 * One `/multi-search` round trip (5 aggregation queries for today's 442
 * domains), not 442 sequential searches. Filters on `LIVE_VACANCY_FILTER`,
 * the same baseline invariant `buildFilter` applies to every real search, so
 * "live role" means here exactly what it means on the page.
 *
 * THROWS when Meilisearch is unavailable OR unconfigured, and deliberately
 * does not degrade to zeros — see `sitemap.ts` for why a measurement failure
 * must not be allowed to look like a measurement of zero.
 *
 * Domains with no live roles are simply absent from the facet distribution;
 * the caller reads a missing domain as 0, which is what it is — the query
 * succeeded and found none.
 */
export async function fetchLiveRoleCountsByDomain(domains: string[]): Promise<Map<string, number>> {
  if (!hasMeilisearch()) {
    throw new Error("MEILISEARCH_HOST is not set — cannot measure which company pages have content.");
  }
  const normalized = domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < normalized.length; i += DOMAIN_FACET_CHUNK) {
    chunks.push(normalized.slice(i, i + DOMAIN_FACET_CHUNK));
  }

  const results = await meiliMultiSearch(
    chunks.map((chunk) => ({
      filter: [
        LIVE_VACANCY_FILTER,
        `company_domain IN [${chunk.map((d) => JSON.stringify(d)).join(", ")}]`,
      ],
      facets: ["company_domain"],
    })),
  );

  const counts = new Map<string, number>();
  for (const result of results) {
    for (const [domain, count] of Object.entries(result.facetDistribution?.company_domain ?? {})) {
      counts.set(domain, count);
    }
  }
  return counts;
}
