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

# --- %40 in password: decoded, not refused -----------------------------------
(
  unset_all
  pg_env_from_url 'postgres://bob:p%40ss@h/mydb' && rc=0 || rc=$?
  check "password with %40: returns 0" "$rc" 0
  check "password with %40: PGPASSWORD decoded" "$PGPASSWORD" 'p@ss'
)

# --- %2F in dbname: decoded ---------------------------------------------------
(
  unset_all
  pg_env_from_url 'postgres://u:p@h/my%2Fdb' && rc=0 || rc=$?
  check "dbname with %2F: returns 0" "$rc" 0
  check "dbname with %2F: PGDATABASE decoded" "$PGDATABASE" 'my/db'
)

# --- %zz malformed escape: refused, names the component, exports nothing -----
(
  unset_all
  err="$(pg_env_from_url 'postgres://bob:p%zzss@h/mydb' 2>&1 >/dev/null)"; rc=$?
  check "malformed %-escape: returns 1" "$rc" 1
  check "malformed %-escape: exports nothing" "$(none_set)" none_set
  check "malformed %-escape: stderr names the component, not the value" "$err" \
    "pg_env_from_url: malformed %-escape in the password component"
)

# --- password with no % at all: unchanged by the decode step -----------------
(
  unset_all
  pg_env_from_url 'postgres://bob:plainpass@h/mydb' && rc=0 || rc=$?
  check "password without %: returns 0" "$rc" 0
  check "password without %: PGPASSWORD unchanged" "$PGPASSWORD" 'plainpass'
)

# --- postgresql:// scheme ----------------------------------------------------
(
  unset_all
  pg_env_from_url 'postgresql://u:p@h/mydb' && rc=0 || rc=$?
  check "postgresql:// scheme: returns 0" "$rc" 0
  check "postgresql:// scheme: PGDATABASE" "$PGDATABASE" mydb
)

# --- _pg_urldecode: a literal backslash must NOT be reinterpreted by printf %b
(
  out="$(_pg_urldecode 'a\nb')"; rc=$?
  check "_pg_urldecode a\\nb: returns 0" "$rc" 0
  check "_pg_urldecode a\\nb: unchanged, not a real newline" "$out" 'a\nb'
  check "_pg_urldecode a\\nb: byte length 4" "${#out}" 4
)
(
  out="$(_pg_urldecode 'abc\cdef')"; rc=$?
  check "_pg_urldecode abc\\cdef: returns 0" "$rc" 0
  check "_pg_urldecode abc\\cdef: unchanged, not truncated at \\c" "$out" 'abc\cdef'
  check "_pg_urldecode abc\\cdef: byte length 8" "${#out}" 8
)
(
  out="$(_pg_urldecode 'a\\b')"; rc=$?
  check "_pg_urldecode a\\\\b (two backslashes): returns 0" "$rc" 0
  check "_pg_urldecode a\\\\b (two backslashes): unchanged" "$out" 'a\\b'
  check "_pg_urldecode a\\\\b (two backslashes): byte length 4" "${#out}" 4
)
(
  out="$(_pg_urldecode 'ab\')"; rc=$?
  check "_pg_urldecode trailing single backslash: returns 0" "$rc" 0
  check "_pg_urldecode trailing single backslash: unchanged" "$out" 'ab\'
  check "_pg_urldecode trailing single backslash: byte length 3" "${#out}" 3
)
(
  out="$(_pg_urldecode '%5C')"; rc=$?
  check "_pg_urldecode %5C: returns 0" "$rc" 0
  check "_pg_urldecode %5C: decodes to one real backslash" "$out" '\'
  check "_pg_urldecode %5C: byte length 1" "${#out}" 1
)
(
  out="$(_pg_urldecode 'p%40ss')"; rc=$?
  check "_pg_urldecode p%40ss: returns 0" "$rc" 0
  check "_pg_urldecode p%40ss: still decodes %40 to @" "$out" 'p@ss'
)
(
  out="$(_pg_urldecode '%25')"; rc=$?
  check "_pg_urldecode %25: returns 0" "$rc" 0
  check "_pg_urldecode %25: decodes to a literal percent" "$out" '%'
)

