/**
 * How `/co/[slug]` states its own numbers and declares itself to crawlers.
 *
 * Same split `lib/jobs/presentation.ts` established for the job surfaces: the
 * page file renders, this file decides. It exists as a module rather than as
 * helpers inside `app/co/[slug]/page.tsx` because Next type-checks page files
 * against a fixed export list (`next-types-plugin` — any export that isn't
 * `default`/`generateMetadata`/a route-segment config is a build error), so a
 * helper that lives in the page file is a helper no unit test can reach.
 */
import type { Metadata } from "next";
import { fetchCompanySnapshotRoleCount, resolveCompanyIndexability } from "./indexable";
import { companyBoardPath } from "./paths";
import type { CompanyPageData } from "./types";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { rollupCountryDistribution, UNCLASSIFIED_LABEL } from "@/lib/jobs/country-classification";
import { toValueArray, type PublicJob } from "@/lib/jobs/types";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { GHOST_JOB_TERM } from "@/lib/seo/ghost-job-term";
import { formatCount } from "@/lib/format";

/**
 * The open-role count as a string, everywhere the page shows it.
 *
 * `openCount` prefers the indexed `company_open_count` aggregate and falls
 * back to what the search actually returned; `openCountIsLowerBound` marks
 * the cases where that number is a floor rather than a total. A floor
 * rendered as a bare integer claims a precision the page doesn't have, so it
 * renders as `N+`. One helper, so the KPI tile, the roles-list caption and
 * the footer CTA cannot end up disagreeing about how exact the same number is.
 */
/**
 * Does the KPI tile row have anything to show?
 *
 * All four tiles (open roles, opened/closed 90d, possibly-stale share) read
 * as a literal "0" beside three "—" placeholders when an employer has no
 * live roles and no 90-day track record — a row of dead placeholders next to
 * a real zero, not information a visitor can act on. Gates the whole row
 * rather than each tile individually, since a partial row would still make
 * the same "nothing to see" claim once the rest render blank.
 */
export function hasCompanyKpiContent(
  data: Pick<CompanyPageData, "openCount" | "hasTrackRecord">,
): boolean {
  return data.openCount > 0 || data.hasTrackRecord;
}

export function openCountText(
  data: Pick<CompanyPageData, "openCount" | "openCountIsLowerBound">,
): string {
  return data.openCountIsLowerBound ? `${formatCount(data.openCount)}+` : formatCount(data.openCount);
}

/**
 * Does the fetched role window (`jobs` — at most `COMPANY_JOBS_FETCH_LIMIT`)
 * actually cover every one of the employer's open roles, or only a sample of
 * them?
 *
 * Concern-neutral on purpose: `jobs.length` is a property of the REQUEST
 * (the fetch cap), never of the employer, so ANY per-role stat this page
 * derives from `jobs` and then presents next to the company-wide `openCount`
 * needs this same gate before it can be read as a census rather than a
 * sample — currently `ghostFlaggedPct` (the ghost-flagged share),
 * `buildFreshnessFact` (the recency fact), both below, and the in-page role
 * search's scope caveat (`CompanyRoleSearch`). One rule, all three callers;
 * a second, independently-drifting copy of it is exactly the regression this
 * function exists to prevent (see `resolveOpenCount`, open-count.ts, for the
 * same "window length is not the count" bug this mirrors). Derived from
 * numbers `CompanyPageData` already carries, so it needs no contract change.
 *
 * Both halves are required. A LOWER-BOUND `openCount` cannot be covered by
 * any window, even one holding `openCount` roles: a floor means an unknown
 * number of roles exist past it, so `200 >= 200` would assert a census over a
 * count that is itself only "at least 200". Reading a floor as a total is the
 * precise over-claim `openCountText` renders as `N+` to avoid, three lines
 * up; this gate must not quietly re-make it on the same page.
 */
export function sampleCoversAllRoles(
  data: Pick<CompanyPageData, "jobs" | "openCount" | "openCountIsLowerBound">,
): boolean {
  if (data.openCountIsLowerBound) return false;
  return data.jobs.length >= data.openCount;
}

