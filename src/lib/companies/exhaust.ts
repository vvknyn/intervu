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
import { getExhaustPg, type Queryable } from "@/lib/pg/pool";

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
}

export interface IntegrityFacts {
  /** How the 90-day-closed roles closed, one row per distinct closed_reason. */
  closedReasonCounts: { reason: string; label: string; count: number }[];
  /** Roles first seen in the trailing 90 days. */
  openedCount: number;
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
  cadence: ExhaustSection<WeeklyCadence[]>;
  integrity: ExhaustSection<IntegrityFacts>;
  techStack: ExhaustSection<TechFacts>;
  changeHistory: ExhaustSection<ChangeEventRow[]>;
};

const CADENCE_WEEKS = 26;
const VERDICT_MIN_OBSERVATION_DAYS = 90;
const INTEGRITY_WINDOW_DAYS = 90;
/** Exported — `get_company_timeline` (agent/company-tools.ts) clamps its
 *  own `limit` input to this SAME cap, so the MCP wire's ceiling can never
 *  drift from the number of rows this module actually fetches. */
export const CHANGE_HISTORY_LIMIT = 50;
const WARN_RECENT_LIMIT = 3;

// ─────────────────────────── pure decision helpers ───────────────────────

/**
 * Zero-fills `newListings` sums (already SQL-aggregated to ISO weeks) into a
 * fixed trailing `weekCount`-week series ending on the ISO week containing
 * `nowMs`. A week the query never returned a row for (no postings, or no
 * `company_posting_daily` coverage yet) renders as an explicit `0` rather
 * than being silently absent — the design's "3px stub" depends on the
 * series having no gaps.
 */
export function buildWeeklyCadence(
  weekSums: { weekStartIso: string; newListings: number }[],
  nowMs: number,
  weekCount = CADENCE_WEEKS,
): WeeklyCadence[] {
  const byWeek = new Map(weekSums.map((w) => [w.weekStartIso, w.newListings]));

  // ISO week (Monday-start) containing `nowMs`, at UTC midnight.
  const now = new Date(nowMs);
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const currentWeekStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );

  const series: WeeklyCadence[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const d = new Date(currentWeekStart);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const iso = d.toISOString().slice(0, 10);
    series.push({ weekStartIso: iso, newListings: byWeek.get(iso) ?? 0 });
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
  const base = `${total} h-1b approval${total === 1 ? "" : "s"} in fy${data.fiscalYear} (${data.initialApprovals} initial, ${data.continuingApprovals} continuing).`;
  return denials > 0 ? `${base} ${denials} denial${denials === 1 ? "" : "s"} in the same period.` : base;
}

/** "N layoff notice(s) filed — M employees affected." */
export function buildWarnSentence(data: WarnNoticeFacts): string {
  return `${data.noticeCount} layoff notice${data.noticeCount === 1 ? "" : "s"} filed — ${data.totalEmployeesAffected} employee${data.totalEmployeesAffected === 1 ? "" : "s"} affected.`;
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

interface CadenceRow {
  week_start: string;
  total: number | string;
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

async function fetchCadenceRows(pg: Queryable, domain: string): Promise<CadenceRow[]> {
  const { rows } = await pg.query<CadenceRow>(
    `SELECT date_trunc('week', day)::date::text AS week_start, SUM(new_listings)::int AS total
     FROM company_posting_daily
     WHERE company_domain = $1 AND day >= (CURRENT_DATE - INTERVAL '${CADENCE_WEEKS} weeks')
     GROUP BY 1
     ORDER BY 1`,
    [domain],
  );
  return rows;
}

async function fetchIntegrityRows(
  pg: Queryable,
  domain: string,
): Promise<{ closedReasons: ClosedReasonRow[]; openedCount: number }> {
  const [closed, opened] = await Promise.all([
    pg.query<ClosedReasonRow>(
      `SELECT closed_reason, COUNT(*)::int AS n
       FROM job_listings
       WHERE company_domain = $1 AND closed_at >= now() - interval '${INTEGRITY_WINDOW_DAYS} days'
       GROUP BY closed_reason`,
      [domain],
    ),
    pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM job_listings
       WHERE company_domain = $1 AND first_seen_at >= now() - interval '${INTEGRITY_WINDOW_DAYS} days'`,
      [domain],
    ),
  ]);
  return { closedReasons: closed.rows, openedCount: opened.rows[0]?.n ?? 0 };
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

function buildCadenceSection(rows: CadenceRow[], nowMs: number): ExhaustSection<WeeklyCadence[]> {
  if (rows.length === 0) return null;
  const weekSums = rows.map((r) => ({ weekStartIso: r.week_start, newListings: num(r.total) ?? 0 }));
  return {
    data: buildWeeklyCadence(weekSums, nowMs),
    source: "company_posting_daily",
    label: "Posting activity",
    asOf: new Date(nowMs).toISOString(),
  };
}

function buildIntegritySection(
  result: { closedReasons: ClosedReasonRow[]; openedCount: number } | null,
  nowMs: number,
): ExhaustSection<IntegrityFacts> {
  if (!result || (result.closedReasons.length === 0 && result.openedCount === 0)) return null;
  return {
    data: {
      closedReasonCounts: result.closedReasons
        .filter((r) => r.closed_reason)
        .map((r) => ({
          reason: r.closed_reason as string,
          label: eventTypeLabel(r.closed_reason as string),
          count: num(r.n) ?? 0,
        })),
      openedCount: result.openedCount,
    },
    source: "job_listings",
    label: "Job listings",
    asOf: new Date(nowMs).toISOString(),
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
): Promise<CompanyExhaust | null> {
  const pg = getPg();
  if (!pg) return null;

  const nowMs = Date.now();
  const [enrichment, health, cadence, integrity, changeHistory] = await Promise.allSettled([
    fetchEnrichmentRows(pg, domain),
    fetchHealthRow(pg, domain),
    fetchCadenceRows(pg, domain),
    fetchIntegrityRows(pg, domain),
    fetchChangeHistoryRows(pg, domain),
  ]);

  const enrichmentRows = enrichment.status === "fulfilled" ? enrichment.value : new Map<string, EnrichmentRow>();

  return {
    profile: buildProfileSection(enrichmentRows.get("company_profile")),
    funding: buildFundingSection(enrichmentRows.get("company_profile"), enrichmentRows.get("funding")),
    secListing: buildSecSection(enrichmentRows.get("sec_filing_summary")),
    govContracts: buildGovSection(enrichmentRows.get("government_contract")),
    h1bLca: buildH1bSection(enrichmentRows.get("h1b_lca")),
    warnNotices: buildWarnSection(enrichmentRows.get("warn_notice")),
    techStack: buildTechSection(enrichmentRows.get("tech_profile")),
    health: buildHealthSection(health.status === "fulfilled" ? health.value : null),
    cadence: buildCadenceSection(cadence.status === "fulfilled" ? cadence.value : [], nowMs),
    integrity: buildIntegritySection(integrity.status === "fulfilled" ? integrity.value : null, nowMs),
    changeHistory: buildChangeHistorySection(changeHistory.status === "fulfilled" ? changeHistory.value : [], nowMs),
  };
}
