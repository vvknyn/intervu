#!/usr/bin/env bash
# Credential-free pre-flight for the DB box's pg_hba.conf, runnable BEFORE
# RUNBOOK-telemetry-launch.md's human-only §2 (password) and §3
# (TELEMETRY_PG_URL) steps — that ordering is the point.
#
# WHY THIS EXISTS (2026-09-04). telemetry_pg held exactly one privilege in
# the whole cluster (INSERT on intervu.telemetry_events) but
# /etc/postgresql/17/main/pg_hba.conf on the DB box had no rule admitting it
# from the app box at all — only pipeline and agent_pg had rows. §2 (set the
# password) and §3 (add TELEMETRY_PG_URL) are each independently correct and
# were JOINTLY INSUFFICIENT: neither step can detect a missing pg_hba rule,
# and /api/telemetry's own guard-8 try/catch swallows the connection FATAL
# and still returns 204 — the gap was invisible on the wire.
# verify-telemetry-grants.sh (§6) is the existing gate for grants, but it
# needs real credentials and so cannot run until AFTER §2/§3 — this script
# is the earlier detector that did not exist when the gap above shipped.
# See deploy/db-box/RUNBOOK-telemetry-launch.md §1b for the fix and the
# measurements this script formalizes.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT. For each role, attempt exactly ONE
# connection to the DB box with a deliberately invalid password and classify
# the server's own reply:
#   - "no pg_hba.conf entry ..."        -> FAIL, not admitted from this host
#   - "password authentication failed"  -> PASS, reachable AND admitted
#   - a successful connection           -> FAIL, LOUDLY — a role that
#     accepts a junk password is a far worse finding than the one this
#     script was built to catch (trust auth / no password set at all)
#   - anything else (timeout, connection refused, could not translate host
#     name, ...) -> FAIL, treat as network/firewall/listen_addresses and
#     report the raw error
# A PASS here proves reachability + pg_hba admission ONLY. It never proves
# the real password is correct, and it is not a substitute for
# verify-telemetry-grants.sh.
#
# THIS IS A PRE-FLIGHT, NOT A MONITOR. Every run costs one failed
# authentication per role against the DB box. Run it by hand before §2/§3 —
# wiring it into a polling loop or a frequent cron manufactures auth-log
# noise and risks tripping fail2ban or similar on the DB box.
#
# NO REAL SECRET IS EVER READ, PRINTED, OR REQUIRED. INVALID_PASSWORD below
# is a fixed, obviously-fake literal — never a real credential, never read
# from any secret store. It is passed via the PGPASSWORD environment
# variable for the single connection attempt, NEVER as a psql argv value:
# `ps` is world-readable on that box, and an argv password would be a
# disclosure even if it's fake-shaped and worthless.
#
# Usage:
#   deploy/db-box/preflight-telemetry-connectivity.sh [role ...]
# Roles default to the three RUNBOOK-telemetry-launch.md §6 already checks:
# telemetry_pg, agent_pg, pipeline. A role added next month is covered by
# passing it in — this script does not enumerate roles internally.
#
# Env overrides: DB_HOST (default 169.58.140.49), DB_PORT (default 5432),
# DB_NAME (default postgres), PGCONNECT_TIMEOUT (default 5, so a firewall
# black-hole fails fast instead of hanging).
#
# Dependency-free beyond psql, like every other script in deploy/db-box/.
set -euo pipefail

DB_HOST="${DB_HOST:-169.58.140.49}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"

# Fixed, obviously-fake literal. Its only job is to be wrong so the server's
# own reply can be classified — never a real credential.
readonly INVALID_PASSWORD='preflight-deliberately-wrong-password'

# classify_psql_error <exit_status> <stderr_text>
# Pure classifier, no I/O of its own, kept separate from the connection
# attempt in main() so a test can drive it directly (e.g. via `bash -c`)
# against literal server replies without touching a network. Prints exactly
# one of:
#   admitted      reachable, pg_hba admits this role, password check failed
#                 as expected — the PASS case
#   not-admitted  "no pg_hba.conf entry ..." — the exact gap this script
#                 exists to catch
#   trust-auth    exit status 0 — the invalid password was ACCEPTED. A worse
#                 finding than the one above.
#   other         anything else (timeout, connection refused, could not
#                 translate host name, ...) — network/firewall/listen_addresses
classify_psql_error() {
  local exit_status="$1" stderr_text="$2"
  if [[ "$exit_status" -eq 0 ]]; then
    echo "trust-auth"
  elif grep -q 'no pg_hba.conf entry' <<<"$stderr_text"; then
    echo "not-admitted"
  elif grep -q 'password authentication failed' <<<"$stderr_text"; then
    echo "admitted"
  else
    echo "other"
  fi
}

main() {
  local roles=("$@")
  if [[ ${#roles[@]} -eq 0 ]]; then
    roles=(telemetry_pg agent_pg pipeline)
  fi

  local failed=0 role stderr_text status verdict
  for role in "${roles[@]}"; do
    # `if var=$(...)` — not `var=$(...) || true` — so `set -e` sees this
    # command's failure handled by the `if`, rather than aborting the loop
    # before the error is classified. That is the easy bug this script must
    # not have.
    if stderr_text="$(PGPASSWORD="$INVALID_PASSWORD" psql \
          "host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${role}" \
          -Atqc 'select 1' 2>&1 >/dev/null)"
    then
      status=0
    else
      status=$?
    fi

    verdict="$(classify_psql_error "$status" "$stderr_text")"
    case "$verdict" in
      admitted)
        printf 'OK    %s — reachable, admitted by pg_hba.conf (password check failed, as expected)\n' "$role"
        ;;
      not-admitted)
        printf 'FAIL  %s — no pg_hba.conf entry admits this role from this host\n' "$role"
        failed=1
        ;;
      trust-auth)
        printf 'FAIL  %s — CONNECTED with a deliberately invalid password; this role accepts junk credentials, a worse finding than a missing pg_hba rule\n' "$role"
        failed=1
        ;;
      other)
        printf 'FAIL  %s — unexpected error, treat as network/firewall/listen_addresses: %s\n' "$role" "$stderr_text"
        failed=1
        ;;
    esac
  done

  echo
  if [[ "$failed" -eq 0 ]]; then
    echo "all roles reachable and admitted by pg_hba.conf (password correctness NOT checked — see header)"
  else
    echo "PREFLIGHT FAILED — see FAIL lines above" >&2
  fi
  return "$failed"
}

# Only run main when this file is executed directly. Sourcing it (e.g. a
# test driving classify_psql_error in isolation) must not also fire a real
# connection attempt.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
