-- MUTATES DATA — inside a transaction that is rolled back at the end, but
-- mutates nonetheless: this script INSERTs 4 rows into
-- intervu.telemetry_events and then calls intervu.reap_telemetry(90), which
-- DELETEs from that same table. Read the "WHY THE ROLLBACK IS TRUSTED"
-- paragraph below before assuming this is read-only.
--
-- WHAT THIS PROVES: that intervu.reap_telemetry(90)'s DELETE branch deletes
-- the RIGHT rows, not merely that it runs without error. Telemetry launched
-- 2026-09-04, so nothing in production is yet 90 days old — a green ok=t
-- heartbeat on reap_telemetry proves the function RUNS, not that its
-- retention cutoff is correct. This script inserts a controlled sample of 4
-- probe rows straddling the 90-day cutoff (200-days-old, 10-days-old,
-- 1-hour-inside-the-cutoff, 1-hour-outside-the-cutoff), calls
-- reap_telemetry(90) once, and checks two independent things: (1) the
-- function's own returned deleted-count, and (2) which probe rows, by name,
-- actually survived. Checking survivors by identity (not just a count)
-- means an over-deleting reaper fails exactly as loudly as a non-deleting
-- one — a count alone can't distinguish "deleted the wrong 2 rows" from
-- "deleted the right 2 rows."
--
-- WHY THE ROLLBACK IS TRUSTED: intervu.reap_telemetry is verified
-- prokind='f' — a plain plpgsql FUNCTION, not a PROCEDURE — so it cannot
-- issue its own COMMIT and cannot escape the enclosing begin;...rollback;
-- below. The final `rollback;` undoes both the INSERT and the DELETE; no
-- production row is altered if the script runs to completion. If the
-- script is interrupted before reaching `rollback;` (killed session,
-- connection drop), Postgres rolls back the open transaction on connection
-- close — but that fallback isn't exercised by a normal run, so don't rely
-- on it as the reason this is safe.
--
-- HOW TO RUN (against the telemetry DB, as the `pipeline` role that owns
-- intervu.telemetry_events — same connection convention as this
-- directory's other read/write checks, e.g. verify-telemetry-grants.sh):
--   psql "$BATCH_PG_URL" -f deploy/db-box/reaper-retention-proof.sql
begin;

insert into intervu.telemetry_events
  (event_id, occurred_at, session_id, event_name, received_at, props)
values
  (gen_random_uuid(), now(), gen_random_uuid(), 'reaper_probe_A_200d_old',
     now() - interval '200 days', '{}'),
  (gen_random_uuid(), now(), gen_random_uuid(), 'reaper_probe_B_10d_recent',
     now() - interval '10 days', '{}'),
  (gen_random_uuid(), now(), gen_random_uuid(), 'reaper_probe_C_inside_boundary',
     now() - interval '90 days' + interval '1 hour', '{}'),
  (gen_random_uuid(), now(), gen_random_uuid(), 'reaper_probe_D_outside_boundary',
     now() - interval '90 days' - interval '1 hour', '{}');

\echo '--- [verify-leg 1/2: the function''s OWN returned count] ---'
select intervu.reap_telemetry(90) as reaper_returned_deleted;

\echo '--- [verify-leg 2/2: independent mechanism -- surviving row IDENTITIES, not a count] ---'
\echo 'EXPECT exactly B and C to survive; A and D must be gone.'
select event_name,
       (now() - received_at) > interval '90 days' as was_older_than_cutoff
from intervu.telemetry_events
where event_name like 'reaper\_probe\_%'
order by event_name;

rollback;
\echo '--- rolled back: no production row was altered ---'
