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

export interface PublicJob {
  id: string;
  title: string;
  company: string | null;
  company_domain: string | null;
  location: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
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
  /** Company aggregate fields — optional until sync backfills (Task 5). */
  company_opened_90d?: number | null;
  company_closed_90d?: number | null;
  company_open_count?: number | null;
  company_stage?: string | null;
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
  "location_country",
  "source",
] as const;
export type FacetKey = (typeof FACETABLE_KEYS)[number];

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
   * Place constraints parsed OUT of the query text (query understanding, not
   * user-picked facets — those live in `facets`). Each entry is a literal
   * corpus value in one location field; entries are OR'd into one clause:
   * a job in "Toronto" OR "Canada" satisfies a "toronto canada" query.
   * OR, not AND, is load-bearing: measured 2026-07-26, requiring
   * city AND country drops 43–59% of genuine matches because many city rows
   * carry no country value.
   */
  places?: PlaceFilter[];
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
