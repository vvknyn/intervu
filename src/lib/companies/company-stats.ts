/**
 * Data composer for `/companies/[slug]` — the per-company truth page (live
 * roles + posting freshness + ghost mix, all from scraped data). Mirrors
 * `market-trends.ts`'s role for `/trends`: this module owns which
 * Meilisearch call the page needs and how to shape the response; the page
 * itself only renders what comes back.
 *
 * `market-trends.ts` batches independent facet queries through
 * `meiliMultiSearch` because every one of ITS queries is a global filter —
 * that endpoint forces `q: ""` on every query in the batch, and `company`
 * (the display name this page is keyed on, per `lib/companies/paths.ts`) is
 * not in `filterableAttributes` (see meilisearch.ts's `JOBS_INDEX_SETTINGS`)
 * — only `company_domain` is, which `/co/[slug]` uses instead. So a
 * per-company query here can't be a filter clause at all; it has to be a
 * free-text search, which rules out `meiliMultiSearch` for this page
 * entirely (aggregation-only, no `q`, no hits).
 *
 * Instead: ONE `searchMeili` call searches the company name as free text and
 * fetches actual hits (not just facet counts), then exact-match post-filters
 * those hits down to this company — the same post-filter idiom
 * `filterHitsByDomainFilters` already uses in meilisearch.ts for a field
 * that isn't index-filterable. The ghost mix and freshness buckets are then
 * derived from that SAME hit set in-app, so the whole page still costs one
 * Meilisearch round trip, not one per section.
 */
import {
  classifyPostingAgeBucket,
  FRESHNESS_BUCKETS,
  type FreshnessBucket,
} from "@/lib/jobs/posting-age-buckets";
import { decodeText } from "@/lib/jobs/presentation";
import { isBuildPhase } from "@/lib/next-phase";
import { hasMeilisearch, searchMeili } from "@/lib/jobs/meilisearch";
import type { GhostBadge, PublicJob } from "@/lib/jobs/types";

/** Hit window the free-text company search draws from — matches `/co/[slug]`'s
 *  `getCompanyPageData` (lib/companies/get-company.ts), which fetches the same
 *  200-hit window for the same reason: individual companies practically never
 *  carry more live postings than this, and neither page claims an uncapped
 *  total off it (this page uses `company_open_count`, the ingest-side
 *  aggregate, for the headline total — see `totalOpenRoles` below). */
const COMPANY_ROLES_FETCH_LIMIT = 200;
/** How many role rows the page itself renders. */
export const COMPANY_ROLES_DISPLAY_LIMIT = 20;

/** Display order for the ghost mix band — mirrors `market-trends.ts`'s
 *  (module-private) `GHOST_BADGES`, kept in sync by hand since that ordering
 *  isn't exported. */
const GHOST_BADGES: readonly GhostBadge[] = ["clear", "caution", "likely_ghost", "unscored"];

export interface CompanyProfile {
  /** Corpus casing of the name (from the matched jobs), not necessarily
   *  byte-identical to the input string the page was requested with. */
  name: string;
  /** Most-common `company_domain` across the matched hits, or `null` when
   *  none carry one — see `dominantCompanyDomain`. Drives the redirect onto
   *  the canonical domain-keyed `/co/[slug]` page in `page.tsx` (P1C
   *  consolidation, 2026-08-01): this name-keyed page only renders
   *  standalone when a company has no known domain. */
  domain: string | null;
  /** Up to `COMPANY_ROLES_DISPLAY_LIMIT` live postings for this company. */
  roles: PublicJob[];
  /** Ingest-side aggregate when available (see `PublicJob.company_open_count`),
   *  falling back to the count of matched hits — same fallback
   *  `getCompanyPageData`'s `openCount` uses. */
  totalOpenRoles: number;
  ghostMix: { badge: GhostBadge; count: number }[];
  freshness: { bucket: FreshnessBucket; count: number }[];
}


/** Case/decoding-insensitive company-name key, for matching a search hit's
 *  `company` field back to the name this page was requested for. */
function normalizedCompanyKey(s: string): string {
  return decodeText(s).trim().toLowerCase();
}

