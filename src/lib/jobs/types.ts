import type { DefaultedField } from "./search-defaults";
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
export type GhostChecked = Pick<PublicJob, "ghost_badge" | "ghost_checked_at"> & {
  last_observed_alive_at?: string | null;
};

/** A place a posting is limited to: its label as written ("India", "EMEA") and the countries it covers. */
export interface PlaceRestriction {
  label: string;
  countries: string[];
  /**
   * The posting's own sentence that says it ("This role is open to candidates located in the US or
   * Canada."), tags removed, so a label built on the place can show where it came from. Absent for an
   * open-anywhere reading and for a place read from a title or a pay currency.
   */
  quote?: string;
  /**
   * The countries are welcome, not the only ones ("Canadians welcome"): the posting hires there and may hire
   * elsewhere, so it adds to a candidate's countries and never takes another's away.
   */
  open?: true;
}

import type { JdTerms } from "../match/jd-match";

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
  /**
   * Where the description says the person must be ("must be based in India",
   * "authorized to work in the US"), read on the server by
   * `/api/jobs/place-notes` for rows that name no country of their own. Not on
   * the index: only the rows a ranked list checked carry it, `null` when the
   * description names no such place, no `countries` when it says the role is
   * open to people anywhere (`OPEN_ANYWHERE`).
   */
  place_restriction?: PlaceRestriction | null;
  /**
   * The posting's requirement and duty terms, read from its description on
   * the server (`withJdTerms`, jd-terms.ts) for résumé-ranked lists, so the
   * browser can score the whole posting against the résumé it holds without
   * the description itself riding on every row. Not on the index. Absent on
   * rows nobody read; a page holding the whole description derives the same
   * terms from it (`jdTermsOf`, match/jd-match.ts).
   */
  jd_terms?: JdTerms | null;
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
  /**
   * Owned by Subspace's own classifier, not intervu — populated upstream and
   * filterable live since Meili task 467532 (2026-08-18, see
   * `JOBS_INDEX_SETTINGS` in meilisearch.ts) but never previously surfaced on
   * this wire type. Search hits are cast straight through (`as PublicJob[]`,
   * no stripping mapper), so this was always present on the raw document —
   * adding it here is typing-only, zero runtime change. Optional because
   * older/unclassified documents don't carry it.
   */
  occupation?: string | null;
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
  /**
   * Dedicated liveness timestamp — when this listing was directly observed alive,
   * either by a board scrape or an explicit HTTP probe.
   */
  last_observed_alive_at?: string | null;
  /** Company aggregate fields — optional until sync backfills (Task 5). */
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
  /** Enriched deterministic qualifications & telemetry */
  min_years_experience?: number | null;
  max_years_experience?: number | null;
  must_have_skills?: string[];
  preferred_skills?: string[];
  /**
   * Dark launch (2026-09-17) — set by the upstream extractor only when it
   * actually found a Requirements/Preferred heading to parse. Older
   * unstamped rows lack this field; absence must be treated as `false`
   * (never as "found"), same posture as the exposure badges above. Use
   * `evidencedSkills()` in presentation.ts for any display read of
   * `must_have_skills` / `preferred_skills` — never read those fields
   * directly for rendering.
   */
  skills_section_found?: boolean;
  tech_stack?: string[];
  in_office_days?: number | null;
  normalized_salary_min?: number | null;
  normalized_salary_max?: number | null;
  /**
   * ITEM O-FE (2026-08-15) — user "Report listing" count, aggregated
   * upstream from the flags endpoint. Same dark-launch posture as the
   * exposure badges above: absent on every doc until that pipeline lands,
   * so a job with no field (or `0`) renders no "reported" chip — never a
   * fabricated one.
   */
  report_count?: number | null;
  /**
   * Per-hit provenance from a federated tiered-retrieval pass
   * (`runTieredRetrieval`, meilisearch.ts): 1 = strict-scope query
   * (title/company/tags), 2 = whole-document query. Derived from that hit's
   * own `_federation.queriesPosition` (0 → 1, 1 → 2) before `_federation` is
   * stripped off the wire shape — the seam between tiers is placed from this
   * field, never from a carried count, so it survives client-side filtering
   * (e.g. "hide viewed") without drifting onto the wrong row. Undefined under
   * every non-federated search mechanism.
   */
  tier?: 1 | 2;
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

