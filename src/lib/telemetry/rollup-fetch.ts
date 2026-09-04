/**
 * Raw-event fetch layer for `scripts/roll-up-telemetry.ts`'s two rollup
 * windows — see that script's module doc for why `job_daily`/`company_daily`
 * (short, `--window-days`) and `feature_outcomes` (full retention,
 * `--feature-window-days`) read different-length windows.
 *
 * Pulled out of the script into this module for the same reason
 * `job-features-columns.ts`'s `buildJobFeaturesSelect` is: a
 * `Queryable`-typed function (`src/lib/pg/pool.ts`) can be driven by a fake
 * `{ query }` in a unit test with no live database, which a `pg.Client`
 * parameter cannot — same pattern `writeHeartbeat` uses.
 */
import type { Queryable } from "@/lib/pg/pool";
import type { DailyEventRow } from "./daily-rollup";
import { RESULTS_IMPRESSED } from "./outcome-events";

export interface WindowImpressionRow {
  day: string;
  job_id: string;
  position: number;
}

/**
 * Parses `--<flagName>=N` out of `argv`, defaulting to `defaultDays` when
 * absent, and validates it is a positive finite number — the one rule both
 * `--window-days` and `--feature-window-days` must satisfy. One exported
 * validator rather than two copies of the same `if` that could drift.
 * Throws loudly (never returns a sentinel like the default) so an invalid
 * flag aborts the job instead of silently rolling up a bogus window.
 */
export function resolveWindowDays(argv: readonly string[], flagName: string, defaultDays: number): number {
  const prefix = `--${flagName}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  const days = arg ? Number(arg.slice(prefix.length)) : defaultDays;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`--${flagName} must be a positive number, got ${arg}`);
  }
  return days;
}

// Day-bucketing happens here, in SQL, not in JS Date math — avoids
// timezone bugs; see daily-rollup.ts's module doc. Filters and buckets on
// `received_at`, not the client-clock `occurred_at`: `received_at` is the
// column the ledger's only time-range index covers
// (telemetry_events_received_brin, telemetry-schema.sql) and is
// server-clock-authoritative, while `occurred_at` is untrusted client input
// merely clamped to a 24h skew window at ingest (ingest.ts).
//
// Affordable at the wide (90d) end too: `telemetry_events_received_brin` is
// a BRIN index over exactly this column, so the range scan behind this
// predicate costs about the same as the sequential read it fundamentally
// is, whether the window is 2 days or 90. If the raw ledger ever outgrows
// that, the scaling seam is the JS-side aggregation downstream of this
// (`aggregateDailyMetrics` / `aggregateFeatureOutcomes`), not this query.
//
// The lower bound is snapped to a UTC calendar-day boundary
// (`date_trunc('day', now(), 'UTC')`), not a raw `now()` instant:
// `--window-days=N` means TODAY SO FAR plus N previous WHOLE days, never a
// partially-covered oldest day. The upsert this feeds REPLACES each day's
// row outright (never `count = count + n`, telemetry-derived.sql), so a
// bound that lands mid-day would permanently discard that day's
// already-ingested hours on every single run, not just the first. The
// three-arg `date_trunc(..., 'UTC')` form is required, not
// `now() at time zone 'utc'`: the latter returns a NAIVE timestamp that
// gets compared in the session's own timezone (Europe/Berlin on the box),
// silently reintroducing a multi-hour version of the same truncation.
export async function fetchWindowEvents(db: Queryable, windowDays: number): Promise<DailyEventRow[]> {
  const { rows } = await db.query<DailyEventRow>(
    `select
       event_name,
       to_char(received_at at time zone 'utc', 'YYYY-MM-DD') as day,
       job_id,
       company_domain,
       position
     from intervu.telemetry_events
     where received_at >= date_trunc('day', now(), 'UTC') - make_interval(days => $1)`,
    [windowDays],
  );
  return rows;
}

/**
 * `results_impressed` rows carry no scalar `job_id`/`position` — see
 * roll-up-telemetry.ts's "PARALLEL ARRAYS" module-doc note. This unnests
 * `props->'job_ids'` and `props->'positions'` per event, zipped by their
 * shared ordinality (`WITH ORDINALITY` on each, joined on that ordinal —
 * the standard way to zip two JSONB arrays in Postgres), into one
 * impression row per array entry. An event whose `props` is missing either
 * key contributes zero rows (a set-returning function over a NULL jsonb
 * value returns no rows), not a crash or a fabricated pairing.
 *
 * Lower bound is snapped to a UTC day boundary for the same reason and in
 * the same way as `fetchWindowEvents` above — see that function's comment.
 */
export async function fetchWindowImpressions(
  db: Queryable,
  windowDays: number,
): Promise<WindowImpressionRow[]> {
  const { rows } = await db.query<WindowImpressionRow>(
    `select
       to_char(e.received_at at time zone 'utc', 'YYYY-MM-DD') as day,
       job_ids.value as job_id,
       (positions.value)::int as position
     from intervu.telemetry_events e,
       lateral jsonb_array_elements_text(e.props->'job_ids') with ordinality as job_ids(value, ord),
       lateral jsonb_array_elements_text(e.props->'positions') with ordinality as positions(value, ord)
     where e.event_name = $2
       and e.received_at >= date_trunc('day', now(), 'UTC') - make_interval(days => $1)
       and job_ids.ord = positions.ord`,
    [windowDays, RESULTS_IMPRESSED],
  );
  return rows;
}

/** Unnested impressions carry no company_domain (see roll-up-telemetry.ts's
 *  module-doc GAP note) — every synthetic row is honestly null on that
 *  field, same as any other event type that never stated one. */
export function toImpressionEventRows(rows: readonly WindowImpressionRow[]): DailyEventRow[] {
  return rows.map((row) => ({
    event_name: RESULTS_IMPRESSED,
    day: row.day,
    job_id: row.job_id,
    company_domain: null,
    position: row.position,
  }));
}

/** Scalar events + unnested impressions for one trailing window, merged
 *  into the single event list both `aggregateDailyMetrics` and
 *  `toFeatureOutcomeEvents` consume. */
export async function fetchWindowDailyEvents(db: Queryable, windowDays: number): Promise<DailyEventRow[]> {
  const scalarEvents = await fetchWindowEvents(db, windowDays);
  const impressionEvents = toImpressionEventRows(await fetchWindowImpressions(db, windowDays));
  return [...scalarEvents, ...impressionEvents];
}

/**
 * Resolves both windows the rollup needs. `job_daily`/`company_daily` read
 * `windowDays`; `feature_outcomes` reads `featureWindowDays` — see
 * roll-up-telemetry.ts's module doc for why those are different numbers.
 * When they happen to be equal, the already-fetched rows are reused
 * instead of issuing a second, identical pair of queries for the same
 * range.
 */
export async function fetchRollupEvents(
  db: Queryable,
  windowDays: number,
  featureWindowDays: number,
): Promise<{ dailyEvents: DailyEventRow[]; featureEvents: DailyEventRow[] }> {
  const dailyEvents = await fetchWindowDailyEvents(db, windowDays);
  const featureEvents =
    featureWindowDays === windowDays ? dailyEvents : await fetchWindowDailyEvents(db, featureWindowDays);
  return { dailyEvents, featureEvents };
}
