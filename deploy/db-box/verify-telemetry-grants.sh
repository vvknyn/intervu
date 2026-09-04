#!/usr/bin/env bash
# Proves the telemetry_pg / agent_pg grants from telemetry-schema.sql
# actually hold, that the reaper writes a heartbeat, and that
# intervu.forget_telemetry_user (§7 — erasure for account deletion) is wired
# the way its SECURITY DEFINER design demands. Run this AFTER applying
# deploy/db-box/telemetry-schema.sql.
#
# Connection details come from the environment ONLY — never argv, since a
# credential in argv is visible to every other process on the box via `ps`:
#
#   TELEMETRY_PG_URL   connects AS telemetry_pg (the ingest role)
#   AGENT_PG_URL       connects AS agent_pg (must have zero privilege here)
#   BATCH_PG_URL       connects as the table owner (`pipeline`) or a
#                      superuser — used only to run the reaper, read
#                      job_heartbeats/pg_proc, and clean up the test rows
#                      this script inserts. telemetry_pg cannot do that
#                      cleanup itself: it has no SELECT or (bare) DELETE,
#                      by design.
#
# Checks, modeled on verify-firestore-load.sh's OK/FAIL-per-row shape:
#   1. telemetry_pg CAN insert.
#   2. telemetry_pg CANNOT select — a successful select here is the FAIL
#      condition: it means the grants are too wide.
#   3. telemetry_pg CANNOT delete — same reasoning, `where false` so even a
#      grant mistake can never touch a real row (Postgres checks table-level
#      DELETE privilege before the predicate is ever evaluated).
#   4. agent_pg has no privilege on the table at all (select and insert
#      both denied) — the corrective revoke from telemetry-schema.sql §3.
#   5. `select intervu.reap_telemetry(90)` runs and leaves a fresh
#      job_heartbeats row — guarded by size, see NOTE below.
#   6. intervu.forget_telemetry_user(text) exists, is SECURITY DEFINER,
#      owned by pipeline, and has search_path pinned.
#   7. PUBLIC cannot execute it.
#   8. telemetry_pg CAN execute it, and it genuinely deletes the target
#      user's row (both the returned count AND the row's absence are
#      checked — a count of 1 with the row still present is exactly the
#      bug this must catch).
#   9. A null/empty uid is refused, returns 0, and touches nothing.
#   Checks 7-9 are gated behind check 6: `to_regprocedure(...)` (not a
#   `::regprocedure` cast) is used everywhere the function's existence
#   matters, because a cast raises a hard error under this script's
#   `set -euo pipefail` when the function is absent — a different, uglier,
#   non-continuable failure than a clean FAIL line. If check 6 finds the
#   function missing, checks 7-9 are FAILed directly with the same reason
#   instead of running a query that would abort the whole script.
#
# NOTE on check 5 (reap_telemetry): `intervu.reap_telemetry()` issues its
# DELETE as one statement in one transaction — telemetry_schema.sql §7 says
# plainly that this is fine for erasure (bounded to one account's rows) but
# NOT fine for retention sweeps at scale, which is exactly why
# scripts/reap-telemetry.ts exists as a separately-committed, batched
# alternative and that script's own header says reap_telemetry() is
# otherwise never called in production. This script's original context was
# an empty/fresh table, where the unbatched call is harmless — but this is
# a gate people re-run, and against a BATCH_PG_URL with months of real
# telemetry history, this check would become the ONLY unbatched delete ever
# run against the highest-write table in the system. So: count what the
# function would touch first (a bounded BRIN range scan on
# telemetry_events_received_brin, not a full scan — a read carries no
# lock/WAL risk) and only call the function directly when that count is at
# or under REAP_VERIFY_MAX_ROWS (default 5000, chosen to match
# scripts/reap-telemetry.ts's own BATCH_SIZE — the per-transaction bound
# that script already treats as safe for this table; keep the two numbers
# in sync by hand, they are not read from a shared source). Over the
# threshold, this check FAILs loudly and names scripts/reap-telemetry.ts as
# the batched alternative rather than silently skipping. Set
# VERIFY_ALLOW_UNBATCHED_REAP=1 to run the direct call anyway — a deliberate,
# explicit override, never the default. At or under the threshold, behavior
# is byte-for-byte what it always was: call the function, check the
# heartbeat.
#
# Exit code is non-zero if ANY check fails, so this is usable as a gate.
set -euo pipefail

