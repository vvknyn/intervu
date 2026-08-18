import type { BoardId } from "@/lib/boards/types";

/**
 * Jobs domain types for intervu.cc.
 *
 * `PublicJob` mirrors the read-only shape served by Subspace's Jobs API
 * (`GET /api/v1/jobs/{snapshot,changed}` — see docs/intervu-jobs-api.md in the
 * Subspace repo). Subspace stays the system of record + scoring engine; intervu
 * owns search / relevance / UX. The proprietary raw scores never cross this
 * boundary — only the coarse `ghost_badge` does.
 */

export type GhostBadge = "clear" | "caution" | "likely_ghost" | "unscored";

/**
 * Everything a ghost-verdict claim is allowed to be derived from: the verdict
 * and the moment it was reached. Every helper that renders or qualifies that
 * verdict (`checkFreshness`, `rowTrustChip`, `badgeFor` — badges.ts;
 * `ghostMetaFor` — presentation.ts; `ghostCheckedText` — job-detail-facts.ts)
 * takes THIS, not a loose timestamp argument.
 *
 * That is the whole point. Those helpers used to take `(ghostBadge, updatedAt,
 * now)`, which made "which field means *when we checked*" a decision each of
 * the eight call sites re-made independently — and all eight passed
 * `job.updated_at`, the last scrape. Passing the job removes the decision
 * instead of correcting eight copies of it.
 */
export type GhostChecked = Pick<PublicJob, "ghost_badge" | "ghost_checked_at">;

export interface PublicJob {
  id: string;
  title: string;
  company: string | null;
  company_domain: string | null;
  location: string | null;
  location_city: string | null;
  location_state: string | null;
  /** Usually a single country; a multi-country posting arrives as an array (Subspace feed, 2026-08). */
  location_country: string | string[] | null;
  /** e.g. "remote" | "hybrid" | "onsite" | "unknown" */
  work_type: string;
  description: string | null;
  /** e.g. "full_time" | "contract" | "unknown" */
  employment_type: string;
  /** e.g. "senior" | "mid" | "entry" | "unknown" */
  experience_level: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  /** e.g. "year" | "hour" */
  salary_period: string | null;
  visa_sponsorship: boolean | null;
  tags: string[];
  apply_url: string;
  source: string;
  posted_at: string | null;
  first_seen_at: string | null;
  /**
   * Derived at intervu ingest (see `derivePostedTs` in lib/jobs/meilisearch.ts) —
   * not part of the Subspace wire contract. Epoch ms, sanitized: rejects future
   * dates and pre-2000 junk in `posted_at`, falling back to `first_seen_at`.
   * Exists because Meilisearch range operators are numeric-only, so the raw
   * ISO `posted_at` string can't be range-filtered for age-bucket queries.
   */
  posted_ts?: number | null;
  updated_at: string | null;
  vacancy_status: string;
  /** Coarse, public-safe ghost signal. Raw scores intentionally excluded (B2B IP). */
  ghost_badge: GhostBadge;
  /**
   * When the check that produced `ghost_badge` actually RAN — Subspace's
   * `integrity_scored_at`, written by score_jobs in the same statement as the
   * verdict itself, so it can only ever date THIS verdict.
   *
   * This exists because we used to date the verdict by `updated_at` (the
   * row's last successful-scrape write) and render "checked 89d ago" from it.
   * Those are different events and the substitution was wrong in BOTH
   * directions — measured across Subspace's active rows on 2026-08-17, the
   * median row's check is ~5 days NEWER than its last write while 256,555
   * rows have a check more than 7 days OLDER. Nothing may fall back to
   * `updated_at` when this is absent: a check we cannot date is a check we
   * cannot claim, and `GhostChecked` below exists so no caller has to pick.
   *
   * Optional because documents indexed before the field shipped don't carry
   * it. Absent is treated exactly like "never scored": unknown-age, which
   * `checkFreshness` reads as stale — the conservative direction.
   */
  ghost_checked_at?: string | null;
  /** Company aggregate fields — optional until sync backfills (Task 5). */
  company_opened_90d?: number | null;
  company_closed_90d?: number | null;
  company_open_count?: number | null;
  company_stage?: string | null;
  /**
   * S4 exposure trust badges — dark launch. Subspace is adding these
   * upstream; every doc lacks them today, so they're optional and a job with
   * none renders no badge (see `deriveExposureBadges`,
   * components/jobs/job-detail-facts.ts — the render decision requires the
   * boolean to be exactly `true` AND its paired timestamp present, never on
   * absence or `false`).
   */
  is_indexed_google?: boolean | null;
  google_indexed_at?: string | null;
  is_indexed_linkedin?: boolean | null;
  linkedin_indexed_at?: string | null;
  /**
   * ITEM O-FE (2026-08-15) — user "Report listing" count, aggregated
   * upstream from the flags endpoint. Same dark-launch posture as the
   * exposure badges above: absent on every doc until that pipeline lands,
   * so a job with no field (or `0`) renders no "reported" chip — never a
   * fabricated one.
   */
  report_count?: number | null;
}

