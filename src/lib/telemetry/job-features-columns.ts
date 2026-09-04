/**
 * Single source of truth for the `intervu.job_features` column list, shared
 * by `scripts/build-job-features.ts` (writes it) and
 * `scripts/roll-up-telemetry.ts` (reads it back to bucket feature outcomes).
 * `satisfies` fails to compile the moment `JobFeatures` gains or drops a
 * field without this list moving with it, so the two scripts can never
 * silently drift from the extractor or from each other.
 */
import type { JobFeatures } from "./features";

const JOB_FEATURES_COLUMN_SET = {
  job_id: true, computed_at: true,
  description_chars: true, bullet_count: true, paragraph_count: true, section_count: true,
  requirement_count: true, responsibility_count: true, title_chars: true, title_word_count: true,
  has_salary: true, salary_min: true, salary_max: true, salary_span_pct: true,
  has_equity_mention: true, has_benefits_section: true, benefit_count: true,
  has_visa_statement: true, has_eeo_boilerplate: true,
  years_experience_min: true, degree_required: true, degree_level: true,
  named_tech_count: true, has_nice_to_have_section: true,
  seniority_word: true, is_remote: true, is_hybrid: true, is_onsite: true, employment_type: true,
  apply_method: true, screening_question_count: true, ats_provider: true,
  first_seen_at: true, posted_at: true, repost_count: true, days_open: true,
} satisfies Record<keyof JobFeatures, true>;

export const JOB_FEATURES_COLUMNS = Object.keys(JOB_FEATURES_COLUMN_SET) as (keyof JobFeatures)[];

/**
 * Postgres `numeric` columns come back from node-pg as JS strings by
 * default (avoiding float precision loss), while `integer`/`boolean`
 * columns come back as native JS types. These four are `numeric` in the
 * DDL (deploy/db-box/telemetry-derived.sql) — any SELECT that reads
 * `job_features` back into a `JobFeatures` object MUST cast exactly these
 * to `::float8`, or a generic `typeof value === "string"` check downstream
 * (`bucketFeatureValue` in feature-outcomes.ts) would misclassify a salary
 * amount as a categorical string bucket instead of a numeric one.
 */
export const JOB_FEATURES_NUMERIC_COLUMNS: readonly (keyof JobFeatures)[] = [
  "salary_min",
  "salary_max",
  "salary_span_pct",
  "years_experience_min",
];

/**
 * The opposite-direction coercion gotcha: `timestamptz` columns come back
 * from node-pg as native JS `Date` objects, while `JobFeatures` declares
 * them as ISO strings (matching `PublicJob`/`extractJobFeatures`'s own
 * shape, written via `toISOString()` — see `features.ts`). Any SELECT that
 * reads `job_features` back into a `JobFeatures` object must format these
 * to actually match that shape: a bare `::text` cast does NOT produce
 * ISO-8601 — it renders Postgres's own text form (session-`DateStyle`
 * dependent, space-separated, numeric UTC offset, e.g.
 * `2026-09-04 09:41:11.639+02`), which round-trips as a different string
 * than the `...639Z` the write side emits. `TIMESTAMP_ISO_CAST` below
 * builds the `to_char(... AT TIME ZONE 'UTC', ...)` expression that
 * produces the exact `toISOString()` shape instead (verified
 * DateStyle/timezone-GUC independent). None of these three are ever
 * bucketed as a feature (see `EXCLUDED_FEATURE_COLUMNS` in
 * feature-outcomes.ts), but a value typed `string` that isn't actually
 * ISO-8601 is still a lie the type checker can't catch across a `pg`
 * client boundary.
 */
export const JOB_FEATURES_TIMESTAMP_COLUMNS: readonly (keyof JobFeatures)[] = [
  "computed_at",
  "first_seen_at",
  "posted_at",
];

/** Builds the `to_char` expression that reads one `timestamptz` column back
 *  as the exact ISO-8601 UTC string `toISOString()` produces (e.g.
 *  `2026-09-04T07:41:11.639Z`) — DateStyle/timezone-GUC independent, since
 *  `to_char`'s format template is explicit rather than session-driven. */
function timestampIsoCast(col: string): string {
  return `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/**
 * Pure: given the distinct job_ids a caller actually needs, builds the
 * parameterized SELECT that reads back just those `job_features` rows,
 * with the same numeric/timestamp casts every reader of this table needs
 * (see the two column lists above). `job_id` is job_features' primary key,
 * so `= any($1::text[])` is an index lookup, not a full-table scan. No DB
 * handle involved, so the SQL shape is unit-testable on its own. Lives
 * here (not in `scripts/roll-up-telemetry.ts`, its only caller) so the
 * shape stays covered by this module's own `satisfies` guarantee and
 * doesn't require type-checking the rest of that script — `scripts/` is
 * excluded from the tsconfig project.
 */
export function buildJobFeaturesSelect(jobIds: readonly string[]): { text: string; params: unknown[] } {
  const selectList = JOB_FEATURES_COLUMNS.map((col) => {
    if (JOB_FEATURES_NUMERIC_COLUMNS.includes(col)) return `${col}::float8 as ${col}`;
    if (JOB_FEATURES_TIMESTAMP_COLUMNS.includes(col)) return `${timestampIsoCast(col)} as ${col}`;
    return col;
  }).join(", ");
  return {
    text: `select ${selectList} from intervu.job_features where job_id = any($1::text[])`,
    params: [jobIds],
  };
}
