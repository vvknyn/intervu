/**
 * The "Hiring Record" chokepoint — the ONE place `/co/[slug]` (and, later,
 * the MCP company tools) reads box-PG digital-exhaust data through.
 *
 * `getExhaustPg()` (lib/pg/pool.ts) is null whenever `EXHAUST_PG_URL` is
 * unset (every environment until it's added at deploy) — `getCompanyExhaust`
 * returns null in that case and the page renders exactly as it does today,
 * from Meili-only data. No lying fallbacks: a query error, a timeout, or a
 * missing row for one data type drops that section (`null`), it never
 * fabricates a count or a placeholder.
 *
 * Every non-trivial decision here (week bucketing, the verdict-age gate, the
 * funding/listing cell exclusivity rule, the coverage ladder) is a pure
 * function with no I/O, exported so it can be unit-tested without a
 * database.
 */
import { eventTypeLabel } from "@/lib/companies/events";
import { categoryLabel } from "@/lib/companies/machine-token";
import { siteKey } from "@/lib/companies/company-name";
import type { WikidataItem } from "@/lib/companies/indexable";
import { displayCompanyName } from "@/lib/jobs/presentation";
import { isTenantlessVendorUrl, pickBoardRoot } from "@/lib/companies/careers-board-root";
import { RECORD_WINDOW_WEEKS, isoWeekStart } from "@/lib/companies/hiring-record";
import { getExhaustPg, type Queryable } from "@/lib/pg/pool";
import { formatCount } from "@/lib/format";

export type ExhaustSection<T> = { data: T; source: string; label: string; asOf: string } | null;

export interface CompanyProfile {
  tagline: string | null;
  homepageUri: string | null;
  hqCountry: string | null;
  industries: string[];
  yearFounded: number | null;
  organizationType: string | null;
  nbEmployees: string | null;
  parentCompany: string | null;
  atsHint: string | null;
  totalJobs: number | null;
}

export interface FundingFacts {
  latestFundingAmount: number | null;
  latestFundingType: string | null;
  latestFundingYear: number | null;
  formDCount: number | null;
  formDDates: string[];
}

export interface SecFacts {
  isPublicFiler: boolean;
  cik: string | null;
  latest10kDate: string | null;
  latest10qDate: string | null;
  latest8kDate: string | null;
  latestS1Date: string | null;
  hasS1: boolean;
  hasRestructuring8k: boolean;
  hasOfficerChange8k: boolean;
  totalFilings2y: number | null;
}

export interface GovContractFacts {
  agencies: string[];
  awardCount: number | null;
  latestAward: string | null;
  totalAmount: number | null;
}

export interface H1bLcaFacts {
  fiscalYear: number;
  initialApprovals: number;
  continuingApprovals: number;
  initialDenials: number;
  continuingDenials: number;
  employerCity: string | null;
  employerState: string | null;
}

export interface WarnRecentNotice {
  employerName: string | null;
  noticeDate: string | null;
  layoffDate: string | null;
  employeesAffected: number | null;
  location: string | null;
}

export interface WarnNoticeFacts {
  noticeCount: number;
  totalEmployeesAffected: number;
  states: string[];
  /** Capped to `WARN_RECENT_LIMIT` — the band shows a taste, not the ledger. */
  recent: WarnRecentNotice[];
}

export interface HealthFacts {
  /** Raw snake_case verdict, e.g. "actively_hiring". Humanize at render time. */
  verdict: string | null;
  score: number | null;
  repostRate: number | null;
  operatingStatus: string | null;
  /** company_health_reviews.created_at — the observation window's start. */
  observedSinceIso: string;
}

export interface WeeklyCadence {
  /** ISO date (Monday) the bucket starts. */
  weekStartIso: string;
  newListings: number;
  /** The week Velai first saw this employer. Its count includes every role
   *  that was already open then, so it is a backlog, not a burst of hiring. */
  firstTracked: boolean;
  /** The week containing "now" — still being counted, never a finished zero. */
  inProgress: boolean;
}

export interface CadenceFacts {
  /** Chronological; starts at the first tracked week when tracking began
   *  inside the window, so weeks Velai never watched are not drawn as zeros. */
  weeks: WeeklyCadence[];
}

export interface IntegrityFacts {
  /** How the roles closed since the record window began, one row per distinct closed_reason. */
  closedReasonCounts: { reason: string; label: string; count: number }[];
  /** The SUM of the cadence strip's bars over the same window, leaving out
   *  the first tracked week when it falls inside it (those roles were already
   *  open — the first crawl's backlog, not new hiring). Equal to the strip by
   *  construction: see {@link buildHiringRecordSections}. */
  openedCount: number;
  /** Earliest `first_seen_at` Velai has for this employer, or null when it
   *  has never seen one. The one tracked-start value on the page. */
  trackedSinceIso: string | null;
}

