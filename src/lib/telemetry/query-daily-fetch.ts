/**
 * Fetch layer for `scripts/backfill-query-daily.ts`, split out of the
 * script for the same reason `rollup-fetch.ts` is split out of
 * `roll-up-telemetry.ts`: a `Queryable`-typed function can be driven by a
 * fake `{ query }` in a unit test, which a raw `pg.Client` cannot.
 *
 * Reads `intervu.search_events` / `intervu.search_opens` — the
 * Firestore-mirrored output of the OLDER search-log system
 * (`src/lib/jobs/search-log.ts`, `deploy/db-box/intervu-schema.sql`), not
 * the newer client ledger (`intervu.telemetry_events`)
 * `roll-up-telemetry.ts` reads. That distinction is the whole reason this
 * script can populate `query_daily` where the nightly rollup still can't —
 * see that script's own updated module doc.
 *
 * `q` is raw user search text. This module aggregates it
 * (`lower(btrim(...))`, joined/counted in SQL) but never selects it back out
 * verbatim, and nothing downstream (the pure aggregator, the backfill
 * script's dry-run report, its heartbeat) ever logs a sample value — only
 * counts.
 *
 * ONE ROW PER TYPED SEARCH, not one row per (search, open) pair: the
 * `count(o.path)` aggregate below folds every matching `search_opens` row
 * into a single `open_count` per search, grouped on `s.search_id`.
 *
 * That grouping key is load-bearing and its safety is a property of the
 * DATA, not of this SQL, so it is measured rather than asserted. On the
 * mirror as of 2026-09-04: 4,164 typed rows, 4,164 distinct `search_id`,
 * zero NULL, zero ids appearing more than once — a 1:1 shape, no fan-out.
 * Re-check before trusting a re-run against a re-copied mirror:
 *
 *   select count(*), count(distinct search_id),
 *          count(*) filter (where search_id is null)
 *   from intervu.search_events where btrim(doc->>'q') <> '';
 *
 * Both ways this can break are SILENT, which is why the check is written
 * out here: `group by` treats all NULLs as one group, so NULL ids would
 * collapse many searches into a single row (undercounting `searches` with
 * no error), and duplicate ids would merge distinct searches the same way.
 * Neither raises; both just return a smaller number. `count(o.path)` — not
 * `count(*)` — is the matching deliberate choice on the join side: under a
 * LEFT JOIN, `count(*)` scores an unmatched search as one open.
 * `aggregateQueryDaily` (query-daily.ts) is what turns `open_count > 0`
 * into "one click-through" — this layer's job is only to hand it a
 * per-search open count, not to decide what counts as a click-through.
 *
 * DAY BUCKETING: `created_at` (search_events/search_opens) is a Firestore
 * `Timestamp.toISOString()` string — always UTC, always 'Z'-suffixed
 * (verified: casts unambiguously to `timestamptz` regardless of session
 * TimeZone). The DAY BOUNDARY is bucketed in UTC via `derived-day.ts`'s
 * shared `utcDayColumnSql` — the same helper `rollup-fetch.ts` uses for
 * `job_daily`/`company_daily` — not this database server's session-default
 * `timezone` GUC (`Europe/Berlin` on this box). That is a corrected bug,
 * not a style choice: an earlier version of this file bucketed on
 * `Europe/Berlin` because that number (786 distinct pairs) was handed down
 * as the reconciliation target; the target itself was wrong, derived with
 * a bare `::date` cast that silently inherited the session timezone.
 * `rollup-fetch.ts`'s `day` columns are UTC by construction (its own
 * module doc), so a Berlin `query_daily.day` would put this table on a
 * different definition of "day" than the other two in the same derived
 * layer, misaligning any cross-table join at every day boundary.
 * Measured evidence, both directions: on the same 4,164 typed searches,
 * Berlin bucketing produces 786 distinct (query_normalized, day) pairs,
 * UTC produces 793 (verified 2026-09-04) — the 7-pair delta sits entirely
 * at instants in the 22:00-24:00 UTC hour, where Berlin has already
 * rolled into the next calendar day (see derived-day.ts's module doc for
 * a literal boundary-instant cross-check against Postgres).
 */
import type { Queryable } from "@/lib/pg/pool";
import type { QueryDailyEventRow } from "./query-daily";
import { utcDayColumnSql } from "./derived-day";

export async function fetchQueryDailyEvents(db: Queryable): Promise<QueryDailyEventRow[]> {
  const { rows } = await db.query<QueryDailyEventRow>(
    `select
       lower(btrim(s.doc->>'q')) as query_normalized,
       ${utcDayColumnSql("s.created_at::timestamptz")} as day,
       (s.doc->>'resultCount')::int as result_count,
       count(o.path)::int as open_count
     from intervu.search_events s
     left join intervu.search_opens o on o.search_id = s.search_id
     where btrim(s.doc->>'q') <> ''
     group by s.search_id, query_normalized, day, result_count`,
  );
  return rows;
}