/**
 * The CTA's `/jobs?...` URL for browsing this company's roles past the
 * preview list — built through `serializeJobsUrl`, the ONE encoder /jobs'
 * own parser (`parseJobsUrl`) agrees with, rather than a hand-built string
 * that can only ever express `q`. A hand-built `q`-only URL silently
 * inherits every /jobs default: measured live 2026-08-15, Leogy's "View all
 * 5 jobs" CTA landed on "No roles match" because /jobs' 30-day default
 * excluded all 5 of the roles this page had just counted as open.
 *
 * Scopes by DOMAIN, never by name. This page fetches its roles and its count
 * with `companyDomain` (get-company.ts); handing the CTA `q: data.name`
 * instead re-derived the employer from a display string and got a DIFFERENT
 * set back. Measured live 2026-08-16 on `/co/harrods--com`: the page counted
 * 108 roles, `q=Harrods` returned 109 of which zero in the top 20 were
 * Harrods — "Harrods" names a VENUE, so Chanel/Burberry/Saint Laurent/Hermès
 * concession roles inside the store all matched it. The near-equal totals
 * (108 vs 109) are a coincidence of two unrelated scopes, which is exactly
 * why a count agreeing is not evidence the sets agree.
 *
 * Nor could /jobs recover the intent: `isCompanyNameQuery` (company-intent.ts)
 * would have scoped the search to the `company` attribute, but it requires
 * the text to EQUAL the indexed name and deliberately refuses to strip legal
 * suffixes — the index holds "Harrods Limited" while `data.name` is the
 * suffix-stripped "Harrods" (`displayCompanyName`), so the gate saw zero
 * exact matches and failed open. That makes this a whole class, not one
 * employer: every company whose ATS publishes a legal suffix had the same
 * broken CTA, worst wherever the bare name is also a place or common word.
 *
 * `q` is therefore left EMPTY rather than kept "as a hint" alongside the
 * domain — the two would AND together and hide roles whose text happens not
 * to repeat the employer's own name.
 *
 * Targets `/jobs`, never `/`: `/`'s handler redirects here unconditionally
 * without forwarding search params (`app/page.tsx`), so a `/`-built link
 * would silently drop `q` — `/jobs`' parser is the only one that reads it.
 *
 * `postedBucket: undefined` serializes to `posted=any` (see
 * `serializeJobsUrl`): this page's own count is age-agnostic, so the link
 * must not silently reapply /jobs' default posted window on top of it.
 *
 * `hideGhosts: false` (→ `ghosts=show`) is the same rule applied to /jobs'
 * OTHER silent default. This page counts every open role it tracks and
 * separately discloses what share of them are ghost-flagged (the
 * `ghostFlaggedPct` KPI tile); /jobs hides likely-ghost rows unless asked.
 * Measured live 2026-08-16 on `/co/harrods--com`: "View all 108 jobs" landed
 * on 78 — exactly the 30 the page's own "28% ghost-flagged" tile had just
 * counted. A link whose label states a number must not hand the destination
 * a filter that removes some of it; that is the same defect as the Leogy
 * 30-day case above, in a second default. Vivek's call, 2026-08-17: show all
 * of them, and mark the flagged ones — which is why this line ships with
 * `rowTrustChip`'s `likely_ghost` split (lib/jobs/badges.ts). Unfiltering
 * without marking would be strictly worse than the gap it closes.
 *
 * Deliberately carries NO REAL `location_country` VALUE, even though the roles
 * on this page have known countries. `location_country` is `string | string[] |
 * null` per role (types.ts) with an unverified encoding/value domain, and it
 * feeds a HARD AND clause in the corpus filter (`renderPlaceClause`,
 * meilisearch.ts) — a derived value that doesn't exactly match the corpus's
 * own string degrades that filter from "no constraint" to "match nothing".
 * Measured live 2026-08-15: a facet built exactly this way for Leogy
 * (`country=Germany`/`country=DE`) returned ZERO rows, while dropping it
 * returned the correct 5. A link can only safely ADD a filter it can prove
 * matches the corpus; it can't prove that here, so it doesn't try.
 *
 * What it carries instead is the `"any"` sentinel, which is NOT a value:
 * `meilisearch.ts:452` strips "any"/"all" before rendering the clause, so no
 * country constraint reaches the corpus. Its only effect is on the OTHER
 * gate — `hasLocationSignal` (lib/geo/ip-default.ts) is satisfied by a
 * non-empty `location_country` facet, so this suppresses /jobs' IP-based geo
 * default and the link lands on the company's full result set rather than a
 * silently geo-narrowed slice of it.
 *
 * (Superseded 2026-08-17: this paragraph previously stated a link could not
 * widen a searcher's geo scope at all. That was true only while no sentinel
 * existed. The zero-result recovery affordance on /jobs is still that page's
 * job — this URL just no longer needs it for the common case.)
 */