export interface TechFacts {
  groups: string[];
  techTier: string | null;
  totalLiveTechs: number | null;
  totalDeadTechs: number | null;
  hasFramework: boolean;
  hasAnalytics: boolean;
}

export interface ChangeEventRow {
  eventType: string;
  direction: string;
  title: string | null;
  occurredAt: string;
  confidence: number | null;
}

export type CompanyExhaust = {
  profile: ExhaustSection<CompanyProfile>;
  funding: ExhaustSection<FundingFacts>;
  secListing: ExhaustSection<SecFacts>;
  govContracts: ExhaustSection<GovContractFacts>;
  h1bLca: ExhaustSection<H1bLcaFacts>;
  warnNotices: ExhaustSection<WarnNoticeFacts>;
  health: ExhaustSection<HealthFacts>;
  cadence: ExhaustSection<CadenceFacts>;
  integrity: ExhaustSection<IntegrityFacts>;
  techStack: ExhaustSection<TechFacts>;
  changeHistory: ExhaustSection<ChangeEventRow[]>;
  /** The one resolved sector (see {@link resolveSector}); null when no source names one. */
  sector: string | null;
  /** The employer's careers page from `company_boards` (see {@link resolveCareersUrl}); null when none is a web address. */
  careersUrl: string | null;
};

const VERDICT_MIN_OBSERVATION_DAYS = 90;
/** Exported — `get_company_timeline` (agent/company-tools.ts) clamps its
 *  own `limit` input to this SAME cap, so the MCP wire's ceiling can never
 *  drift from the number of rows this module actually fetches. */
export const CHANGE_HISTORY_LIMIT = 50;
const WARN_RECENT_LIMIT = 3;

// ─────────────────────────── pure decision helpers ───────────────────────

/**
 * Zero-fills `newListings` sums (already SQL-aggregated to ISO weeks) into a
 * trailing `weekCount`-week series ending on the ISO week containing `nowMs`,
 * with no gaps inside the weeks Velai actually watched.
 *
 * A missing row is only a real zero AFTER tracking began. Before
 * `trackedSinceIso` there is no observation at all, and drawing those weeks
 * as zeros told visitors a company "posted nothing" for months and then
 * burst — when the "burst" was Velai's first crawl finding roles that were
 * already open. So when tracking began inside the window the series starts
 * at that week and flags it `firstTracked`; the last week is always
 * `inProgress`, never a finished zero on a Tuesday.
 */
export function buildWeeklyCadence(
  weekSums: { weekStartIso: string; newListings: number }[],
  nowMs: number,
  weekCount = RECORD_WINDOW_WEEKS,
  trackedSinceIso: string | null = null,
): WeeklyCadence[] {
  const byWeek = new Map(weekSums.map((w) => [w.weekStartIso, w.newListings]));
  const currentWeekStart = new Date(`${isoWeekStart(nowMs)}T00:00:00Z`);

  const trackedMs = trackedSinceIso ? Date.parse(trackedSinceIso) : NaN;
  const trackedWeek = Number.isNaN(trackedMs) ? null : isoWeekStart(trackedMs);

  const series: WeeklyCadence[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const d = new Date(currentWeekStart);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const iso = d.toISOString().slice(0, 10);
    // ISO dates compare correctly as strings.
    if (trackedWeek && iso < trackedWeek) continue;
    series.push({
      weekStartIso: iso,
      newListings: byWeek.get(iso) ?? 0,
      firstTracked: trackedWeek === iso,
      inProgress: i === 0,
    });
  }
  return series;
}

/**
 * The verdict sentence is only honest with ≥90 days of observed history — a
 * company reviewed for the first time last week has no track record to
 * summarize yet. Both sides of the boundary are inclusive/exclusive per the
 * contract ("≥ 90 days"): exactly 90 days passes.
 */
export function isVerdictWindowSufficient(
  observedSinceIso: string,
  nowMs: number,
  minDays = VERDICT_MIN_OBSERVATION_DAYS,
): boolean {
  const since = Date.parse(observedSinceIso);
  if (Number.isNaN(since)) return false;
  const ageDays = (nowMs - since) / (1000 * 60 * 60 * 24);
  return ageDays >= minDays;
}

