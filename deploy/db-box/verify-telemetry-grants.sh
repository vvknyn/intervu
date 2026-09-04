#!/usr/bin/env bash
# Proves the telemetry_pg / agent_pg grants from telemetry-schema.sql
# actually hold, and that the reaper writes a heartbeat. Run this AFTER
# applying deploy/db-box/telemetry-schema.sql.
#
# Connection details come from the environment ONLY — never argv, since a
# credential in argv is visible to every other process on the box via `ps`:
#
#   TELEMETRY_PG_URL   connects AS telemetry_pg (the ingest role)
#   AGENT_PG_URL       connects AS agent_pg (must have zero privilege here)
#   BATCH_PG_URL       connects as the table owner (`pipeline`) or a
#                      superuser — used only to run the reaper, read
#                      job_heartbeats, and clean up the one test row this
#                      script inserts. telemetry_pg cannot do that cleanup
#                      itself: it has no SELECT or DELETE, by design.
#
# Four checks, modeled on verify-firestore-load.sh's OK/FAIL-per-row shape:
#   1. telemetry_pg CAN insert.
#   2. telemetry_pg CANNOT select — a successful select here is the FAIL
#      condition: it means the grants are too wide.
#   3. agent_pg has no privilege on the table at all (select and insert
#      both denied) — the corrective revoke from telemetry-schema.sql §3.
#   4. `select intervu.reap_telemetry(90)` runs and leaves a fresh
#      job_heartbeats row.
#
# NOTE on check 4: this is a REAL reap against whatever database
# BATCH_PG_URL points at — it deletes any row older than the retention
# window, same as a live cron run would. Point BATCH_PG_URL at a throwaway
# database if you only want to exercise the mechanism.
#
# Exit code is non-zero if ANY check fails, so this is usable as a gate.
set -euo pipefail

: "${TELEMETRY_PG_URL:?set TELEMETRY_PG_URL (connects as telemetry_pg)}"
: "${AGENT_PG_URL:?set AGENT_PG_URL (connects as agent_pg)}"
: "${BATCH_PG_URL:?set BATCH_PG_URL (connects as the table owner, e.g. pipeline)}"

err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT

failed=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failed=1; }

# Runs a single statement over connection $1; true if it succeeds. Stderr
# lands in $err_file so callers can report why an *expected* success failed.
sql_ok() {
  psql "$1" -v ON_ERROR_STOP=1 -qAt -c "$2" >/dev/null 2>"$err_file"
}

echo "checking: telemetry_pg can insert into intervu.telemetry_events"
TEST_EVENT_ID="$(psql "$BATCH_PG_URL" -qAtc "select gen_random_uuid()")"
if sql_ok "$TELEMETRY_PG_URL" \
  "insert into intervu.telemetry_events (event_id, occurred_at, session_id, event_name) values ('${TEST_EVENT_ID}', now(), gen_random_uuid(), 'verify_test_event')"
then
  pass "telemetry_pg INSERT"
else
  fail "telemetry_pg INSERT — $(cat "$err_file")"
fi

echo "checking: telemetry_pg cannot select from intervu.telemetry_events"
if sql_ok "$TELEMETRY_PG_URL" "select 1 from intervu.telemetry_events limit 1"; then
  fail "telemetry_pg SELECT succeeded — grants are too wide"
elif grep -q "permission denied" "$err_file"; then
  pass "telemetry_pg SELECT denied"
else
  fail "telemetry_pg SELECT failed for the wrong reason — $(cat "$err_file")"
fi

echo "checking: agent_pg has no privilege on intervu.telemetry_events"
agent_clean=1
if sql_ok "$AGENT_PG_URL" "select 1 from intervu.telemetry_events limit 1"; then
  fail "agent_pg SELECT succeeded — revoke did not take"
  agent_clean=0
fi
if sql_ok "$AGENT_PG_URL" \
  "insert into intervu.telemetry_events (event_id, occurred_at, session_id, event_name) values (gen_random_uuid(), now(), gen_random_uuid(), 'verify_test_event')"
then
  fail "agent_pg INSERT succeeded — revoke did not take"
  agent_clean=0
fi
[[ "$agent_clean" -eq 1 ]] && pass "agent_pg SELECT and INSERT both denied"

echo "checking: intervu.reap_telemetry() runs and heartbeats"
pre_ts="$(psql "$BATCH_PG_URL" -qAtc "select now()")"
if sql_ok "$BATCH_PG_URL" "select intervu.reap_telemetry(90)"; then
  fresh="$(psql "$BATCH_PG_URL" -qAtc \
    "select (last_run_at > '${pre_ts}'::timestamptz and ok) from intervu.job_heartbeats where job_name = 'reap_telemetry'")"
  if [[ "$fresh" == "t" ]]; then
    pass "reap_telemetry heartbeat is fresh"
  else
    fail "reap_telemetry ran but job_heartbeats has no fresh row (got: '${fresh}')"
  fi
else
  fail "reap_telemetry() raised — $(cat "$err_file")"
fi

echo "cleaning up test row"
psql "$BATCH_PG_URL" -v ON_ERROR_STOP=1 -qAt \
  -c "delete from intervu.telemetry_events where event_id = '${TEST_EVENT_ID}'" >/dev/null

echo
if [[ "$failed" -eq 0 ]]; then
  echo "all grant checks pass"
else
  echo "GRANT MISMATCH — do not treat telemetry_pg as safe to deploy" >&2
fi
exit "$failed"