# --- IPv6 bracketed host: accepted, PGHOST exported WITHOUT brackets --------
(
  unset_all
  pg_env_from_url 'postgres://u:p@[::1]:5432/mydb' && rc=0 || rc=$?
  check "IPv6 [::1] w/ port: returns 0" "$rc" 0
  check "IPv6 [::1] w/ port: PGHOST has no brackets" "$PGHOST" '::1'
  check "IPv6 [::1] w/ port: PGPORT" "$PGPORT" 5432
)
(
  unset_all
  pg_env_from_url 'postgres://u:p@[fe80::1]/mydb' && rc=0 || rc=$?
  check "IPv6 [fe80::1] no port: returns 0" "$rc" 0
  check "IPv6 [fe80::1] no port: PGHOST has no brackets" "$PGHOST" 'fe80::1'
  check "IPv6 [fe80::1] no port: PGPORT unset" "${PGPORT+x}" ""
)
(
  unset_all
  pg_env_from_url 'postgres://u:p@[::1:5432/mydb' && rc=0 || rc=$?
  check "IPv6 unbalanced bracket: returns 1" "$rc" 1
  check "IPv6 unbalanced bracket: exports nothing" "$(none_set)" none_set
)
(
  unset_all
  pg_env_from_url 'postgres://u:p@192.168.1.1:5432/mydb' && rc=0 || rc=$?
  check "ordinary IPv4 host: returns 0" "$rc" 0
  check "ordinary IPv4 host: PGHOST unchanged" "$PGHOST" '192.168.1.1'
)
(
  unset_all
  pg_env_from_url 'postgres://u:p@some-host.example.com:5432/mydb' && rc=0 || rc=$?
  check "ordinary hostname: returns 0" "$rc" 0
  check "ordinary hostname: PGHOST unchanged" "$PGHOST" 'some-host.example.com'
)

# --- empty password (user:@host/db): legal libpq grammar, accepted ---------
(
  unset_all
  pg_env_from_url 'postgres://u:@h/mydb' && rc=0 || rc=$?
  check "empty password: returns 0" "$rc" 0
  check "empty password: PGUSER" "$PGUSER" u
  check "empty password: PGPASSWORD is set" "${PGPASSWORD+x}" x
  check "empty password: PGPASSWORD is empty" "$PGPASSWORD" ""
)
# --- missing ':' entirely (no password field at all): still refused --------
(
  unset_all
  pg_env_from_url 'postgres://u@h/mydb' && rc=0 || rc=$?
  check "missing ':' entirely: returns 1" "$rc" 1
  check "missing ':' entirely: exports nothing" "$(none_set)" none_set
)

# --- duplicate query key: refused, names the key, exports nothing ----------
(
  unset_all
  err="$(pg_env_from_url 'postgres://u:p@h:5432/mydb?sslmode=require&sslmode=disable' 2>&1 >/dev/null)"; rc=$?
  check "duplicate query key: returns 1" "$rc" 1
  check "duplicate query key: exports nothing" "$(none_set)" none_set
  check "duplicate query key: stderr names the key" "$err" \
    "pg_env_from_url: query parameter 'sslmode' given more than once"
)

# --- PG_ENV_FUNCS: single source of truth for what a remote heredoc ships --
(
  # shellcheck disable=SC2086  # unquoted on purpose: word-splits into
  # multiple function names, the same way launch-telemetry-ingest.sh uses it
  declare -f $PG_ENV_FUNCS >/dev/null 2>&1
  check "PG_ENV_FUNCS: declare -f resolves every listed name" "$?" 0
)
missing_from_pg_env_funcs=""
for fn in $(grep -oE '^[a-z_]+\(\)' "$SCRIPT_DIR/lib/pg-env.sh" | sed 's/()$//'); do
  case " $PG_ENV_FUNCS " in
    *" $fn "*) ;;
    *) missing_from_pg_env_funcs="$missing_from_pg_env_funcs $fn" ;;
  esac
done
check "PG_ENV_FUNCS: lists every function defined in lib/pg-env.sh" \
  "$missing_from_pg_env_funcs" ""

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
# not trip its own check.) Matches both the bare and braced forms of the
# variable reference — still a purely textual grep, so it cannot see a
# credential forwarded into psql through a wrapper's own positional
# parameter instead of by the *_PG_URL name itself: such a call site
# reads only as psql followed by a forwarded argument, with the
# credential's actual name one level up the call stack, out of this
# line's sight. That indirection is exactly why verify-telemetry-grants.sh's
# sql_ok helper goes through the psql wrapper, never bare psql, for that
# forwarded argument — the sanctioned wrapper, not this pin, is what keeps
# that case safe.
pin_hits="$(grep -nE 'psql[^|]*\$\{?[A-Za-z_]*PG_URL' "$SCRIPT_DIR"/*.sh 2>/dev/null | grep -v psql_from_url || true)"
check "no script in deploy/db-box/ passes a credentialed URL as psql argv" "$pin_hits" ""

echo
if [[ "$fail" -eq 0 ]]; then
  echo "ALL TESTS PASSED"
else
  echo "TESTS FAILED" >&2
fi
exit "$fail"