/**
 * Public companies show the SEC listing cell INSTEAD of the funding cell —
 * never both (a company that filed an S-1 and also raised a Series C
 * earlier in its life should not show a stale funding round next to its
 * public listing). Returns which single cell to render, or null when
 * neither section has data.
 */
export function resolveFundingOrListingCell(input: {
  secListing: SecFacts | null;
  funding: FundingFacts | null;
}): "sec" | "funding" | null {
  if (input.secListing?.isPublicFiler === true) return "sec";
  if (input.funding) return "funding";
  return null;
}

/**
 * "N h-1b approvals in fy<year> (X initial, Y continuing)." — the denial
 * clause is appended only when there were denials to report; a company with
 * zero denials gets a plain approvals sentence, not "(0 denials)" noise.
 */
export function buildH1bSentence(data: H1bLcaFacts): string {
  const total = data.initialApprovals + data.continuingApprovals;
  const denials = data.initialDenials + data.continuingDenials;
  const base = `${formatCount(total)} h-1b approval${total === 1 ? "" : "s"} in fy${data.fiscalYear} (${formatCount(data.initialApprovals)} initial, ${formatCount(data.continuingApprovals)} continuing).`;
  return denials > 0 ? `${base} ${formatCount(denials)} denial${denials === 1 ? "" : "s"} in the same period.` : base;
}

/** "N layoff notice(s) filed — M employees affected." */
export function buildWarnSentence(data: WarnNoticeFacts): string {
  return `${formatCount(data.noticeCount)} layoff notice${data.noticeCount === 1 ? "" : "s"} filed — ${formatCount(data.totalEmployeesAffected)} employee${data.totalEmployeesAffected === 1 ? "" : "s"} affected.`;
}

/**
 * Coverage ladder: how much of the exhaust module resolved for this domain.
 * - "minimal" — no exhaust connection at all (box PG unreachable/unset).
 * - "thin" — exhaust resolved but this domain has no enrichment profile row
 *   (jobs exist, nothing enriched yet).
 * - "full" — an enrichment profile row exists.
 * Drives which bands the page attempts to render (see /co/[slug]/page.tsx).
 */
export function resolveCoverageLadder(exhaust: CompanyExhaust | null): "full" | "thin" | "minimal" {
  if (!exhaust) return "minimal";
  return exhaust.profile ? "full" : "thin";
}

// ───────────────────────────── payload coercion ──────────────────────────

/** Exported — company-search.ts reuses this SAME payload coercion for
 *  `search_companies` rather than duplicating it. */
export function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

/** Exported — see `str`'s doc comment above. */
export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** Exported — see `str`'s doc comment above. */
export function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** health_reviews and fingerprints fill every domain, with a default bucket
 *  ('general', 'unknown') when they could not classify it. That bucket is not
 *  a sector, so it must not shadow a real one further down the chain. */
const NON_SECTORS = new Set([
  "", "general", "unknown",
  // labels that classify the economy or a legal form, not the work
  "service", "business-to-business", "business to business", "holding company", "holding company activities",
]);

/** THE sector resolver: health_reviews, then fingerprints, then boards, then the hiring.cafe
 *  profile's first non-generic industry (its own words); the first that names a real sector wins
 *  (as a display label), null when none does. */
export function resolveSector(row: Partial<SectorRow> | null, industries: readonly string[] = []): string | null {
  for (const candidate of [row?.health_reviews, row?.fingerprints, row?.boards, ...industries]) {
    const sector = str(candidate)?.trim();
    if (sector && !NON_SECTORS.has(sector.toLowerCase())) return categoryLabel(sector);
  }
  return null;
}

/** A Wikidata industry as a sector name: a trailing whole word "industry" dropped ("software industry" -> "software"), null when
 *  what remains names no sector (empty, a NON_SECTORS label, or a "... sector of the economy" tier). */
function sectorForm(industry: string): string | null {
  const raw = industry.trim();
  const form = raw.replace(/\s*\bindustry$/i, "").trim();
  const generic = [raw, form].some((x) => NON_SECTORS.has(x.toLowerCase())) || /sector of the economy$/i.test(form);
  return generic ? null : form;
}

/** The sector from Wikidata's industry (P452), the last resort after {@link resolveSector}: the one industry (none when it has several) of the matched item whose
 *  label names the company as displayed (`displayName`); with none agreeing, of the items only when every one has the same industries. */
