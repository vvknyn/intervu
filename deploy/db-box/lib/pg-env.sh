# shellcheck shell=bash
# Shared by every db-box script that needs a working libpq connection
# derived from a "postgres[ql]://user:password@host[:port]/dbname[?query]"
# URL — launch-telemetry-ingest.sh, verify-telemetry-grants.sh,
# verify-firestore-load.sh and load-firestore-export.sh all source this.
# SOURCED ONLY — this file defines functions and returns, it never runs
# main-line work, so `source .../lib/pg-env.sh` is the only supported entry
# point. If a script is ever copied to the box without its `lib/` dir next
# to it, the `source` line at the call site fails loudly under `set -e`
# rather than silently skipping — no fallback is defined here on purpose.
if [[ -n "${PG_ENV_SH_LOADED:-}" ]]; then
  return 0
fi
PG_ENV_SH_LOADED=1

# _pg_urldecode <string>
# RFC 3986 percent-decode, the same transform libpq applies to the
# userinfo and path components when it parses a postgresql:// URI. Prints
# the decoded string on stdout and returns 0, or prints nothing and
# returns 1 if <string> contains a `%` not followed by exactly two hex
# digits (a malformed escape). Stays silent on failure on purpose — every
# caller below names the offending URL component on stderr itself, never
# the value, so a bad credential is never echoed anywhere.
# KNOWN LIMITATION: a literal (non-percent-encoded) backslash in the input
# would be reinterpreted by `printf %b`. Not reachable via
# is_valid_generated_password's alphanumeric-only output; a hand-typed
# password with a literal backslash would need to percent-encode it too.
_pg_urldecode() {
  local s="$1"
  [[ "$s" =~ ^([^%]|%[0-9A-Fa-f]{2})*$ ]] || return 1
  printf '%b' "${s//%/\\x}"
}

