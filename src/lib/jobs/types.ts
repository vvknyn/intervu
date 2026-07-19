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
  limit?: number;
  offset?: number;
  /** Request facet distributions (counts per value) to drive the filter UI. */
  withFacets?: boolean;
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
  /** True when results are a capped preview rather than the full searchable corpus. */
  preview?: boolean;
  /** Per-facet value→count for the active result set, when `withFacets` was requested. */
  facetDistribution?: FacetDistribution;
}
