#!/usr/bin/env bash
# Applies the telemetry ledger migration on the db-box, in the right order,
# with no credential of any kind — see RUNBOOK-telemetry-launch.md for why
# that's possible here and what still has to be done by a human afterward.
# Also applies telemetry-derived.sql, the user-profile cache layer, after
# the raw ledger schema is confirmed correct — see that file's own header
# for why it creates its tables as `pipeline` rather than as this script's
# invoking user.
#
# RUN AS THE `postgres` OS USER, ON THE DB BOX (169.58.140.49), e.g.:
#
#   sudo -u postgres bash apply-telemetry-migration.sh
#
# over the local unix socket — no -h/-U/password/connection string. This
# script does not escalate privilege itself (no `sudo` inside it): if it is
# invoked as any other OS user, the very first connectivity check below
# fails with Postgres's own peer-auth error, which already says plainly
# that the wrong user ran it — there is no separate "am I postgres" check
# to keep in sync with that message.
#
# STATE DETECTION, NOT A FLAG: this script reads intervu.telemetry_events'
# actual shape from information_schema/to_regclass every run and decides
# absent / orphan / correct from that alone — never from an operator-passed
# flag — so it makes the same decision whether it's the first run today or
# a re-run next month.
#
#   absent  — table doesn't exist yet. telemetry-schema.sql creates it.
#   orphan  — table exists, no `event_id` column (the known 2026-09-03
#             pre-spec shape). telemetry-events-drop-orphan.sql runs first.
#   correct — table exists and already has `event_id`. The drop script is
#             skipped (it would refuse to touch this shape anyway — see its
#             own header). telemetry-schema.sql's §0 guard does the real,
#             full column-by-column verification; this script does not
#             duplicate that check, it just decides whether the drop step
#             runs first.
#
# Idempotent by construction: telemetry-schema.sql is `create ... if not
# exists` / `create or replace` / idempotent GRANT+REVOKE throughout (see
# its own header), so a second run against an already-correct schema issues
# the same statements again, changes nothing, and exits 0.
#
# Never drops a table with rows itself — that guard lives in
# telemetry-events-drop-orphan.sql (refuses on any row count > 0, unconditionally,
# no force flag) and this script does not re-implement it; it only decides
# *whether* to invoke that file, then surfaces whatever it says verbatim.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_SQL="$SCRIPT_DIR/telemetry-schema.sql"
DROP_ORPHAN_SQL="$SCRIPT_DIR/telemetry-events-drop-orphan.sql"
DERIVED_SQL="$SCRIPT_DIR/telemetry-derived.sql"

for f in "$SCHEMA_SQL" "$DROP_ORPHAN_SQL" "$DERIVED_SQL"; do
  if [[ ! -f "$f" ]]; then
    echo "missing $f — copy the whole deploy/db-box/ directory to the box, not just this script" >&2
    exit 1
  fi
done

echo "checking: can reach Postgres over the local socket as this OS user"
if ! psql -d postgres -Atc "select 1" >/dev/null; then
  echo "FAILED: could not connect to database 'postgres' via the local socket." >&2
  echo "Run this AS THE postgres OS user, e.g.: sudo -u postgres bash $0" >&2
  exit 1
fi

echo "checking: schema 'intervu' exists"
schema_exists="$(psql -d postgres -Atc "select 1 from information_schema.schemata where schema_name = 'intervu'")"
if [[ "$schema_exists" != "1" ]]; then
  echo "FAILED: schema 'intervu' does not exist on this box yet." >&2
  echo "Apply deploy/db-box/intervu-schema.sql first, then re-run this script." >&2
  exit 1
fi

echo "checking: current shape of intervu.telemetry_events"
state="$(psql -d postgres -Atc "
  select case
    when to_regclass('intervu.telemetry_events') is null then 'absent'
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'intervu' and table_name = 'telemetry_events'
        and column_name = 'event_id'
    ) then 'correct'
    else 'orphan'
  end
")"

case "$state" in
  absent)
    echo "intervu.telemetry_events does not exist yet — telemetry-schema.sql will create it."
    ;;
  correct)
    echo "intervu.telemetry_events already has an event_id column — skipping telemetry-events-drop-orphan.sql."
    ;;
  orphan)
    echo "intervu.telemetry_events exists without an event_id column (pre-spec orphan shape) — running telemetry-events-drop-orphan.sql."
    if psql -d postgres -f "$DROP_ORPHAN_SQL"; then
      :
    else
      rc=$?
      echo "FAILED: telemetry-events-drop-orphan.sql exited $rc — see its own error above (it refuses to drop a table" >&2
      echo "that holds rows, or one that already looks like the correct shape; there is no force flag)." >&2
      exit "$rc"
    fi
    ;;
  *)
    echo "FAILED: unrecognized state '$state' from the detection query — this is a bug in this script, not a normal migration failure." >&2
    exit 1
    ;;