/** Facet keys exposed for faceted filtering (must be a subset of the Meili filterableAttributes).
 *  `location_city`/`location_state` are FACETABLE (filterable via ?city=/?state=,
 *  url-state.ts, and picked from the location typeahead) but never reach
 *  `buildFilter`'s generic per-key loop directly — `resolveLocationFacet`
 *  (query-understanding.ts) always strips them into `places` first, same as
 *  `location_country` already is, so they're never REQUESTED_FACET_KEYS
 *  below either (no checkbox UI reads their distribution). */
export const FACETABLE_KEYS = [
  "work_type",
  "experience_level",
  "employment_type",
  "ghost_badge",
  "visa_sponsorship",
  "location_country",
  "location_city",
  "location_state",
  "source",
  "tech_stack",
  "must_have_skills",
] as const;
export type FacetKey = (typeof FACETABLE_KEYS)[number];

/** The subset of FACETABLE_KEYS the client actually consumes per search —
 *  either as a generic FacetGroup (work_type/experience_level/employment_type/
 *  location_country/tech_stack/must_have_skills, SerpFilters.tsx) or a
 *  bespoke reader of its own facet values (ghost_badge → the ghost-hide
 *  count; visa_sponsorship → the sparse-filter honesty caption). `source` is
 *  FACETABLE (filterable via ?src=, url-state.ts) but never rendered, and
 *  MCP's search_jobs `facets` input does NOT accept it either (it's keyed to
 *  `PANEL_FACET_KEYS` below, a narrower set) — requesting its distribution on
 *  every search computes a count nothing reads. The per-search Meilisearch
 *  `facets:` request (buildSearchBody, meilisearch.ts) asks for exactly this
 *  list, not the full FACETABLE_KEYS. */
export const REQUESTED_FACET_KEYS = [
  "work_type",
  "experience_level",
  "employment_type",
  "ghost_badge",
  "location_country",
  "visa_sponsorship",
  "tech_stack",
  "must_have_skills",
] as const satisfies readonly FacetKey[];

/** `REQUESTED_FACET_KEYS` entries that get their OWN bespoke boolean control
 *  on the web filter panel (ghost_badge → the ghost-hide count;
 *  visa_sponsorship → the sparse-filter honesty caption) rather than the
 *  generic checkbox picker — named once here so `PANEL_FACET_KEYS` can
 *  derive "every requested key except these" instead of a second hand-typed
 *  subset that could silently drift from `REQUESTED_FACET_KEYS`. */
export const GATED_FACET_KEYS = ["ghost_badge", "visa_sponsorship"] as const satisfies readonly FacetKey[];

/** The subset of REQUESTED_FACET_KEYS the web filter panel renders as a
 *  generic checkbox picker (`<FacetGroup facetKey=...>`, SerpFilters.tsx) —
 *  derived as REQUESTED_FACET_KEYS minus GATED_FACET_KEYS so adding a key to
 *  REQUESTED_FACET_KEYS can never silently leave this list stale. The ONE
 *  source both surfaces derive from: MCP's search_jobs `facets` input takes
 *  its allowed keys here (agent/mcp-tool-specs.ts, tools.ts) and
 *  SerpFilters.tsx's `FacetGroup` types its `facetKey` prop as
 *  `PanelFacetKey`, so a panel group outside this set fails typecheck. */
export const PANEL_FACET_KEYS = REQUESTED_FACET_KEYS.filter(
  (key): key is Exclude<(typeof REQUESTED_FACET_KEYS)[number], (typeof GATED_FACET_KEYS)[number]> =>
    !(GATED_FACET_KEYS as readonly string[]).includes(key),
);
export type PanelFacetKey = (typeof PANEL_FACET_KEYS)[number];

/** Per-facet value→count, for rendering filter options with live counts. */
export type FacetDistribution = Partial<Record<FacetKey, Record<string, number>>>;

/** Explicit sort choice. Omitted = auto (newest with no query, relevance with a query). */
export const JOB_SORT_MODES = ["newest", "relevance", "salary_desc"] as const;
export type JobSortMode = (typeof JOB_SORT_MODES)[number];

/** Age-bucket filter, computed against sanitized `posted_ts` at request time.
 *  Each "Nd" bucket means "posted within the last N days"; "older" means
 *  posted before the widest window ("90d", the fresh-visit default). */
export type PostedBucket = "1d" | "3d" | "7d" | "30d" | "90d" | "older";

/**
 * Minimum-years-of-experience bucket, filtered against `min_years_experience`
 * (Subspace enrichment — see `PublicJob.min_years_experience`). Buckets from
 * the live corpus distribution measured 2026-08-26: 0-2 (36,157 jobs), 3-5
 * (43,093), 6-10 (22,136), 11+ (12,097). Unlike `PostedBucket`, there is no
 * default bucket a fresh visit lands on — `undefined` is both "no filter" and
 * the pristine state (see `FilterPanel.PRISTINE_FILTER_STATE`), since backfill
 * coverage (~47% of the corpus) means the field is still draining in.
 */