export function wikidataSector(items: readonly WikidataItem[], displayName: string): string | null {
  const key = (name: string) => siteKey(displayCompanyName(name));
  const industriesKey = (item: WikidataItem) => JSON.stringify(item.industries);
  const agreeing = items.filter((item) => item.industries.length > 0 && key(item.label) === key(displayName));
  const chosen = agreeing.length > 0 ? agreeing : items;
  const [first] = chosen;
  if (!first || chosen.some((item) => industriesKey(item) !== industriesKey(first))) return null;
  const forms = new Map<string, string>();
  for (const x of first.industries) {
    const form = sectorForm(x);
    if (form) forms.set(form.toLowerCase(), form);
  }
  return forms.size === 1 ? categoryLabel([...forms.values()][0]!) : null;
}

/** A stored URL that is an ATS API endpoint (boards-api.greenhouse.io/v1/boards/x/jobs, api.lever.co/v0/postings/x,
 *  jobs.ashbyhq.com/api/non-user-graphql): an `api.` / `<x>-api.` host or an `/api` path segment. A bare version
 *  segment (/v2/) is not enough: Taleo TBE career centers live at .../careers/v2/jobSearch. The pipeline can keep as career_page_url (subspace pipeline.ts:207 isPersistableDiscoveredUrl) but a person cannot browse. */
const API_ENDPOINT = /^(?:[a-z0-9-]+-)?api\.|\/api(?:\/|$)/i;

/** `company_boards.last_scrape_outcome` values saying the kept URL is not a usable careers page
 *  (subspace src/lib/scrape-outcome.ts:12-45 union). Transient ERROR_* / DOMAIN_TIMEOUT and
 *  EMPTY_BOARD (a real page with no jobs) are deliberately absent. status='explored' is not a verdict. */
const UNUSABLE_URL_OUTCOMES = new Set([
  "CAREER_PAGE_JUNK",
  "CAREER_PAGE_CORPORATE",
  "CAREER_PAGE_REDIRECTED",
  "URL_DEAD_404",
  "SLUG_OWNERSHIP_MISMATCH",
  "SITE_PARKED",
  // discovery never found a careers URL (subspace scrape-outcome.ts:28-29), so a URL stored beside them was never confirmed
  "UNSCRAPABLE_NO_URL",
  "REACHABLE_NO_CAREER_PAGE",
]);

/** The pipeline's verdict that the stored URL is unusable (last_scrape_outcome), an API endpoint, or an ATS vendor URL naming no tenant. */
function isJunkStoredCareersUrl(row: Partial<SectorRow>, url: URL): boolean {
  return UNUSABLE_URL_OUTCOMES.has(row.last_scrape_outcome ?? "") || API_ENDPOINT.test(url.hostname) || API_ENDPOINT.test(url.pathname) || isTenantlessVendorUrl(url.href);
}

/** THE careers-link resolver: the stored `career_page_url` when it is an http(s) address the pipeline did not
 *  judge junk, else the board root derived from the domain's recent posting URLs, else null. */
export function resolveCareersUrl(row: Partial<SectorRow> | null): string | null {
  const raw = str(row?.careers_url)?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (/^https?:$/.test(url.protocol) && !isJunkStoredCareersUrl(row ?? {}, url)) return raw;
    } catch {
      /* not a URL: fall through to the derived root */
    }
  }
  return row?.domain && row.listing_urls?.length ? pickBoardRoot(row.listing_urls, row.domain) : null;
}

// ─────────────────────────────── row shapes ───────────────────────────────

interface EnrichmentRow {
  data_type: string;
  payload: Record<string, unknown>;
  fetched_at: string;
}

interface HealthRow {
  health_verdict: string | null;
  health_score: number | string | null;
  job_repost_rate: number | string | null;
  operating_status: string | null;
  created_at: string;
  last_checked_at: string | null;
}

/** One `job_listings` week bucket; a lone row with a null `week_start`
 *  carries `first_day` for an employer with nothing opened in the window. */
interface OpenedWeekRow {
  week_start: string | null;
  total: number | string | null;
  first_day: string | null;
}

interface ClosedReasonRow {
  closed_reason: string | null;
  n: number | string;
}

interface ChangeEventDbRow {
  event_type: string;
  direction: string;
  title: string | null;
  occurred_at: string;
  confidence: number | string | null;
}

const ENRICHMENT_DATA_TYPES = [
  "company_profile",
  "funding",
  "sec_filing_summary",
  "government_contract",
  "tech_profile",
  "h1b_lca",
  "warn_notice",
] as const;

async function fetchEnrichmentRows(pg: Queryable, domain: string): Promise<Map<string, EnrichmentRow>> {
  const { rows } = await pg.query<EnrichmentRow>(
    `SELECT DISTINCT ON (data_type) data_type, payload, fetched_at
     FROM company_enrichment
     WHERE company_domain = $1 AND data_type = ANY($2)
     ORDER BY data_type, fetched_at DESC`,
    [domain, ENRICHMENT_DATA_TYPES as unknown as string[]],
  );
  return new Map(rows.map((r) => [r.data_type, r]));
}