export function buildCompanyJobsUrl(data: Pick<CompanyPageData, "domain">): string {
  return `/jobs${serializeJobsUrl({
    ...DEFAULT_URL_STATE,
    companyDomain: data.domain,
    postedBucket: undefined,
    hideGhosts: false,
    facets: { location_country: ["any"] },
  })}`;
}

const MS_PER_DAY = 86_400_000;

/**
 * ms window for /jobs' own default recency filter
 * (`DEFAULT_URL_STATE.postedBucket`, lib/jobs/url-state.ts — "90d" today).
 * Deliberately NOT read from `BUCKET_MS` (lib/jobs/meilisearch.ts): that
 * constant is module-private, and meilisearch.ts is out of this change's
 * scope to edit into an export. Parsed off `DEFAULT_URL_STATE`'s own bucket
 * key instead — every `PostedBucket` but "older" is already an "Nd" string —
 * so this tracks the real default by construction rather than adding a
 * second hardcoded day count. `null` when the default is "any" (`undefined`)
 * or "older" (not a lookback window), i.e. there is no window to report a
 * fact about.
 */
function defaultRecencyWindowMs(): number | null {
  const bucket = DEFAULT_URL_STATE.postedBucket;
  if (!bucket || bucket === "older") return null;
  const days = Number.parseInt(bucket, 10);
  return Number.isFinite(days) ? days * MS_PER_DAY : null;
}

/**
 * How many of the employer's open roles were posted inside /jobs' own
 * default recency filter — the fact that reconciles the page's "N open
 * roles, live right now" headline with /jobs' CTA target treating an
 * older-but-still-open role as too old to show by default. Stated as a fact
 * either way (all recent, none recent, or a genuine split), never as a
 * caveat or apology: a role posted outside the window is still open.
 *
 * Two things this must never do, both regressions of bugs this repo already
 * fixed once:
 *
 *  - Present a REQUEST WINDOW as the employer's role count. `data.jobs` is
 *    capped at `COMPANY_JOBS_FETCH_LIMIT` (200, get-company.ts); an employer
 *    with more open roles than that (measured live: stripe.com 582,
 *    amazon.com 18,352) would otherwise render "N of 200" as though 200
 *    were their count — exactly the `jobs.length`-as-count bug
 *    `resolveOpenCount` (open-count.ts) already exists to prevent, walked
 *    right around by a second reader of the same field. Gated on
 *    `sampleCoversAllRoles` — the SAME sample-vs-census check
 *    `ghostFlaggedPct`'s rendering already gates on, not a second,
 *    independently-drifting copy of it — when the window is only a partial
 *    sample, this returns "" (a supported, documented outcome) rather than
 *    a sentence that would need a caveat to be true.
 *  - Count an UNKNOWN posted date as evidence of age. A null `posted_ts`
 *    role goes in neither the numerator nor the denominator — this product
 *    surfaces what was observed, never fills a gap with an inference.
 *
 * INVARIANT: the denominator here always equals the open-role count the
 * page states one line above (`openCountText`), never a smaller "roles we
 * happened to have a date for." A partial known-date set is the same "do we
 * actually know enough to say this?" question as the two bullets above, not
 * a separate case — so it folds into the same gate rather than a caveated
 * sentence over a shrunken denominator (e.g. "3 of 3" for a 5-role employer
 * where 2 dates are unknown would silently disagree with the "5 open roles"
 * headline). Render only when EVERY covered role has a known `posted_ts`;
 * otherwise "".
 */
