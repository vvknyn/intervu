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
 * The two counts `resolveCompanyIndexability` needs — one per surface,
 * sampled at different times BY DESIGN rather than by accident:
 *
 *   - `snapshotRoleCount`: the `company_directory` publisher's last measured
 *     `open_role_count` for this domain — what `sitemap.ts` already reads for
 *     every candidate, and what the page path fetches fresh per request via
 *     `fetchCompanySnapshotRoleCount`. `null` means "no directory doc" (not
 *     yet published, or a lookup failure — see that function's fail-soft
 *     doc), never a claimed zero.
 *   - `liveRoleCount`: `jobs.length` at request time — the roles the page is
 *     actually about to render. Never `openCount`, which can claim roles the
 *     page doesn't render (a stale aggregate against an empty hit list).
 */
export interface CompanyIndexabilityInput {
  snapshotRoleCount: number | null;
  liveRoleCount: number;
}

export interface CompanyIndexability {
  /** Should this domain be a `/sitemap.xml` `/co/` entry? Mirrors the
   *  sitemap's own Meili filter exactly — same threshold, same input. */
  inSitemap: boolean;
  /** Should THIS request's page render indexable (no `noindex`)? */
  pageIndexable: boolean;
}

function qualifies(n: number | null): boolean {
  return n != null && n >= MIN_INDEXABLE_ROLES;
}

/**
 * THE seam. Both `sitemap.ts` (via `fetchIndexableCompanyDomains`'s Meili
 * filter, built from this same `MIN_INDEXABLE_ROLES`) and `/co/[slug]`'s
 * robots decision (`presentation.ts`'s `buildCompanyPageMetadata`) derive
 * their booleans from this one function instead of running independent
 * threshold checks against independent data sources sampled at independent
 * times — which is what let a company dip below the threshold live while
 * staying sitemap-submitted off a stale snapshot: the recurring GSC
 * "Submitted URL marked noindex" class this seam exists to close.
 *
 * `pageIndexable` ORs `liveRoleCount` on top of `snapshotRoleCount`, so a
 * page is indexable exactly when it's AHEAD of the sitemap (a rising company
 * not yet snapshotted — absence from the sitemap is never an error) or
 * BEHIND it by design (a listed company dipping live stays indexable until
 * the next publisher run demotes it). `inSitemap ⇒ pageIndexable` therefore
 * holds for every input by construction, not by two call sites agreeing to
 * keep it that way.
 */
export function resolveCompanyIndexability({
  snapshotRoleCount,
  liveRoleCount,
}: CompanyIndexabilityInput): CompanyIndexability {
  const inSitemap = qualifies(snapshotRoleCount);
  return { inSitemap, pageIndexable: inSitemap || qualifies(liveRoleCount) };
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
  return { domain, openRoleCount, computedAt: isoDate(h.computed_at) };
}

/** One `company_directory` `/search` request body — pulled out as its own
 *  shape (rather than assembled inline) so a test can assert on exactly what
 *  was sent, e.g. that the `MIN_INDEXABLE_ROLES` filter clause is really in
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
): Promise<{ hits: unknown[] }> {
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
  const body = (await res.json()) as { hits?: unknown[] };
  return { hits: body.hits ?? [] };
}

/**
 * Every company domain worth submitting to `/sitemap.xml`, read from the
 * `company_directory` index that `push-company-directory.mjs` (subspace
 * repo, off-app, admin key) publishes on its own schedule — see the file
 * docblock's 2026-08-13 update for why this replaced both the curated
 * "elite" list and the reverted #186 facet walk. Filters server-side on
 * `open_role_count >= MIN_INDEXABLE_ROLES` (this file's single copy of that
 * threshold — never reimplemented here as a second gate to drift from it)
 * and pages by `offset` until a page comes back short of
 * `COMPANY_DIRECTORY_PAGE_SIZE`, i.e. the last page.
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
export async function fetchIndexableCompanyDomains(
  search: typeof searchCompanyDirectoryPage = searchCompanyDirectoryPage,
): Promise<IndexableCompanyDomain[]> {
  if (!hasMeilisearch()) {
    throw new Error("MEILISEARCH_HOST is not set — cannot discover which company pages have content.");
  }
  const indexable: IndexableCompanyDomain[] = [];
  let skipped = 0;
  for (let offset = 0; ; offset += COMPANY_DIRECTORY_PAGE_SIZE) {
    const { hits } = await search({
      sort: ["domain:asc"],
      filter: `open_role_count >= ${MIN_INDEXABLE_ROLES}`,
      limit: COMPANY_DIRECTORY_PAGE_SIZE,
      offset,
    });
    if (hits.length === 0) {
      if (offset === 0) {
        throw new Error(
          "company_directory returned zero hits on the first page — either the publisher " +
            "(push-company-directory.mjs) hasn't run yet, or no company clears MIN_INDEXABLE_ROLES. " +
            "Not treating this as 'zero indexable companies' — see fetchIndexableCompanyDomains's docblock.",
        );
      }
      break;
    }
    for (const hit of hits) {
      const parsed = parseCompanyDirectoryHit(hit);
      if (parsed) indexable.push(parsed);
      else skipped += 1;
    }
    if (hits.length < COMPANY_DIRECTORY_PAGE_SIZE) break;
  }
  if (skipped > 0) {
    console.warn(`fetchIndexableCompanyDomains: skipped ${skipped} malformed company_directory hit(s)`);
  }
  return indexable;
}

/**
 * The single `company_directory` doc for one domain — the same snapshot
 * `fetchIndexableCompanyDomains` pages in full for the sitemap, looked up
 * here by the key those docs carry (`domain`) instead of walked. Feeds
 * `resolveCompanyIndexability`'s `snapshotRoleCount` from the page path, so
 * a page's robots decision reads the exact measurement the sitemap did
 * rather than falling back to a live count the snapshot has never seen.
 *
 * Fail-soft, unlike `fetchIndexableCompanyDomains` — this runs inline in a
 * page request, not a batch job with a FAILURE POSTURE to defend, and the
 * caller already has `liveRoleCount` to fall back on:
 *
 *   - Meilisearch not configured, or the domain has no directory doc: `null`,
 *     no warning — both are "not in the snapshot," which is correct input to
 *     `resolveCompanyIndexability`, not an error.
 *   - the Meilisearch request itself fails: `null` plus ONE `console.warn` —
 *     degrade to a live-only decision rather than 500ing a page render or
 *     fabricating a count.
 *
 * `search` is injectable (same DI as `fetchIndexableCompanyDomains`) so tests
 * never hit the network.
 */
export async function fetchCompanySnapshotRoleCount(
  domain: string,
  search: typeof searchCompanyDirectoryPage = searchCompanyDirectoryPage,
): Promise<number | null> {
  if (!hasMeilisearch()) return null;
  try {
    const { hits } = await search({
      sort: [],
      filter: `domain = ${JSON.stringify(domain)}`,
      limit: 1,
      offset: 0,
    });
    const parsed = hits[0] ? parseCompanyDirectoryHit(hits[0]) : null;
    return parsed ? parsed.openRoleCount : null;
  } catch (err) {
    console.warn(`fetchCompanySnapshotRoleCount(${domain}): company_directory lookup failed`, err);
    return null;
  }
}
