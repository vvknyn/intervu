/**
 * The exact set of `PublicJob` document fields `src/lib/telemetry/features.ts`
 * reads (see that file — every field there is a dotted `job.<name>` access,
 * never a destructure). `scripts/build-job-features.ts`'s `fetchJobsPage()`
 * passes this list as Meili's `&fields=` param on `GET
 * /indexes/jobs/documents` so the nightly job-features build doesn't pull the
 * ~20 other `PublicJob` fields (location, salary_currency, tags, ghost_badge,
 * company aggregates, ...) over the wire for every document in the walk —
 * see that function's doc comment for the measured wire savings.
 *
 * Kept from drifting out of sync with the extractor by
 * `tests/unit/job-document-fields.test.ts`, which parses `features.ts`'s
 * source for every `job.<field>` reference and asserts it matches this list
 * exactly, in both directions — a field silently missing here would come
 * back `null` forever under the `&fields=` projection, and a field silently
 * left in here buys back none of the wire savings it exists for.
 */
import type { PublicJob } from "@/lib/jobs/types";

export const JOB_DOCUMENT_FIELDS: readonly (keyof PublicJob)[] = [
  "id",
  "title",
  "description",
  "employment_type",
  "first_seen_at",
  "min_years_experience",
  "posted_at",
  "salary_max",
  "salary_min",
  "source",
  "tech_stack",
  "work_type",
];
