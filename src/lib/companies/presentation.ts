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
import { fetchCompanyInSitemapSet } from "./directory-model";
import { resolveCompanyIndexability } from "./indexable";
import { companyBoardPath } from "./paths";
import type { CompanyPageData } from "./types";
import type { OpenCount } from "./open-count";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { robotsMetadataFor } from "@/lib/seo/indexability";
import { exhaustHiringRecord } from "./hiring-record";
import { formatSalaryAmount, isAnnualSalaryPeriod, normalizeSalaryAmount } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
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
export function openCountText(
  data: Pick<CompanyPageData, "openCount" | "openCountIsLowerBound">,
): string {
  return data.openCountIsLowerBound ? `${formatCount(data.openCount)}+` : formatCount(data.openCount);
}

/** The same text for an {@link OpenCount} read outside a company page (directory rows, related companies). */
export const openCountLabel = (count: OpenCount): string => openCountText({ openCount: count.value, openCountIsLowerBound: count.isLowerBound });

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

/** A role counts as seen live when Velai observed it alive (or ran its ghost
 *  check without flagging it) inside this window. */
const LIVE_CHECK_DAYS = 7;

/**
 * "40 seen live in the past week" — the honest partner to the headline count.
 *
 * The headline counts every open role, flagged ones included (get-company.ts
 * searches with `hideGhosts: false`, so the count matches the "View all"
 * link). On its own that read as "all 43 are live" while the rail told
 * followers some may no longer be. Printing how many were recently seen
 * alive states both in one line.
 *
 * Same census gate as `buildFreshnessFact`: a count over a 200-role sample
 * printed beside a company-wide total would read as a company-wide figure.
 * Empty string when there is nothing honest to say (sample only, or nothing
 * seen live recently — a zero here would read as "all dead", which the data
 * does not show either).
 */
function buildLiveCheckFact(
  data: Pick<CompanyPageData, "jobs" | "openCount" | "openCountIsLowerBound">,
  nowMs: number,
): string {
  if (data.jobs.length === 0 || !sampleCoversAllRoles(data)) return "";
  const cutoff = nowMs - LIVE_CHECK_DAYS * MS_PER_DAY;
  const seen = data.jobs.filter((j) => {
    if (j.ghost_badge === "likely_ghost") return false;
    const at = Date.parse(j.last_observed_alive_at || j.ghost_checked_at || "");
    return !Number.isNaN(at) && at >= cutoff;
  }).length;
  if (seen === 0) return "";
  if (seen === data.jobs.length) return "all seen live in the past week";
  return `${formatCount(seen)} seen live in the past week`;
}