/**
 * Fetch and assemble everything `/companies/[slug]` renders for one company.
 * Returns `null` when Meilisearch isn't configured (mirrors `hasMeilisearch`'s
 * use elsewhere) or when the search throws during the build prerender (no
 * stale ISR copy exists yet). At runtime any other failure still throws, so a
 * failed ISR revalidation falls back to Next's stale-while-error behavior
 * rather than the page quietly rendering fabricated zeros.
 *
 * A company with zero matching postings is NOT a `null` result — it's a
 * valid `CompanyProfile` with empty `roles`/`ghostMix`/`freshness`, which the
 * page renders as an honest "haven't verified enough" state rather than a 404
 * (the company itself isn't invalid, we just have no live data on it).
 */
export async function fetchCompanyProfile(company: string): Promise<CompanyProfile | null> {
  if (!hasMeilisearch()) return null;
  const target = normalizedCompanyKey(company);
  if (!target) return null;

  let result;
  try {
    result = await searchMeili({ q: company.trim(), limit: COMPANY_ROLES_FETCH_LIMIT, hideGhosts: false });
  } catch (err) {
    if (isBuildPhase()) return null;
    throw err;
  }

  const matched = result.hits.filter((job) => normalizedCompanyKey(job.company ?? "") === target);
  if (matched.length === 0) {
    return { name: company.trim(), domain: null, roles: [], totalOpenRoles: 0, ghostMix: [], freshness: [] };
  }

  return {
    name: decodeText(matched[0]!.company) || company.trim(),
    domain: dominantCompanyDomain(matched),
    roles: matched.slice(0, COMPANY_ROLES_DISPLAY_LIMIT),
    ...deriveCompanyStats(matched),
  };
}

/**
 * Most-common non-empty `company_domain` across a company's matched hits —
 * the signal `page.tsx` uses to decide whether this name-keyed page should
 * redirect onto the canonical `/co/[slug]` (domain-keyed) page instead of
 * rendering standalone. Domains are trim+lowercase normalized before
 * tallying — the same normalization `domainToSlug` (boards/slug.ts) applies
 * — so hits differing only in casing/whitespace count as one domain. Ties
 * resolve to whichever domain is encountered first in `jobs`; deterministic,
 * not meaningful beyond that (one company practically never carries two
 * competing domains).
 */
export function dominantCompanyDomain(jobs: PublicJob[]): string | null {
  const tally = new Map<string, number>();
  for (const job of jobs) {
    const domain = job.company_domain?.trim().toLowerCase();
    if (!domain) continue;
    tally.set(domain, (tally.get(domain) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [domain, count] of tally) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pure: fold a company's matched hits into the total/ghost-mix/freshness
 * shape the page renders. Split out from `fetchCompanyProfile` so this is
 * unit-testable without a network call — same reasoning `dedupeJobSuggestionHits`
 * (meilisearch.ts) documents for its own split from its network-calling caller.
 */
export function deriveCompanyStats(
  matched: PublicJob[],
  nowMs: number = Date.now(),
): Pick<CompanyProfile, "totalOpenRoles" | "ghostMix" | "freshness"> {
  const first = matched[0];
  const totalOpenRoles =
    typeof first?.company_open_count === "number" ? first.company_open_count : matched.length;

  const ghostTally = new Map<GhostBadge, number>();
  const freshnessTally = new Map<FreshnessBucket, number>();
  for (const job of matched) {
    ghostTally.set(job.ghost_badge, (ghostTally.get(job.ghost_badge) ?? 0) + 1);
    if (job.posted_ts != null) {
      const bucket = classifyPostingAgeBucket(job.posted_ts, nowMs);
      freshnessTally.set(bucket, (freshnessTally.get(bucket) ?? 0) + 1);
    }
  }

  return {
    totalOpenRoles,
    ghostMix: GHOST_BADGES.map((badge) => ({ badge, count: ghostTally.get(badge) ?? 0 })),
    freshness: FRESHNESS_BUCKETS.map((bucket) => ({ bucket, count: freshnessTally.get(bucket) ?? 0 })),
  };
}