/**
 * Normalize a field that may arrive as a scalar, an array, or null/undefined
 * into an array — the one seam a multi-value field (currently just
 * `location_country`, for multi-country postings) funnels through before a
 * display helper decides how to combine multiple values (joined text vs.
 * concatenated flags — see presentation.ts's `locationText` and
 * country-flag.ts's `countryToFlag`).
 */
export function toValueArray(v: string | string[] | null | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export interface JobsApiMeta {
  request_id?: string;
  api_version?: string;
  latency_ms?: number;
  page_size?: number;
  next_cursor: string | null;
}

export interface JobsApiEnvelope {
  data: PublicJob[];
  meta: JobsApiMeta;
}

/** Facet keys exposed for faceted filtering (must be a subset of the Meili filterableAttributes). */
export const FACETABLE_KEYS = [
  "work_type",
  "experience_level",
  "employment_type",
  "ghost_badge",
  "visa_sponsorship",
  "location_country",
  "source",
] as const;
export type FacetKey = (typeof FACETABLE_KEYS)[number];

/** The subset of FACETABLE_KEYS the client actually consumes per search —
 *  either as a generic FacetGroup (work_type/experience_level/employment_type/
 *  location_country, SerpFilters.tsx) or a bespoke reader of its own facet
 *  values (ghost_badge → the ghost-hide count; visa_sponsorship → the
 *  sparse-filter honesty caption). `source` is FACETABLE (filterable via
 *  ?src=, url-state.ts, and by MCP) but never rendered — requesting its
 *  distribution on every search computes a count nothing reads. The
 *  per-search Meilisearch `facets:` request (buildSearchBody, meilisearch.ts)
 *  asks for exactly this list, not the full FACETABLE_KEYS. */
export const REQUESTED_FACET_KEYS: readonly FacetKey[] = [
  "work_type",
  "experience_level",
  "employment_type",
  "ghost_badge",
  "location_country",
  "visa_sponsorship",
] as const;

/** Per-facet value→count, for rendering filter options with live counts. */
export type FacetDistribution = Partial<Record<FacetKey, Record<string, number>>>;

/** Explicit sort choice. Omitted = auto (newest with no query, relevance with a query). */
export type JobSortMode = "newest" | "relevance" | "salary_desc";

/** Age-bucket filter, computed against sanitized `posted_ts` at request time. */
export type PostedBucket = "1d" | "3d" | "7d" | "30d" | "older";

/** Search request shape shared across every backend + the server action. */
export interface JobSearchParams {
  q?: string;
  /**
   * Task 11 — narrow a search to a single known id (the jobs/page.tsx
   * dead-link existence check: "does this exact posting still exist,"
   * independent of the CURRENT filters/query/sort/pagination window). Every
   * other field is normally omitted alongside this one — see
   * `buildFilter`/`passBase` in the two backends for how it composes (both
   * still apply the baseline `vacancy_status != "closed"` invariant, which
   * is deliberate: a closed vacancy is exactly "no longer available").
   */
  id?: string;
  /** Selected facet values: facetKey → values (OR within a key, AND across keys). */
  facets?: Partial<Record<FacetKey, string[]>>;
  /** Minimum salary — matches jobs paying at least this at the top or bottom of the band. */
  salaryMin?: number;
  /** Only jobs that sponsor visas. */
  visaOnly?: boolean;
  /** When true, exclude jobs scored likely_ghost. The first-screen default. */
  hideGhosts?: boolean;
  /** Explicit sort override; see `JobSortMode`. */
  sort?: JobSortMode;
  /** Restrict to jobs whose sanitized posted_ts falls in this age bucket. */
  postedBucket?: PostedBucket;
  /**
   * Restrict to jobs posted at or after this exact epoch-ms floor —
   * `postedBucket`'s sibling for an arbitrary "since a stored cursor" query
   * (the count-new action, `countNewSinceAction` in actions/jobs.ts) rather
   * than one of `postedBucket`'s fixed relative-to-now windows. Both fields
   * funnel through the SAME `posted_ts` translation (`buildFilter`,
   * meilisearch.ts) — this is the one place a caller may express an
   * absolute posted_ts floor; nothing downstream ever hand-builds a
   * `posted_ts` filter clause outside that function.
   */
  postedSinceMs?: number;
  /**
   * User has dismissed the IP-based location default (the /jobs default-
   * location chip's "×" — a persistent, explicit "don't do that" separate
   * from ever having typed a place) — see `hasLocationSignal`
   * (lib/geo/ip-default.ts), the ONE gate `searchJobs` checks before
   * calling `resolveLocationDefault`. Never set by an explicit place/facet
   * choice, which already suppresses the default on its own.
   */
  suppressLocationDefault?: boolean;
  /**
   * Place constraints parsed OUT of the query text (query understanding, not
   * user-picked facets — those live in `facets`). Each entry is one resolved
   * place mention (see `PlaceClause`); entries OR together: a job in
   * "Toronto" OR "Canada" satisfies a "toronto canada" query — TWO
   * independently-typed mentions never AND against each other, still the
   * measured-2026-07-26 reason (43–59% of genuine matches dropped) that OR
   * is load-bearing across mentions.
   *
   * WITHIN one city/metro mention, `PlaceClause.scopedToCountry` DOES AND the
   * city OR-set against the resolved country — otherwise a same-named city
   * in a different country satisfies the match too (2026-08-06: "toronto"
   * radius-matched a Richmond Hill, ONTARIO row's neighbor clause against a
   * Richmond Hill, GEORGIA posting, since a bare `location_city` clause
   * can't tell them apart). This is a deliberate, known trade-off in the
   * OTHER direction from the OR-across-mentions one above: a city row with
   * no country value at all will now fail a bare city search that would
   * have matched it before — accepted because the cross-country false
   * positive is worse than the false negative, and unlike an
   * independently-typed country word, this scope comes from the gazetteer's
   * OWN resolution of the city, not a second thing the searcher had to type.
   */
  places?: PlaceClause[];
  limit?: number;
  offset?: number;
  /** Request facet distributions (counts per value) to drive the filter UI. */
  withFacets?: boolean;
  /** Restrict to jobs at companies on a curated board allowlist. */
  board?: BoardId;
  /** Restrict to jobs at a single company domain (exact match). */
  companyDomain?: string;
}

/** One parsed place: which location field it lives in, and the corpus's own
 *  casing of the value (used verbatim in the filter, so matching can never
 *  depend on the engine's case rules). */
export interface PlaceFilter {
  field: "location_city" | "location_state" | "location_country";
  value: string;
}

/**
 * One resolved place mention. `any` OR's together every corpus value that
 * satisfies it (a city plus its radius-expanded neighbors, or an admin1/
 * country's name+code variants). `scopedToCountry`, set only for a city/
 * metro mention, additionally requires the whole clause to match ONE of the
 * resolved country's own values (AND) — without it, a same-named city in a
 * different country satisfies the filter too (a "Richmond Hill" row in
 * Georgia, US matching a Richmond Hill, ONTARIO radius match). See
 * `JobSearchParams.places` for how this composes with OTHER place mentions.
 */
export interface PlaceClause {
  any: PlaceFilter[];
  scopedToCountry?: PlaceFilter[];
}

export type JobsBackendKind = "meilisearch" | "snapshot-preview" | "unconfigured";

/**
 * Typeahead result for the search box (Task 9). No counts — `company` isn't a
 * facet (see FACETABLE_KEYS above), so per-value counts aren't cheap; this is
 * intentionally plain title/company text, deduped client-side.
 */
export interface JobSuggestions {
  titles: string[];
  companies: string[];
}

export interface JobSearchResult {
  hits: PublicJob[];
  total: number;
  backend: JobsBackendKind;
  configured: boolean;
  /** Human-readable note for unconfigured / preview / degraded states. */
  note?: string;
  /** True when a configured backend threw — a failed search, not an empty one. */
  unavailable?: boolean;
  /** True when results are a capped preview rather than the full searchable corpus. */
  preview?: boolean;
  /** True when the title/company precision pass was thin and the result was
   *  widened to a description-wide search (see searchMeili's two-pass). */
  widened?: boolean;
  /** Per-facet value→count for the active result set, when `withFacets` was requested. */
  facetDistribution?: FacetDistribution;
  /**
   * The query text actually searched, after query understanding stripped
   * work-mode/place tokens out of the raw typed query (see
   * `applyQueryUnderstanding` in query-understanding.ts and `searchJobs` in
   * search.ts, which sets this from `p.q`). The client needs this — not the
   * raw typed query — for title-relevance tiering: tiering against the RAW
   * query would wrongly demote a title that correctly omits a place word the
   * server already stripped (e.g. "technical account manager" residual still
   * matches a title with no "canada" in it). Omitted on the error/unconfigured
   * paths, where no query was ever actually searched.
   */
  effectiveQ?: string;
}