: "${TELEMETRY_PG_URL:?set TELEMETRY_PG_URL (connects as telemetry_pg)}"
: "${AGENT_PG_URL:?set AGENT_PG_URL (connects as agent_pg)}"
: "${BATCH_PG_URL:?set BATCH_PG_URL (connects as the table owner, e.g. pipeline)}"

err_file="$(mktemp)"
# Cleans up every test artifact this script may have created, on ANY exit
# path — including an early `set -e` abort partway through a check — which
# is why this lives in the trap rather than a "cleaning up" block at the
# bottom that a mid-script exit would just skip. Each delete is a harmless
# no-op if the row is already gone (e.g. forget_telemetry_user did its job).
cleanup() {
  rm -f "$err_file"
  if [[ -n "${TEST_EVENT_ID:-}" ]]; then
    psql "$BATCH_PG_URL" -qAt \
      -c "delete from intervu.telemetry_events where event_id = '${TEST_EVENT_ID}'" \
      >/dev/null || true
  fi
  if [[ -n "${TEST_FORGET_EVENT_ID:-}" ]]; then
    psql "$BATCH_PG_URL" -qAt \
      -c "delete from intervu.telemetry_events where event_id = '${TEST_FORGET_EVENT_ID}'" \
      >/dev/null || true
  fi
  if [[ -n "${TEST_UID:-}" ]]; then
    psql "$BATCH_PG_URL" -qAt \
      -c "delete from intervu.telemetry_events where user_id = '${TEST_UID}'" \
      >/dev/null || true
  fi
}
trap cleanup EXIT

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

echo "checking: telemetry_pg cannot delete from intervu.telemetry_events"
if sql_ok "$TELEMETRY_PG_URL" "delete from intervu.telemetry_events where false"; then
  fail "telemetry_pg DELETE succeeded — grants are too wide"
elif grep -q "permission denied" "$err_file"; then
  pass "telemetry_pg DELETE denied"
else
  fail "telemetry_pg DELETE failed for the wrong reason — $(cat "$err_file")"
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
REAP_VERIFY_MAX_ROWS="${REAP_VERIFY_MAX_ROWS:-5000}"
eligible_rows="$(psql "$BATCH_PG_URL" -qAtc \
  "select count(*) from intervu.telemetry_events where received_at < now() - interval '90 days'")"
if [[ "$eligible_rows" -gt "$REAP_VERIFY_MAX_ROWS" && "${VERIFY_ALLOW_UNBATCHED_REAP:-}" != "1" ]]; then
  fail "reap_telemetry() would delete ${eligible_rows} rows in one unbatched transaction (> REAP_VERIFY_MAX_ROWS=${REAP_VERIFY_MAX_ROWS}) — use scripts/reap-telemetry.ts's batched delete against real data, or set VERIFY_ALLOW_UNBATCHED_REAP=1 to run this check's direct call anyway"
else
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
fi

echo "checking: intervu.forget_telemetry_user(text) exists, is SECURITY DEFINER, owned by pipeline, search_path pinned"
forget_exists="$(psql "$BATCH_PG_URL" -qAtc \
  "select (to_regprocedure('intervu.forget_telemetry_user(text)') is not null)")"
if [[ "$forget_exists" != "t" ]]; then
  fail "intervu.forget_telemetry_user(text) does not exist"
  fail "PUBLIC cannot execute intervu.forget_telemetry_user(text) — function does not exist"
  fail "telemetry_pg can execute intervu.forget_telemetry_user(text) and it deletes — function does not exist"
  fail "forget_telemetry_user(null/'') is refused without touching the table — function does not exist"
