#!/usr/bin/env bash
# Drives lib/pg-env.sh's pg_env_from_url/psql_from_url against fixture URLs
# — no real database, no ssh, no docker. A fake `psql` on PATH stands in
# for the real binary so psql_from_url's env-leak contract can be checked
# without a connection.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail=0
check() {
  local desc="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (got: [$got]  want: [$want])"
    fail=1
  fi
}

# shellcheck disable=SC1091  # dynamic path ($SCRIPT_DIR); it's this file's own sibling
source "$SCRIPT_DIR/lib/pg-env.sh"

none_set() {
  if [[ -z "${PGUSER+x}" && -z "${PGPASSWORD+x}" && -z "${PGHOST+x}" && -z "${PGPORT+x}" \
     && -z "${PGDATABASE+x}" && -z "${PGSSLMODE+x}" && -z "${PGAPPNAME+x}" \
     && -z "${PGCONNECT_TIMEOUT+x}" && -z "${PGOPTIONS+x}" ]]; then
    echo none_set
  else
    echo SOME_SET
  fi
}
unset_all() {
  unset PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE PGSSLMODE PGAPPNAME PGCONNECT_TIMEOUT PGOPTIONS
}

# --- happy path, with port --------------------------------------------------
(
  unset_all
  pg_env_from_url 'postgres://u:p@h:5432/mydb' && rc=0 || rc=$?
  check "happy path w/ port: returns 0" "$rc" 0
  check "happy path w/ port: PGUSER" "$PGUSER" u
  check "happy path w/ port: PGPASSWORD" "$PGPASSWORD" p
  check "happy path w/ port: PGHOST" "$PGHOST" h
  check "happy path w/ port: PGPORT" "$PGPORT" 5432
  check "happy path w/ port: PGDATABASE" "$PGDATABASE" mydb
)

# --- happy path, no port -----------------------------------------------------
(
  unset_all
  pg_env_from_url 'postgres://u:p@h/mydb' && rc=0 || rc=$?
  check "no port: returns 0" "$rc" 0
  check "no port: PGHOST" "$PGHOST" h
  check "no port: PGPORT unset" "${PGPORT+x}" ""
  check "no port: PGDATABASE" "$PGDATABASE" mydb
)

# --- ?sslmode=require: mapped, dbname clean ---------------------------------
(
  unset_all
  pg_env_from_url 'postgres://u:p@h:5432/mydb?sslmode=require' && rc=0 || rc=$?
  check "sslmode query: returns 0" "$rc" 0
  check "sslmode query: PGDATABASE clean" "$PGDATABASE" mydb
  check "sslmode query: PGSSLMODE" "$PGSSLMODE" require
)

# --- ?sslmode=require&application_name=x: both mapped -----------------------
(
  unset_all
  pg_env_from_url 'postgres://u:p@h:5432/mydb?sslmode=require&application_name=x' && rc=0 || rc=$?
  check "two query keys: returns 0" "$rc" 0
  check "two query keys: PGSSLMODE" "$PGSSLMODE" require
  check "two query keys: PGAPPNAME" "$PGAPPNAME" x
)

# --- ?foo=bar: refused, names the key, exports nothing ----------------------
(
  unset_all
  err="$(pg_env_from_url 'postgres://u:p@h:5432/mydb?foo=bar' 2>&1 >/dev/null)"; rc=$?
  check "unknown query key: returns 1" "$rc" 1
  check "unknown query key: exports nothing" "$(none_set)" none_set
  check "unknown query key: stderr names the key" "$err" "pg_env_from_url: query parameter 'foo' has no libpq env equivalent"
)

# --- #frag: refused, exports nothing -----------------------------------------
(
  unset_all
  pg_env_from_url 'postgres://u:p@h:5432/mydb#frag' && rc=0 || rc=$?
  check "fragment: returns 1" "$rc" 1
  check "fragment: exports nothing" "$(none_set)" none_set
)

# --- %40 in password: refused, exports nothing -------------------------------
(
  unset_all
  pg_env_from_url 'postgres://bob:p%40ss@h/mydb' && rc=0 || rc=$?
  check "password with %: returns 1" "$rc" 1
  check "password with %: exports nothing" "$(none_set)" none_set
)

# --- postgresql:// scheme ----------------------------------------------------
(
  unset_all
  pg_env_from_url 'postgresql://u:p@h/mydb' && rc=0 || rc=$?
  check "postgresql:// scheme: returns 0" "$rc" 0
  check "postgresql:// scheme: PGDATABASE" "$PGDATABASE" mydb
)

# --- psql_from_url: no PG* leak into the caller afterward --------------------
FAKE_BIN="$(mktemp -d)"
cat >"$FAKE_BIN/psql" <<'FAKE'
#!/usr/bin/env bash
printf '%s %s\n' "$PGDATABASE" "$PGSSLMODE"
FAKE
chmod +x "$FAKE_BIN/psql"
(
  unset_all
  out="$(PATH="$FAKE_BIN:$PATH" psql_from_url 'postgres://u:p@h/mydb?sslmode=require')"
  check "psql_from_url: fake psql sees the env" "$out" "mydb require"
  check "psql_from_url: PGPASSWORD not leaked to caller" "${PGPASSWORD+x}" ""
  check "psql_from_url: PGSSLMODE not leaked to caller" "${PGSSLMODE+x}" ""
)
rm -rf "$FAKE_BIN"

# --- regression pin: no db-box script puts a *_PG_URL on psql's argv --------
# `psql_from_url` itself starts with "psql", so it is excluded explicitly —
# it is the sanctioned wrapper this whole file exists to require. Any other
# match means the bare psql binary was handed a credentialed URL directly on
# argv, in ANY script under deploy/db-box/, not just the ones this change
# touched. (Phrased without the literal pattern here so this comment does
# not trip its own check.)
pin_hits="$(grep -nE 'psql[^|]*\$[A-Za-z_]*PG_URL' "$SCRIPT_DIR"/*.sh 2>/dev/null | grep -v psql_from_url || true)"
check "no script in deploy/db-box/ passes a credentialed URL as psql argv" "$pin_hits" ""

echo
if [[ "$fail" -eq 0 ]]; then
  echo "ALL TESTS PASSED"
else
  echo "TESTS FAILED" >&2
fi
exit "$fail"