# pg_env_from_url <url>
# Splits a "postgres[ql]://user:password@host[:port]/dbname[?query]" URL
# into libpq's own connection env vars (PGUSER, PGPASSWORD, PGHOST, PGPORT,
# PGDATABASE, and any recognized query-string keys below) and exports them
# into the CURRENT shell. This is the one chokepoint every db-box script
# uses to turn a *_PG_URL value into a working psql connection without ever
# putting the credential in a process's argv (`ps` is world-readable on
# both boxes).
#
# WHY NOT `PGDATABASE="$url" psql`: libpq only expands a postgresql:// URI
# when it arrives via the `-d`/`dbname` connection parameter. PGDATABASE the
# ENV VAR is not that parameter — libpq treats it as a literal database
# NAME, so `PGDATABASE="$url" psql` dials the LOCAL socket looking for a
# (nonexistent) database whose name is the whole URL string, never reaching
# the URL's actual host at all.
#
# WHY NOT `psql "$url"`: putting the URL on argv defeats the whole point —
# every other process on the box can read it via `ps`.
#
# Exports PGUSER/PGPASSWORD/PGHOST/PGDATABASE on success (PGPORT only when
# the URL carried an explicit port — otherwise libpq's own default
# applies), plus PGSSLMODE/PGAPPNAME/PGCONNECT_TIMEOUT/PGOPTIONS for
# whichever of `sslmode`/`application_name`/`connect_timeout`/`options` the
# query string names — the only query keys libpq has an env var for. The
# user, password and dbname components are percent-decoded per RFC 3986
# before export, exactly what libpq itself does when it parses a URI — host
# and port are never percent-encoded by libpq's own URI grammar, so those
# two pass through as-is.
# Exports NOTHING and returns 1 when: the string doesn't match the expected
# shape; the user, password or dbname component has a malformed %-escape (a
# `%` not followed by two hex digits — named on stderr by WHICH component,
# never by value); the URL carries a `#fragment` (this function does not
# model one); or the query string names any key other than the four above
# (printed on stderr by NAME, never by value, so the caller learns what to
# fix without a secret landing in a log).
#
# This function's first version refused any `%` in the password outright,
# and a `?sslmode=…` query string outright. Both would have broken
# verify-telemetry-grants.sh, verify-firestore-load.sh and
# load-firestore-export.sh — all of which accepted such URLs yesterday via
# `psql "$URL"` on argv — the moment each stopped putting the URL on argv
# and started going through here instead: a class fix must not break what
# already worked. Decoding percent-escapes (refusing only a malformed one)
# and mapping the four query keys that have a real libpq env equivalent
# (refusing, loudly and by name, anything else) keeps the same property
# both times: no previously-working URL shape stops working, and nothing
# unmodeled is silently swallowed into the wrong field.
pg_env_from_url() {
  local url="$1"
  local re='^postgres(ql)?://([^:@/]+):([^@]+)@([^:/@]+)(:([0-9]+))?/([^/?#]+)(\?([^#]*))?(#.*)?$'
  [[ "$url" =~ $re ]] || return 1
  local user="${BASH_REMATCH[2]}" password="${BASH_REMATCH[3]}"
  local host="${BASH_REMATCH[4]}" port="${BASH_REMATCH[6]}" dbname="${BASH_REMATCH[7]}"
  local has_query="${BASH_REMATCH[8]}" query="${BASH_REMATCH[9]}" fragment="${BASH_REMATCH[10]}"
  if [[ -n "$fragment" ]]; then
    echo "pg_env_from_url: refusing a URL with a #fragment" >&2
    return 1
  fi

  user="$(_pg_urldecode "$user")" \
    || { echo "pg_env_from_url: malformed %-escape in the user component" >&2; return 1; }
  password="$(_pg_urldecode "$password")" \
    || { echo "pg_env_from_url: malformed %-escape in the password component" >&2; return 1; }
  dbname="$(_pg_urldecode "$dbname")" \
    || { echo "pg_env_from_url: malformed %-escape in the dbname component" >&2; return 1; }

  # Pass 1: validate every query-string key before exporting anything, so a
  # single unrecognized key leaves the environment untouched — the same
  # "exports nothing on failure" contract the shape/password/fragment
  # checks above already keep.
  # `${pairs[@]+"${pairs[@]}"}`, not a bare `"${pairs[@]}"`, in both loops
  # below: this script runs under bash 3.2 (Vivek's Mac), which throws
  # "unbound variable" under `set -u` on `"${arr[@]}"` when arr is a
  # declared-but-still-empty array; the `+` form sidesteps that.
  local pairs=() pair key
  if [[ -n "$has_query" ]]; then
    IFS='&' read -ra pairs <<<"$query"
    for pair in ${pairs[@]+"${pairs[@]}"}; do
      [[ -z "$pair" ]] && continue
      key="${pair%%=*}"
      case "$key" in
        sslmode | application_name | connect_timeout | options) ;;
        *)
          echo "pg_env_from_url: query parameter '$key' has no libpq env equivalent" >&2
          return 1
          ;;
      esac
    done
  fi

  export PGUSER="$user" PGPASSWORD="$password" PGHOST="$host" PGDATABASE="$dbname"
  [[ -n "$port" ]] && export PGPORT="$port"
  local value
  for pair in ${pairs[@]+"${pairs[@]}"}; do
    [[ -z "$pair" ]] && continue
    key="${pair%%=*}"
    value="${pair#*=}"
    case "$key" in
      sslmode) export PGSSLMODE="$value" ;;
      application_name) export PGAPPNAME="$value" ;;
      connect_timeout) export PGCONNECT_TIMEOUT="$value" ;;
      options) export PGOPTIONS="$value" ;;
    esac
  done
  return 0
}

# psql_from_url <url> [psql args...]
# Runs psql against <url> without ever putting it on psql's argv. Wraps the
# env-export + psql call in a subshell so the exported PG* vars never leak
# into the caller — the same script can alternate between two different
# roles' URLs (e.g. BATCH_PG_URL then TELEMETRY_PG_URL) call after call
# without one connection's credentials bleeding into the next.
psql_from_url() {
  (
    pg_env_from_url "$1" || return 1
    shift
    psql "$@"
  )
}