else
  secdef_owner_ok="$(psql "$BATCH_PG_URL" -qAtc "
    select (p.prosecdef
            and r.rolname = 'pipeline'
            and exists (
              select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
              where c like 'search_path=%'
            ))
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = to_regprocedure('intervu.forget_telemetry_user(text)')")"
  if [[ "$secdef_owner_ok" == "t" ]]; then
    pass "forget_telemetry_user is SECURITY DEFINER, owned by pipeline, search_path pinned"
  else
    fail "forget_telemetry_user failed the SECURITY DEFINER/owner/search_path check (got: '${secdef_owner_ok}')"
  fi

  echo "checking: PUBLIC cannot execute intervu.forget_telemetry_user(text)"
  public_exec="$(psql "$BATCH_PG_URL" -qAtc \
    "select has_function_privilege('public', 'intervu.forget_telemetry_user(text)', 'EXECUTE')")"
  if [[ "$public_exec" == "f" ]]; then
    pass "PUBLIC EXECUTE denied on forget_telemetry_user"
  else
    fail "PUBLIC can execute forget_telemetry_user (got: '${public_exec}') — revoke did not take"
  fi

  echo "checking: telemetry_pg can execute forget_telemetry_user and it genuinely deletes"
  # Sentinel uid cannot collide with a real WorkOS id (those look like
  # user_01H...).
  TEST_FORGET_EVENT_ID="$(psql "$BATCH_PG_URL" -qAtc "select gen_random_uuid()")"
  TEST_UID="verify-forget-test-$(psql "$BATCH_PG_URL" -qAtc 'select gen_random_uuid()')"
  if sql_ok "$BATCH_PG_URL" \
    "insert into intervu.telemetry_events (event_id, occurred_at, session_id, event_name, user_id) values ('${TEST_FORGET_EVENT_ID}', now(), gen_random_uuid(), 'verify_forget_test_event', '${TEST_UID}')"
  then
    if forget_count="$(psql "$TELEMETRY_PG_URL" -qAtc \
      "select intervu.forget_telemetry_user('${TEST_UID}')" 2>"$err_file")"
    then
      if [[ "$forget_count" == "1" ]]; then
        remaining="$(psql "$BATCH_PG_URL" -qAtc \
          "select count(*) from intervu.telemetry_events where user_id = '${TEST_UID}'")"
        if [[ "$remaining" == "0" ]]; then
          pass "telemetry_pg executed forget_telemetry_user and the row is actually gone"
        else
          fail "forget_telemetry_user returned 1 but ${remaining} row(s) for the test uid still exist"
        fi
      else
        fail "forget_telemetry_user returned '${forget_count}', expected 1"
      fi
    else
      fail "telemetry_pg could not execute forget_telemetry_user — $(cat "$err_file")"
    fi
  else
    fail "could not insert the forget-test row — $(cat "$err_file")"
  fi

  echo "checking: forget_telemetry_user(null/'') is refused without touching the table"
  total_before="$(psql "$BATCH_PG_URL" -qAtc "select count(*) from intervu.telemetry_events")"
  if null_count="$(psql "$TELEMETRY_PG_URL" -qAtc "select intervu.forget_telemetry_user(null)" 2>"$err_file")" \
    && empty_count="$(psql "$TELEMETRY_PG_URL" -qAtc "select intervu.forget_telemetry_user('')" 2>"$err_file")"
  then
    total_after="$(psql "$BATCH_PG_URL" -qAtc "select count(*) from intervu.telemetry_events")"
    if [[ "$null_count" == "0" && "$empty_count" == "0" && "$total_before" == "$total_after" ]]; then
      pass "forget_telemetry_user(null/'') returned 0 and left the table row count unchanged"
    else
      fail "forget_telemetry_user(null/'') mismatch — null=${null_count} empty=${empty_count} before=${total_before} after=${total_after}"
    fi
  else
    fail "telemetry_pg could not execute forget_telemetry_user(null/'') — $(cat "$err_file")"
  fi
fi

echo
if [[ "$failed" -eq 0 ]]; then
  echo "all grant checks pass"
else
  echo "GRANT MISMATCH — do not treat telemetry_pg as safe to deploy" >&2
fi
exit "$failed"
