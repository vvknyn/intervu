-- One-time repair, NOT part of the regular schema pipeline.
--
-- `intervu.telemetry_events` already existed on prod as of 2026-09-03 with a
-- shape that predates the telemetry spec — no `event_id`, no unique
-- constraint on it, `event` instead of `event_name`, text instead of uuid
-- session_id/visitor_id, an extra `dwell_ms` column, plain btree indexes
-- instead of the spec's BRIN + partials, and a leftover agent_pg=arwd grant.
-- It has 0 rows, and no writer of that shape exists anywhere in the intervu
-- or subspace repos — it is an unused orphan, not live data. Because
-- deploy/db-box/telemetry-schema.sql's table DDL is `create table if not
-- exists`, running that file against this orphan is a silent no-op: it
-- reports success and leaves the wrong table in place while every telemetry
-- insert starts failing behind the ingest route's catch-and-204.
--
-- This script's only job is to remove that orphan so telemetry-schema.sql
-- can create the correct table in its place. Run it ONCE, then run
-- telemetry-schema.sql IMMEDIATELY AFTER — this script does not create
-- anything.
--
-- Safe by construction, not safe because someone checked once: every guard
-- below is a `raise exception`, there is no force flag, and re-running this
-- script in a month against a table that has since accumulated real rows —
-- orphan or not — must refuse just as hard as it does today.
--   1. refuses if intervu.telemetry_events does not exist (nothing to do).
--   2. refuses if it holds ANY row, unconditionally — this is the guard
--      that has to keep working after everyone has forgotten this script
--      exists.
--   3. refuses if it already has an event_id column — that shape is the
--      CORRECT, spec'd table, not the orphan, and dropping it would destroy
--      the real ledger rather than clean up dead weight.
-- Only when all three pass does it drop the table.
do $$
declare
  live_row_count bigint;
begin
  if to_regclass('intervu.telemetry_events') is null then
    raise exception 'intervu.telemetry_events does not exist — nothing to repair. Not running telemetry-schema.sql from here either; there is nothing this script needed to clear out of its way.';
  end if;

  select count(*) into live_row_count from intervu.telemetry_events;
  if live_row_count > 0 then
    raise exception 'intervu.telemetry_events has % row(s) — refusing to drop a table that holds data, orphan shape or not. Investigate before doing anything else; do not re-run this with a force flag, there isn''t one.', live_row_count;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'intervu'
      and table_name = 'telemetry_events'
      and column_name = 'event_id'
  ) then
    raise exception 'intervu.telemetry_events already has an event_id column — this looks like the CORRECT, spec''d table, not the pre-spec orphan. Refusing to drop it.';
  end if;

  drop table intervu.telemetry_events;
  raise notice 'Dropped the orphan intervu.telemetry_events (0 rows, no event_id column). Run telemetry-schema.sql now to create the correct table.';
end
$$;
