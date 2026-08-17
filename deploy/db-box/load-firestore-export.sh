#!/usr/bin/env bash
# Loads a firestore-export dump into the `intervu` schema on the db-box.
#
#   ./load-firestore-export.sh <export-dir> [pg-url]
#
# Run this FROM THE PIPELINE BOX (194.163.147.154). The db-box firewall
# admits 5432 only from there, so nowhere else can reach Postgres. With no
# pg-url argument it reads BATCH_PG_URL out of /opt/interview-os/.env.local.
#
# IDEMPOTENT. Each table loads through a temp staging table and upserts on
# `path`, so re-running is safe and a second run after a fresh export acts
# as a delta pass, picking up documents written since the last one. It never
# deletes: a row that exists here but no longer exists in Firestore is left
# alone, because every row is historical until someone decides otherwise.
#
# This touches ONLY the `intervu` schema. The supabase-exit tables in
# `public` are not read, written, or locked by anything here.
set -euo pipefail

EXPORT_DIR="${1:?usage: load-firestore-export.sh <export-dir> [pg-url]}"
PG_URL="${2:-$(grep -ho 'BATCH_PG_URL=.*' /opt/interview-os/.env.local | cut -d= -f2-)}"

if [[ -z "$PG_URL" ]]; then
    echo "no pg url: pass one as \$2 or set BATCH_PG_URL in /opt/interview-os/.env.local" >&2
    exit 1
fi

# Fail before touching anything if the schema was never applied, rather than
# emitting one "relation does not exist" per table and exiting on the first.
if ! psql "$PG_URL" -qAtc "select 1 from pg_namespace where nspname='intervu'" | grep -q 1; then
    echo "schema 'intervu' does not exist — apply deploy/db-box/intervu-schema.sql first" >&2
    exit 1
fi

shopt -s nullglob
for file in "$EXPORT_DIR"/*.csv; do
    table="$(basename "$file" .csv)"
    printf '%-24s ' "$table"

    # Staging + upsert rather than a direct \copy into the target: the
    # target's generated columns cannot be written to, and this makes a
    # re-run a delta rather than a duplicate-key failure.
    psql "$PG_URL" -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE stage_load (path text PRIMARY KEY, doc jsonb) ON COMMIT DROP;
\\copy stage_load (path, doc) FROM '${file}' WITH (FORMAT csv)
INSERT INTO intervu."${table}" (path, doc)
SELECT path, doc FROM stage_load
ON CONFLICT (path) DO UPDATE SET doc = EXCLUDED.doc, copied_at = now();
COMMIT;
SQL

    psql "$PG_URL" -qAtc "select count(*) from intervu.\"${table}\"" | tr -d '\n'
    echo " rows"
done

echo
echo "loaded. verify with: ./verify-firestore-load.sh ${EXPORT_DIR}"