export type CompanyHiringAnswer = {
  /** At least one live role — the page uses it for the live indicator only;
   *  the words are already decided below. */
  hasOpenRoles: boolean;
  /** The direct answer to "Is X hiring?", as one sentence. Rendered verbatim
   *  on the page AND handed to the FAQPage structured data, so the machine
   *  answer and the human answer cannot drift apart. */
  headline: string;
  /** See `buildLiveCheckFact`. The page prints it after the headline, so the
   *  count of every open role sits beside how many were recently seen live. */
  liveCheck: string;
  /** The opened/closed record from `IntegrityFacts`; null when those are
   *  unavailable. No other source states it. */
  trackRecord: string | null;
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
 * combination: the open-role count is always known, the opened/closed record
 * only when `IntegrityFacts` loaded. The verdict rests on the count alone, and
 * `trackRecord` is null rather than a stand-in when the record is missing.
 *
 * `nowMs` is threaded by the caller (same convention as `searchResultLine`,
 * lib/jobs/presentation.ts) rather than read internally via `Date.now()`, so
 * `freshness` (see `buildFreshnessFact`) is assertable without a fake timer.
 */
export function buildCompanyHiringAnswer(
  data: Pick<
    CompanyPageData,
    "openCount" | "openCountIsLowerBound" | "jobs"
  > &
    Partial<Pick<CompanyPageData, "exhaust">>,
  nowMs: number,
): CompanyHiringAnswer {
  const hasOpenRoles = data.openCount > 0;
  const roles = data.openCount === 1 ? "open role" : "open roles";
  // The box database's record (job_listings) is the only source of the
  // opened/closed record, the one the integrity band and "Hiring now" print.
  return {
    hasOpenRoles,
    // No "No" on the empty branch: the page knows what Velai tracks, not
    // whether the employer is hiring somewhere it can't see. It reports the
    // former and lets the reader draw the latter. No "Yes —" on the other:
    // the count is the answer (rulebook 2026-09, GROUP-D: dash-free).
    headline: hasOpenRoles
      ? `${openCountText(data)} ${roles} live on Velai right now`
      : "Velai isn't tracking any live open roles right now",
    liveCheck: buildLiveCheckFact(data, nowMs),
    trackRecord: exhaustHiringRecord(data.exhaust, nowMs),
  };
}

/** One figure in the company page's stat row, drawn with `KpiStat`. */
export interface CompanyRoleStat {
  key: string;
  value: string;
  label: string;
}

/** Fewest yearly salaries in one currency before a "typical pay" range says
 *  anything about the employer rather than about two postings. */
const TYPICAL_PAY_MIN_ROLES = 3;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * "USD 120k–170k/yr": the middle half of the yearly pay the roles list, in
 * the currency most of them use, formatted like each row's own pay text
 * (`salaryText`). Hourly and monthly figures are left out rather than
 * converted, since a conversion would assume hours nobody stated.
 */
export function typicalPayText(jobs: PublicJob[]): string | null {
  const byCurrency = new Map<string, number[]>();
  for (const j of jobs) {
    if (!isAnnualSalaryPeriod(j.salary_period) || !j.salary_currency) continue;
    const lo = j.salary_min ?? j.salary_max;
    const hi = j.salary_max ?? j.salary_min;
    if (lo == null || hi == null) continue;
    const mid = (normalizeSalaryAmount(lo, j.salary_period) + normalizeSalaryAmount(hi, j.salary_period)) / 2;
    const list = byCurrency.get(j.salary_currency) ?? [];
    list.push(mid);
    byCurrency.set(j.salary_currency, list);
  }
  const [currency, mids] = [...byCurrency.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!currency || !mids || mids.length < TYPICAL_PAY_MIN_ROLES) return null;
  mids.sort((a, b) => a - b);
  const lo = formatSalaryAmount(Math.round(quantile(mids, 0.25)));
  const hi = formatSalaryAmount(Math.round(quantile(mids, 0.75)));
  return lo === hi ? `${currency} ${lo}/yr` : `${currency} ${lo}–${hi}/yr`;
}

/** Real page data only — degrades to a generic line when there are zero open
 *  roles rather than fabricating a count, and says "at least" rather than
 *  stating a floor as a total. */
export function companyMetaDescription(data: CompanyPageData): string {
  if (data.openCount > 0) {
    const roles = data.openCount === 1 ? "role" : "roles";
    const count = data.openCountIsLowerBound ? `at least ${formatCount(data.openCount)}` : formatCount(data.openCount);
    return `${data.name} has ${count} live, verified open ${roles} tracked on Velai, screened for ${GHOST_JOB_TERM} risk.`;
  }
  return `Track live verified job postings and ${GHOST_JOB_TERM} risk signals for ${data.name} on Velai.`;
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
 * The robots decision is `resolveCompanyIndexability` — the one rule
 * (indexable ⇔ in the sitemap set, see indexable.ts) — fed the set membership `sitemap.ts` itself uses.
 * `fetchInSitemapSet` is injectable (same DI convention as
 * `fetchCompanyInSitemapSet` itself) so unit tests never hit the network.
 */
export async function buildCompanyPageMetadata(
  data: CompanyPageData,
  fetchInSitemapSet: typeof fetchCompanyInSitemapSet = fetchCompanyInSitemapSet,
): Promise<Metadata> {
  const title = `Is ${data.name} hiring? Live verified jobs & ${GHOST_JOB_TERM} risk`;
  const description = companyMetaDescription(data);
  const indexability = resolveCompanyIndexability({ inSitemapSet: await fetchInSitemapSet(data.domain) });
  const path = companyBoardPath(data.domain);
  return {
    description,
    ...canonicalMetadata(path, title, description),
    ...robotsMetadataFor(path, undefined, indexability),
  };
}

/**
 * The "N of M ..." caption beside the "Open roles" heading. `windowSize` is the loaded role count
 * when it is only a slice of the employer (`!sampleCoversAllRoles`), else null: a query then only
 * covered those roles, and the caption says so rather than implying a full search.
 */
export function roleCountLabel(a: {
  displayed: number;
  matched: number;
  hasQuery: boolean;
  openCountLabel: string;
  windowSize: number | null;
}): string {
  if (!a.hasQuery) return `${formatCount(a.displayed)} of ${a.openCountLabel} shown`;
  if (a.windowSize != null) {
    return `${formatCount(a.matched)} of the ${formatCount(a.windowSize)} roles listed here ${a.matched === 1 ? "matches" : "match"}`;
  }
  if (a.displayed === a.matched) return `${formatCount(a.matched)} match${a.matched === 1 ? "" : "es"}`;
  return `${formatCount(a.displayed)} of ${formatCount(a.matched)} matches shown`;
}

/** The expand button names its increment ("Show 186 more roles"), never "all": the list is a window. */
export const showMoreLabel = (hidden: number): string => `Show ${formatCount(hidden)} more role${hidden === 1 ? "" : "s"}`;