export const YEARS_EXPERIENCE_BUCKETS = ["0-2", "3-5", "6-10", "11+"] as const;
export type YearsExperienceBucket = (typeof YEARS_EXPERIENCE_BUCKETS)[number];

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
   * Fields in this request that hold the fresh-visit default nobody chose
   * (`SEARCH_DEFAULTS`). The understanding stages treat them as unset, so a
   * typed "posted this week" can replace them; whatever no stage sets keeps
   * the default, so a plain browse searches exactly as before.
   */
  defaultedFields?: readonly DefaultedField[];
  /**
   * Restrict to jobs whose `min_years_experience` falls in this bucket — OR
   * that lack the field entirely (see `buildFilter`'s composed clause,
   * meilisearch.ts). The missing-field union is REQUIRED, not an edge case:
   * backfill coverage is ~47% and draining, so a bare range clause would
   * silently hide the majority of the corpus from every bucket.
   */
  yearsExperience?: YearsExperienceBucket;
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
   *
   * Location-filter resolution (`preferStrictCity`, resolve-place.ts) drops
   * a country-only alternative when a city clause is present; `buildFilter`
   * still ORs the clauses it receives, which is why free-text query mentions
   * stay OR'd.
   */
  places?: PlaceClause[];
  /**
   * Typed location text that named nothing this corpus can filter on —
   * neither the gazetteer's resolution nor a literal probe found a corpus
   * value for it (see `resolveLocationFacet`, query-understanding.ts). That
   * covers text that is no place at all AND a real place the corpus has no
   * rows for (a résumé in Iceland). Populated instead of silently keeping the
   * raw text as a doomed exact-facet predicate (the "North America" bug — a
   * real phrase, but the corpus has no row spelled that way, so the search
   * could only ever return zero). Surfaced to the searcher as a plain-
   * language notice (see `unmatchedPlaceNote`, result-state.ts) rather than
   * silently dropped, and it still counts as the searcher having said where
   * (`hasLocationSignal`, ip-default.ts), so the IP default never replaces it.
   * A For-you pack, whose location is an eligibility filter, reads a dropped
   * location as zero roles there (`locationDropped`, broaden.ts).
   */
  unmatchedPlaceMentions?: string[];
  /**
   * Typed fragments the LLM stage (`applyLlmUnderstanding`) could not turn into
   * a filter, plus anything it was told to exclude. A different fact from
   * `unmatchedPlaceMentions` (that one is place words the corpus lacks and
   * suppresses the IP default); this is "we searched without this", surfaced
   * by `unmatchedQueryNote` (result-state.ts), never dropped silently.
   */
  unmatchedQueryMentions?: string[];
  limit?: number;
  offset?: number;
  /** Request facet distributions (counts per value) to drive the filter UI. */
  withFacets?: boolean;
  /** Restrict to jobs at companies on a curated board allowlist. */
  board?: BoardId;
  /** Restrict to jobs at a single company domain (exact match). */
  companyDomain?: string;
  /** Restrict to jobs at one of several company domains (employer-intent pin). */
  companyDomains?: string[];
  /**
   * Alternate Rank / fit role phrases to retrieve as a union (one Meili query
   * per phrase). When omitted, `searchMeili` parses a quoted-OR `q`
   * (`"Title A" OR "Title B"`). Do not AND these together.
   */
  fitPhrases?: string[];
  /**
   * A lookup the Velai browser extension's on-page card made on its own when
   * a job page loaded, not a search a person typed. Searched the same way;
   * only left out of the search log (`shouldLogSearch`).
   */
  automatic?: boolean;
  /**
   * A search Velai built from the person's résumé (Rank by fit, a For you
   * pack, Today, a pack's counts): its query is role titles taken from the
   * résumé. Searched the same way; left out of the search log
   * (`shouldLogSearch`) so `search_events` never holds words from a résumé.
   */
  fromResume?: boolean;
  /**
   * Leave out roles that rank past Senior (Staff, Principal, Director, Head of, VP, Chief, or listed
   * Executive; `titlePastSenior`) before the list is cut to a page, so a résumé-built list fills with
   * roles the person can take instead of spending its first rows on ones that are a rung above them
   * (Vivek, 2026-10-14). Set for a person whose résumé shows no such role. Applied where the search
   * pools a résumé's phrase lanes (`fit-phrases.ts`), never to a query someone typed; a single-phrase
   * search is trimmed when it is ranked (`orderForYouJobsByBand`).
   */
  omitPastSenior?: boolean;
  /**
   * Short phrases from the résumé's skills (`contentPhrasesFor`, jobs/for-you/content-phrases.ts) a
   * résumé-built search also looks for in a posting's whole text, whatever its title says, so a role with a
   * title the résumé does not name but a description it covers is in the pool (`fetchContentLaneHits`,
   * meilisearch.ts). Used only with `fromResume`; carries a few skill words, never lines, names or contact
   * details, and is not logged.
   */
  contentPhrases?: string[];
  /**
   * With `contentPhrases`: also pool remote roles that name no country (the country filter leaves them out
   * of every other lane), last in the pool. Set by the For you deck and the agent's `for_you`, which list
   * them last with their caveat; Today and the daily picks leave them out and do not ask.
   */
  unplacedRemote?: boolean;
  /**
   * The browser holds a résumé and scores these rows against it: attach each
   * row's description terms (`jd_terms`, jd-terms.ts) so a list chip scores
   * the whole posting, as the role's own page does. Implied by `fromResume`.
   * Carries nothing from the résumé.
   */
  jdTerms?: boolean;
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
  /**
   * Work modes that apply to THIS place only, AND-ed into the clause.
   *
   * Set when a work-mode word was typed as part of a place phrase ("remote
   * canada"). Binding it here rather than merging into the global
   * `work_type` facet is what makes two places with different work modes
   * expressible: `["remote canada", "hybrid united states"]` renders as
   * `((Canada AND remote) OR (US AND hybrid))`, where a global facet could
   * only say `(remote OR hybrid) AND (Canada OR US)` — which also returns
   * remote US roles nobody asked for.
   *
   * A work mode chosen in the Work-mode dropdown stays in the global facet
   * and still AND's across the whole query; the two are different questions
   * ("remote anywhere" vs "remote in Canada") and both remain askable.
   */
  workTypes?: string[];
  /**
   * OR untagged remote roles into this clause's `any` group — exactly
   * `REMOTE_ANYWHERE_CLAUSE` (meilisearch.ts): remote, and no country, city
   * or state at all. A remote role naming a city or state with no country
   * is missing its country tag, not open anywhere, so it is not OR'd in.
   *
   * Set ONLY by the IP geo default (`resolveLocationDefault`,
   * `placesForCountry`, ip-default.ts). An explicit country pick
   * (`?country=Canada`, a typed location box commit) never sets this — the
   * searcher can add a Remote work-mode chip themselves. `placeClause`
   * (geo/resolve-place.ts) is the ONE builder; `renderPlaceClause`
   * (meilisearch.ts) is the only reader.
   */
  remoteAnywhere?: true;
  /**
   * The place as the searcher would type it ("Canada", "Toronto"), set only
   * on clauses the query-understanding stages read out of free text. The
   * client re-submits it as a location facet so the place shows up as an
   * ordinary removable chip (see `diffUnderstood`, understood.ts).
   */
  label?: string;
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
  /** Time the search engine reported spending on this result (Meilisearch's
   *  `processingTimeMs`, summed over `engineCalls` requests). Set on the plain
   *  search path only; the rest of a caller's wait is the trip to the engine. */
  engineMs?: number;
  engineCalls?: number;
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
  /** Set only when an inferred company-name query scoped to zero hits and the
   *  search fell back to the unscoped result (see `searchMeili`'s
   *  `runWithIntent` retry). `domains` are the probed employer domains the
   *  scoped pass pinned to; `scopedTotal` is always 0 (the trigger). */
  companyIntent?: { domains: string[]; scopedTotal: number; fallback: boolean };
  /**
   * Strict-scope-only count for a tiered-retrieval result (see
   * `runTieredRetrieval` in meilisearch.ts): how many of `total`'s
   * whole-document pool matched under the tight title/company/tags scope.
   * This is the seam a client uses to rank/label those hits ahead of the
   * mention-only remainder — a server-computed replacement for the old
   * client-side re-derivation (`firstMentionIndex`/`partitionByTitleMatch`)
   * that reshuffled under an explicit sort. Absent on every other path.
   */
  tier1Total?: number;
  /**
   * Employer search with a place asked for: how many of the leading rows (of
   * `total`) sit in that place. The rows after them are the same employer
   * elsewhere, listed after the place runs out. Absent when no place was asked
   * for or the search is not scoped to an employer (see `assembleCompanyLanePool`).
   */
  inPlace?: number;
}