async function fetchHealthRow(pg: Queryable, domain: string): Promise<HealthRow | null> {
  const { rows } = await pg.query<HealthRow>(
    `SELECT health_verdict, health_score, job_repost_rate, operating_status, created_at, last_checked_at
     FROM company_health_reviews
     WHERE company_domain = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [domain],
  );
  return rows[0] ?? null;
}

export interface SectorRow {
  health_reviews: string | null;
  fingerprints: string | null;
  boards: string | null;
  careers_url: string | null;
  /** company_boards.last_scrape_outcome: the pipeline's verdict on the stored URL. */
  last_scrape_outcome: string | null;
  /** The domain's 20 newest posting URLs (newest first), for deriving a board root when no stored URL is usable. */
  listing_urls: string[] | null;
  /** The domain the row was read for, which a derived root's tenant must agree with. */
  domain: string;
}

/** The three sector columns the box holds for one domain, side by side so
 *  {@link resolveSector} can pick, plus the careers page the same board row holds; scalar subselects each hit a domain index. */
async function fetchSectorRow(pg: Queryable, domain: string): Promise<SectorRow | null> {
  const { rows } = await pg.query<SectorRow>(
    `SELECT
       (SELECT sector FROM company_health_reviews WHERE company_domain = $1 ORDER BY created_at DESC LIMIT 1) AS health_reviews,
       (SELECT sector FROM company_fingerprints WHERE domain = $1 LIMIT 1) AS fingerprints,
       (SELECT sector FROM company_boards WHERE company_domain = $1 LIMIT 1) AS boards,
       (SELECT career_page_url FROM company_boards WHERE company_domain = $1 LIMIT 1) AS careers_url,
       (SELECT last_scrape_outcome FROM company_boards WHERE company_domain = $1 LIMIT 1) AS last_scrape_outcome,
       (SELECT array_agg(url ORDER BY first_seen_at DESC) FROM (SELECT url, first_seen_at FROM job_listings WHERE company_domain = $1 ORDER BY first_seen_at DESC LIMIT 20) recent) AS listing_urls`,
    [domain],
  );
  return rows[0] ? { ...rows[0], domain } : null;
}

/** Start of the record window: the Monday `RECORD_WINDOW_WEEKS - 1` weeks
 *  before this week's, in UTC — the same boundary `isoWeekStart` draws. */
const WINDOW_START_SQL = `(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '${RECORD_WINDOW_WEEKS - 1} weeks') AT TIME ZONE 'UTC'`;

export interface RecordRows {
  closedReasons: ClosedReasonRow[];
  weekRows: OpenedWeekRow[];
}

/** The employer's opened/closed record, every figure from `job_listings`:
 *  opened roles per week over the strip's window, when tracking began, and
 *  how many closed since the window began. */
async function fetchRecordRows(pg: Queryable, domain: string): Promise<RecordRows> {
  const [closed, weeks] = await Promise.all([
    pg.query<ClosedReasonRow>(
      `SELECT closed_reason, COUNT(*)::int AS n
       FROM job_listings
       WHERE company_domain = $1 AND closed_at >= ${WINDOW_START_SQL}
       GROUP BY closed_reason`,
      [domain],
    ),
    pg.query<OpenedWeekRow>(
      `WITH wk AS (
         SELECT date_trunc('week', first_seen_at AT TIME ZONE 'UTC')::date::text AS week_start, COUNT(*)::int AS total
         FROM job_listings
         WHERE company_domain = $1 AND first_seen_at >= ${WINDOW_START_SQL}
         GROUP BY 1
       )
       SELECT wk.week_start, wk.total,
         (SELECT (MIN(first_seen_at) AT TIME ZONE 'UTC')::date::text FROM job_listings WHERE company_domain = $1) AS first_day
       FROM (SELECT 1) one LEFT JOIN wk ON true
       ORDER BY wk.week_start`,
      [domain],
    ),
  ]);
  return { closedReasons: closed.rows, weekRows: weeks.rows };
}

async function fetchChangeHistoryRows(pg: Queryable, domain: string): Promise<ChangeEventDbRow[]> {
  const { rows } = await pg.query<ChangeEventDbRow>(
    `SELECT event_type, direction, title, occurred_at, confidence
     FROM company_change_events
     WHERE company_domain = $1 AND review_status = 'published'
     ORDER BY occurred_at DESC
     LIMIT ${CHANGE_HISTORY_LIMIT}`,
    [domain],
  );
  return rows;
}

// ────────────────────────────── section builders ──────────────────────────

function buildProfileSection(row: EnrichmentRow | undefined): ExhaustSection<CompanyProfile> {
  if (!row) return null;
  const p = row.payload ?? {};
  return {
    data: {
      tagline: str(p.tagline),
      homepageUri: str(p.homepage_uri),
      hqCountry: str(p.hq_country),
      industries: strArray(p.industries),
      yearFounded: num(p.year_founded),
      organizationType: str(p.organization_type),
      nbEmployees: str(p.nb_employees) ?? (num(p.nb_employees) != null ? String(num(p.nb_employees)) : null),
      parentCompany: str(p.parent_company),
      atsHint: str(p.hiringcafe_ats_hint),
      totalJobs: num(p.total_jobs),
    },
    source: "company_enrichment · company_profile",
    label: "Company profile",
    asOf: row.fetched_at,
  };
}

function buildFundingSection(
  profileRow: EnrichmentRow | undefined,
  fundingRow: EnrichmentRow | undefined,
): ExhaustSection<FundingFacts> {
  const p = profileRow?.payload ?? {};
  const f = fundingRow?.payload ?? {};
  const latestFundingAmount = num(p.latest_funding_amount);
  const formDCount = num(f.form_d_count);
  if (latestFundingAmount == null && formDCount == null) return null;

  const asOf = [profileRow?.fetched_at, fundingRow?.fetched_at].filter((x): x is string => Boolean(x)).sort().pop();
  return {
    data: {
      latestFundingAmount,
      latestFundingType: str(p.latest_funding_type),
      latestFundingYear: num(p.latest_funding_year),
      formDCount,
      formDDates: strArray(f.form_d_dates),
    },
    source: "company_enrichment · funding",
    label: "Funding",
    asOf: asOf ?? new Date(0).toISOString(),
  };
}

function buildSecSection(row: EnrichmentRow | undefined): ExhaustSection<SecFacts> {
  if (!row) return null;
  const p = row.payload ?? {};
  return {
    data: {
      isPublicFiler: bool(p.is_public_filer),
      cik: str(p.cik),
      latest10kDate: isoDate(p.latest_10k_date),
      latest10qDate: isoDate(p.latest_10q_date),
      latest8kDate: isoDate(p.latest_8k_date),
      latestS1Date: isoDate(p.latest_s1_date),
      hasS1: bool(p.has_s1),
      hasRestructuring8k: bool(p.has_restructuring_8k),
      hasOfficerChange8k: bool(p.has_officer_change_8k),
      totalFilings2y: num(p.total_filings_2y),
    },
    source: "company_enrichment · sec_filing_summary",
    label: "SEC filings",
    asOf: row.fetched_at,
  };
}

function buildGovSection(row: EnrichmentRow | undefined): ExhaustSection<GovContractFacts> {
  if (!row) return null;
  const p = row.payload ?? {};
  const awardCount = num(p.award_count);
  const totalAmount = num(p.total_amount);
  if (awardCount == null && totalAmount == null) return null;
  return {
    data: {
      agencies: strArray(p.agencies),
      awardCount,
      latestAward: isoDate(p.latest_award) ?? str(p.latest_award),
      totalAmount,
    },
    source: "company_enrichment · government_contract",
    label: "Federal contracts",
    asOf: row.fetched_at,
  };
}

/**
 * Exported (unlike its sibling builders above) so the payload→section and
 * missing-keys→null contracts are node:test-able directly — the sentence
 * grammar it feeds (`buildH1bSentence`) depends on every numeric field being
 * present, so a partial row (e.g. denials missing) drops the whole section
 * rather than rendering a sentence with a fabricated zero.
 */
export function buildH1bSection(row: EnrichmentRow | undefined): ExhaustSection<H1bLcaFacts> {
  if (!row) return null;
  const p = row.payload ?? {};
  const fiscalYear = num(p.fiscal_year);
  const initialApprovals = num(p.initial_approvals);
  const continuingApprovals = num(p.continuing_approvals);
  const initialDenials = num(p.initial_denials);
  const continuingDenials = num(p.continuing_denials);
  if (
    fiscalYear == null ||
    initialApprovals == null ||
    continuingApprovals == null ||
    initialDenials == null ||
    continuingDenials == null
  ) {
    return null;
  }
  return {
    data: {
      fiscalYear,
      initialApprovals,
      continuingApprovals,
      initialDenials,
      continuingDenials,
      employerCity: str(p.employer_city),
      employerState: str(p.employer_state),
    },
    source: "company_enrichment · h1b_lca",
    label: "H-1B visa filings",
    asOf: row.fetched_at,
  };
}

/** Exported for the same node:test reasons as `buildH1bSection`. */
export function buildWarnSection(row: EnrichmentRow | undefined): ExhaustSection<WarnNoticeFacts> {
  if (!row) return null;
  const p = row.payload ?? {};
  const noticeCount = num(p.notice_count);
  const totalEmployeesAffected = num(p.total_employees_affected);
  if (noticeCount == null || totalEmployeesAffected == null) return null;

  const recentRaw = Array.isArray(p.recent) ? p.recent : [];
  const recent: WarnRecentNotice[] = recentRaw.slice(0, WARN_RECENT_LIMIT).map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      employerName: str(row.employer_name),
      noticeDate: isoDate(row.notice_date),
      layoffDate: isoDate(row.layoff_date),
      employeesAffected: num(row.employees_affected),
      location: str(row.location),
    };
  });

  return {
    data: { noticeCount, totalEmployeesAffected, states: strArray(p.states), recent },
    source: "company_enrichment · warn_notice",
    label: "WARN Act notices",
    asOf: row.fetched_at,
  };
}

function buildTechSection(row: EnrichmentRow | undefined): ExhaustSection<TechFacts> {
  if (!row) return null;
  const p = row.payload ?? {};
  return {
    data: {
      groups: strArray(p.groups),
      techTier: str(p.tech_tier),
      totalLiveTechs: num(p.total_live_techs),
      totalDeadTechs: num(p.total_dead_techs),
      hasFramework: bool(p.has_framework),
      hasAnalytics: bool(p.has_analytics),
    },
    source: "company_enrichment · tech_profile",
    label: "Technology profile",
    asOf: row.fetched_at,
  };
}

function buildHealthSection(row: HealthRow | null): ExhaustSection<HealthFacts> {
  if (!row) return null;
  return {
    data: {
      verdict: str(row.health_verdict),
      score: num(row.health_score),
      repostRate: num(row.job_repost_rate),
      operatingStatus: str(row.operating_status),
      observedSinceIso: row.created_at,
    },
    source: "company_health_reviews",
    label: "Company health review",
    asOf: row.last_checked_at ?? row.created_at,
  };
}

/**
 * The cadence strip and the opened/closed record, built from the same weekly
 * rows so they cannot disagree: `openedCount` is the sum of the bars after
 * the first tracked week. Kept with zero counts once tracking has started
 * ("tracked since X, 0 opened, 0 closed" is a record); both are null for an
 * employer Velai has never seen, where null reads as "not tracked".
 */
export function buildHiringRecordSections(
  result: RecordRows | null,
  nowMs: number,
): { cadence: ExhaustSection<CadenceFacts>; integrity: ExhaustSection<IntegrityFacts> } {
  const trackedSinceIso = isoDate(result?.weekRows[0]?.first_day);
  if (!result || !trackedSinceIso) return { cadence: null, integrity: null };
  const weekSums = result.weekRows
    .filter((r) => r.week_start)
    .map((r) => ({ weekStartIso: r.week_start as string, newListings: num(r.total) ?? 0 }));
  const weeks = buildWeeklyCadence(weekSums, nowMs, RECORD_WINDOW_WEEKS, trackedSinceIso);
  const asOf = new Date(nowMs).toISOString();
  return {
    cadence: { data: { weeks }, source: "job_listings", label: "Posting activity", asOf },
    integrity: {
      data: {
        closedReasonCounts: result.closedReasons
          .filter((r) => r.closed_reason)
          .map((r) => ({
            reason: r.closed_reason as string,
            label: eventTypeLabel(r.closed_reason as string),
            count: num(r.n) ?? 0,
          })),
        openedCount: weeks.filter((w) => !w.firstTracked).reduce((sum, w) => sum + w.newListings, 0),
        trackedSinceIso,
      },
      source: "job_listings",
      label: "Job listings",
      asOf,
    },
  };
}

function buildChangeHistorySection(rows: ChangeEventDbRow[], nowMs: number): ExhaustSection<ChangeEventRow[]> {
  if (rows.length === 0) return null;
  return {
    data: rows.map((r) => ({
      eventType: r.event_type,
      direction: r.direction,
      title: r.title,
      occurredAt: r.occurred_at,
      confidence: num(r.confidence),
    })),
    source: "company_change_events",
    label: "Company change history",
    asOf: new Date(nowMs).toISOString(),
  };
}

// ────────────────────────────────── entry ─────────────────────────────────

/**
 * The one entry point the page (and, later, MCP tools) calls. Returns null
 * only when the exhaust connection itself is unavailable (`EXHAUST_PG_URL`
 * unset) — every other failure is scoped to the one section it broke via
 * `Promise.allSettled`, so a broken `company_change_events` query still
 * leaves the profile, funding, and cadence bands intact.
 *
 * `getPg` defaults to the real `getExhaustPg` singleton — overridable so
 * tests can inject a fake `Queryable` that fails one query without touching
 * `EXHAUST_PG_URL` or the module's lazily-cached pool (same injection shape
 * as `getCompanyPageData`'s `search: SearchFn = searchJobs`, get-company.ts).
 */
export async function getCompanyExhaust(
  domain: string,
  getPg: () => Queryable | null = getExhaustPg,
  nowMs: number = Date.now(),
): Promise<CompanyExhaust | null> {
  return (await readCompanyExhaust(domain, getPg, nowMs)).exhaust;
}

/** What each of the five fetchers returns. */
interface Pieces {
  enrichment: Map<string, EnrichmentRow>;
  health: HealthRow | null;
  record: RecordRows;
  changeHistory: ChangeEventDbRow[];
  sector: SectorRow | null;
}

/** The fetchers that have answered so far; a key still missing is a query still out. */
type Settled = { [K in keyof Pieces]?: PromiseSettledResult<Pieces[K]> };

/**
 * The exhaust from whatever has settled. A piece that failed or is still out
 * builds the same absent (null) section: never a zero or an empty list, so the
 * page leaves that section off.
 */
function assembleExhaust(settled: Settled, nowMs: number): CompanyExhaust {
  const value = <K extends keyof Pieces>(key: K): Pieces[K] | null => {
    const r = settled[key];
    return r?.status === "fulfilled" ? r.value : null;
  };
  const { cadence, integrity } = buildHiringRecordSections(value("record"), nowMs);
  const enrichmentRows = value("enrichment") ?? new Map<string, EnrichmentRow>();
  const sector = value("sector");
  return {
    profile: buildProfileSection(enrichmentRows.get("company_profile")),
    funding: buildFundingSection(enrichmentRows.get("company_profile"), enrichmentRows.get("funding")),
    secListing: buildSecSection(enrichmentRows.get("sec_filing_summary")),
    govContracts: buildGovSection(enrichmentRows.get("government_contract")),
    h1bLca: buildH1bSection(enrichmentRows.get("h1b_lca")),
    warnNotices: buildWarnSection(enrichmentRows.get("warn_notice")),
    techStack: buildTechSection(enrichmentRows.get("tech_profile")),
    health: buildHealthSection(value("health")),
    cadence,
    integrity,
    changeHistory: buildChangeHistorySection(value("changeHistory") ?? [], nowMs),
    sector: sector ? resolveSector(sector, buildProfileSection(enrichmentRows.get("company_profile"))?.data.industries) : null,
    careersUrl: resolveCareersUrl(sector),
  };
}

/**
 * `getCompanyExhaust`, plus whether every query answered. Only a complete
 * read is worth keeping (`exhaust-cache.ts`): one that lost a section to a
 * failed or timed-out query would keep hiding that section after the box
 * recovered. `onPartial` gets the exhaust built from what has settled each time
 * a query answers, so a caller out of patience can use that instead of waiting
 * on the slowest query.
 */
export async function readCompanyExhaust(
  domain: string,
  getPg: () => Queryable | null = getExhaustPg,
  nowMs: number = Date.now(),
  onPartial?: (partial: CompanyExhaust) => void,
): Promise<{ exhaust: CompanyExhaust | null; complete: boolean }> {
  const pg = getPg();
  if (!pg) return { exhaust: null, complete: false };

  const settled: Settled = {};
  const track = <K extends keyof Pieces>(key: K, read: Promise<Pieces[K]>) =>
    Promise.allSettled([read]).then(([result]) => {
      (settled as Record<K, PromiseSettledResult<Pieces[K]>>)[key] = result;
      onPartial?.(assembleExhaust(settled, nowMs));
      return result;
    });
  const results = await Promise.all([
    track("enrichment", fetchEnrichmentRows(pg, domain)),
    track("health", fetchHealthRow(pg, domain)),
    track("record", fetchRecordRows(pg, domain)),
    track("changeHistory", fetchChangeHistoryRows(pg, domain)),
    track("sector", fetchSectorRow(pg, domain)),
  ]);
  return { exhaust: assembleExhaust(settled, nowMs), complete: results.every((r) => r.status === "fulfilled") };
}