function buildFreshnessFact(
  data: Pick<CompanyPageData, "jobs" | "openCount" | "openCountIsLowerBound">,
  nowMs: number,
): string {
  const windowMs = defaultRecencyWindowMs();
  if (windowMs == null || !sampleCoversAllRoles(data)) return "";
  const jobs = data.jobs;
  if (jobs.length === 0) return "";
  const known = jobs.filter((j): j is PublicJob & { posted_ts: number } => j.posted_ts != null);
  if (known.length !== jobs.length) return "";
  const cutoff = nowMs - windowMs;
  const recent = known.filter((j) => j.posted_ts >= cutoff).length;
  const days = Math.round(windowMs / MS_PER_DAY);
  const roles = known.length === 1 ? "open role" : "open roles";
  // The zero case reads as a stilted "0 of N" when spelled out numerically —
  // "None of the N ..." is the same fact in the phrasing a person would
  // actually say. Every other split keeps the counted "N of M" form.
  if (recent === 0) {
    return `None of the ${known.length} ${roles} ${known.length === 1 ? "was" : "were"} posted in the last ${days} days.`;
  }
  return `${recent} of ${known.length} open roles were posted in the last ${days} days.`;
}

export type CompanyHiringAnswer = {
  /** At least one live role — the page uses it for the live indicator only;
   *  the words are already decided below. */
  hasOpenRoles: boolean;
  /** The direct answer to "Is X hiring?", as one sentence. Rendered verbatim
   *  on the page AND handed to the FAQPage structured data, so the machine
   *  answer and the human answer cannot drift apart. */
  headline: string;
  /** The 90-day opened/closed record when it is known, and a plain statement
   *  that it isn't when it isn't. Never phrased as a finding either way. */
  trackRecord: string;
  /** See `buildFreshnessFact`. Empty string when there is no fetched role to
   *  measure or no default window to measure against — the page renders it
   *  conditionally, same as `trackRecord`'s sibling section. */
  freshness: string;
};

/**
 * Answers the question the page's own `<title>` asks.
 *
 * `/co/[slug]` shipped titled "Is X hiring?" — the SERP headline and the whole
 * query intent — while the rendered body contained the word "hiring" zero
 * times: a visitor arriving on that promise got a name, a role count and two
 * em-dashes. This states the answer in the body, from the counts the page
 * already holds.
 *
 * It is built as ONE function over the whole answer, rather than a line the
 * page assembles, because the honesty constraint is a property of the
 * combination: the open-role count is known today, the 90-day open/close
 * record is null for every employer until the `company_*` aggregate sync
 * lands (see `CompanyPageData.hasTrackRecord`), and a sentence that reads the
 * same in both states would be claiming the missing half. So the verdict rests
 * only on the count, and `trackRecord` NAMES the gap instead of dressing two
 * nulls as a stable history. When the aggregates arrive the same code says
 * more without being edited — the branch is data-driven, not a TODO.
 *
 * `nowMs` is threaded by the caller (same convention as `searchResultLine`,
 * lib/jobs/presentation.ts) rather than read internally via `Date.now()`, so
 * `freshness` (see `buildFreshnessFact`) is assertable without a fake timer.
 */