esac

echo "checking: telemetry ACL strip self-test (throwaway table + roles in schema intervu, always rolled back)"
# Nothing in this repo parses telemetry-schema.sql's ACL-strip block against
# a real Postgres engine before it runs against prod — a syntax/logic bug in
# it (e.g. the %I-vs-%s regrole quoting bug fixed 2026-09-03) would only
# surface by aborting the real migration, or worse, silently misbehaving.
# This exercises the SAME strip loop (telemetry-acl-strip.sql, \ir'd below,
# never copy-pasted) against a throwaway table+roles inside a transaction
# that always rolls back, so it proves the loop before anything real is at
# stake, whether this is the first run today or the hundredth next year.
if (cd "$SCRIPT_DIR" && psql -d postgres -f - <<'SELFTEST_SQL'
\set ON_ERROR_STOP on
begin;

create table intervu.__telemetry_acl_selftest (id int);

-- Two grantee names that REQUIRE quoting to round-trip through SQL: one
-- with a space and capitals, one that is a reserved word. These are the
-- exact shape of name that broke the %I-quoting bug.
create role "Weird Role" nologin;
create role "user" nologin;

grant select on intervu.__telemetry_acl_selftest to "Weird Role";
grant select on intervu.__telemetry_acl_selftest to "user";
grant select on intervu.__telemetry_acl_selftest to public;

\set strip_tables 'intervu.__telemetry_acl_selftest'
\ir telemetry-acl-strip.sql

do $$
declare
  acl text;
begin
  select relacl::text from pg_class
    where oid = 'intervu.__telemetry_acl_selftest'::regclass into acl;

  if has_table_privilege('service_role', 'intervu.__telemetry_acl_selftest', 'SELECT') then
    raise exception 'self-test FAILED: service_role retains a privilege after the strip (acl=%)', acl;
  end if;
  if has_table_privilege('Weird Role', 'intervu.__telemetry_acl_selftest', 'SELECT') then
    raise exception 'self-test FAILED: quoted-name role "Weird Role" retains a privilege after the strip (acl=%)', acl;
  end if;
  if has_table_privilege('user', 'intervu.__telemetry_acl_selftest', 'SELECT') then
    raise exception 'self-test FAILED: reserved-word role "user" retains a privilege after the strip (acl=%)', acl;
  end if;
  if has_table_privilege('public', 'intervu.__telemetry_acl_selftest', 'SELECT') then
    raise exception 'self-test FAILED: PUBLIC retains a privilege after the strip (acl=%)', acl;
  end if;
  if acl is not null and acl <> '{pipeline=arwdDxtm/pipeline}' then
    raise exception 'self-test FAILED: unexpected residual acl after the strip: %', acl;
  end if;
end
$$;

rollback;
SELFTEST_SQL
); then
  :
else
  rc=$?
  echo "FAILED: telemetry ACL strip self-test did not pass (exit $rc) — see the error above." >&2
  echo "This means the strip loop in telemetry-acl-strip.sql is broken. Refusing to touch" >&2
  echo "intervu.telemetry_events or intervu.job_heartbeats until it is fixed." >&2
  exit "$rc"
fi

echo "applying: telemetry-schema.sql"
if psql -d postgres -f "$SCHEMA_SQL"; then
  :
else
  rc=$?
  echo "FAILED: telemetry-schema.sql exited $rc." >&2
  echo "If this is the §0 drift guard firing, the diff it printed above names the exact mismatch — this is not" >&2
  echo "the known 2026-09-03 orphan (this script already handles that case); investigate before re-running." >&2
  exit "$rc"
fi

echo "applying: telemetry-derived.sql"
if psql -d postgres -f "$DERIVED_SQL"; then
  :
else
  rc=$?
  echo "FAILED: telemetry-derived.sql exited $rc." >&2
  echo "This is the derived cache-layer migration — see its own header for the two catalog-driven preconditions" >&2
  echo "it checks before creating anything; their failure messages name the exact catalog state found." >&2
  exit "$rc"
fi

cat <<'EOF'

Schema migration applied. This script did NOT do, and cannot do, the
following — they involve a credential and must be done by a human. See
RUNBOOK-telemetry-launch.md for the exact commands and pass conditions:

  1. Set the telemetry_pg role's password (\password telemetry_pg, inside
     an interactive psql session — never as a scripted ALTER ROLE).
  2. Append TELEMETRY_PG_URL=... to
     /opt/interview-os/deploy/contabo-web/intervu.env on the app box, then
     recreate (not restart) the intervu container so it picks it up.

Until both are done, the ingest route still returns 204 but inserts
nothing — see the runbook's "what a silent failure looks like" section.
EOF