export function buildCompanyHiringAnswer(
  data: Pick<
    CompanyPageData,
    "openCount" | "openCountIsLowerBound" | "opened90d" | "closed90d" | "hasTrackRecord" | "jobs"
  >,
  nowMs: number,
): CompanyHiringAnswer {
  const hasOpenRoles = data.openCount > 0;
  const roles = data.openCount === 1 ? "open role is" : "open roles are";
  return {
    hasOpenRoles,
    // No "No" on the empty branch: the page knows what intervu tracks, not
    // whether the employer is hiring somewhere it can't see. It reports the
    // former and lets the reader draw the latter.
    headline: hasOpenRoles
      ? `Yes — ${openCountText(data)} ${roles} live on velai right now.`
      : "velai isn't tracking any live open roles right now.",
    trackRecord: data.hasTrackRecord
      ? `Last 90 days: ${data.opened90d} roles opened, ${data.closed90d} closed.`
      : "Opened and closed counts for the last 90 days aren't tracked for this employer yet.",
    freshness: buildFreshnessFact(data, nowMs),
  };
}

/** Real page data only — degrades to a generic line when there are zero open
 *  roles rather than fabricating a count, and says "at least" rather than
 *  stating a floor as a total. */
export function companyMetaDescription(data: CompanyPageData): string {
  if (data.openCount > 0) {
    const roles = data.openCount === 1 ? "role" : "roles";
    const count = data.openCountIsLowerBound ? `at least ${data.openCount}` : String(data.openCount);
    return `${data.name} has ${count} live, verified open ${roles} tracked on velai, screened for ${GHOST_JOB_TERM} risk.`;
  }
  return `Track live verified job postings and ${GHOST_JOB_TERM} risk signals for ${data.name} on velai.`;
}

/**
 * Everything `/co/[slug]` tells a crawler about itself. Pure, so both
 * branches of the robots decision are unit-testable without a live index.
 *
 * The canonical is UNCONDITIONAL. `/co/[slug]` shipped with no `rel=canonical`
 * at all (verified on prod 2026-08-11: `/jobs/<slug>` and `/jobs` both emit
 * one, `/co/stripe--com` emitted none) while three things were true at once —
 * the site moved intervu.cc → intervuhq.com on 2026-08-08, `/companies/[slug]`
 * `redirect()`s onto this route, and the same company is reachable through
 * both. A page that declines to say which URL it is leaves that to the
 * crawler. `noindex` does not make the question moot either: a de-indexed
 * page still consolidates signals onto whatever URL it names, which is why
 * this is built before the robots decision rather than inside its `else`.
 *
 * `follow` is retained on the noindex branch on purpose — the roles list
 * links to real `/jobs/<slug>` pages that ARE indexable, and an empty company
 * page is still a legitimate path to them.
 *
 * The robots decision reads `resolveCompanyIndexability` off the SAME
 * `company_directory` snapshot `sitemap.ts` uses (`fetchCompanySnapshotRoleCount`,
 * fetched fresh per request by domain) alongside the live role count, so this
 * is async now — see that seam's doc on why a page can only ever be
 * indexable ahead of or in lockstep with the sitemap, never behind it.
 * `fetchSnapshotRoleCount` is injectable (same DI convention as
 * `fetchCompanySnapshotRoleCount` itself) so unit tests never hit the
 * network. `hasTrackRecord` stays a separate OR on top: it can upgrade a page
 * the role count alone would reject, but it isn't a threshold `sitemap.ts`
 * can see (the directory doc carries no KPIs), so it never widens
 * `inSitemap` and doesn't belong inside `resolveCompanyIndexability`.
 */
export async function buildCompanyPageMetadata(
  data: CompanyPageData,
  fetchSnapshotRoleCount: typeof fetchCompanySnapshotRoleCount = fetchCompanySnapshotRoleCount,
): Promise<Metadata> {
  const title = `Is ${data.name} hiring? Live verified jobs & ${GHOST_JOB_TERM} risk`;
  const description = companyMetaDescription(data);
  const snapshotRoleCount = await fetchSnapshotRoleCount(data.domain);
  const { pageIndexable } = resolveCompanyIndexability({
    snapshotRoleCount,
    liveRoleCount: data.jobs.length,
  });
  const indexable = pageIndexable || data.hasTrackRecord === true;
  return {
    title,
    description,
    ...canonicalMetadata(companyBoardPath(data.domain), title, description),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

/**
 * Raw `location_country` value -> doc count across `jobs`, the same shape
 * `rollupCountryDistribution` normally reads off a live Meilisearch facet
 * response (see /trends' `TopCountriesList` and the /jobs location filter,
 * both fed from a real `facetDistribution`). `/co` has no separate facet
 * call, so this builds the same shape from the page's own fetched `jobs`
 * window instead. A multi-country posting (`location_country` as an array —
 * see `PublicJob`'s own doc) increments each of its values once, the same
 * way a real facet distribution counts a multi-valued attribute. Blank
 * tokens are dropped before counting, not after.
 */
function countryDistribution(jobs: PublicJob[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    for (const raw of toValueArray(job.location_country)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      counts[trimmed] = (counts[trimmed] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * "hiring in {A}, {B}, {C} +N more" — top 3 hiring countries by role count.
 * Reuses `rollupCountryDistribution` (country-classification.ts), the SAME
 * rollup /trends' "Top Hiring Countries" table and the /jobs location filter
 * already render country names from, so this never invents a second raw-
 * value-to-display-name mapping for the same polluted field (that module's
 * own doc: raw `location_country` carries city/region/remote-sentinel junk
 * alongside real countries). The `UNCLASSIFIED_LABEL` bucket that rollup
 * produces for everything that isn't a recognized country is dropped here —
 * it is exactly that junk, not a hiring geography, so it counts toward
 * neither the shown names nor "+N more". `null` when nothing in `jobs`
 * resolved to a real country (a genuinely fully-remote employer, or a corpus
 * window with no usable location data).
 */
function hiringGeosClause(jobs: PublicJob[]): string | null {
  const countries = rollupCountryDistribution(countryDistribution(jobs)).filter(
    (row) => row.country !== UNCLASSIFIED_LABEL,
  );
  if (countries.length === 0) return null;
  const shown = countries.slice(0, 3).map((row) => row.country);
  const remaining = countries.length - shown.length;
  return `hiring in ${shown.join(", ")}${remaining > 0 ? ` +${remaining} more` : ""}`;
}

/**
 * "NN% of roles remote" — the exact `deriveWorkModeDistribution` figure the
 * retired "How they work" progress-bar card (`CompanyIntelligenceGrid`) used
 * to draw its bar from (lib/companies/enrichment.ts), read here off the
 * already-resolved `intelligence` rather than recomputed, so the hero can
 * never disagree with that computation. `null` when there's no intelligence
 * to read (no fetched jobs — `deriveWorkModeDistribution` itself returns
 * null on an empty roster).
 */
function remoteShareClause(intelligence: CompanyPageData["intelligence"]): string | null {
  const pct = intelligence?.workModes?.remotePct;
  return pct == null ? null : `${pct}% of roles remote`;
}

/** The hero's "derived facts" row: domain, where this employer is hiring,
 *  what share of roles are remote. `hiringGeos`/`remoteShare` are `null`
 *  (never a placeholder string) when the underlying clause has nothing
 *  usable behind it — the hero renders each fact as its own icon-led item
 *  and simply omits the ones that are `null`. */
export interface CompanyFacts {
  domain: string;
  hiringGeos: string | null;
  remoteShare: string | null;
}

/**
 * The hero's quiet "derived facts" under the hiring-answer sentence: domain,
 * where this employer is hiring, what share of roles are remote. `domain` is
 * the only part guaranteed to ever be there (see `CompanyPageData.domain` /
 * `getCompanyPageData`, which never returns a page with an empty one).
 */
export function buildCompanyFacts(
  data: Pick<CompanyPageData, "domain" | "jobs" | "intelligence">,
): CompanyFacts {
  return {
    domain: data.domain,
    hiringGeos: hiringGeosClause(data.jobs),
    remoteShare: remoteShareClause(data.intelligence),
  };
}
