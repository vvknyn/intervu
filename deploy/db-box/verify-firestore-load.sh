#!/usr/bin/env bash
# Verifies a loaded `intervu` schema against the export's own manifest.
#
#   ./verify-firestore-load.sh <export-dir> [pg-url]
#
# Two independent checks per table:
#
#   1. ROW COUNT equals what the exporter counted in Firestore.
#   2. sha256 over the SORTED document paths matches the exporter's digest.
#
# The path digest is what makes this more than a count: a count still passes
# if one document arrived twice and another not at all. Paths are compared
# rather than document bodies deliberately — jsonb reorders keys and
# normalizes numbers, so a byte digest of the JSON would differ between the
# two engines for reasons that have nothing to do with data loss. Content
# integrity is instead guaranteed by Postgres itself: `doc` is jsonb, so a
# truncated or mis-quoted value fails the load loudly rather than landing as
# a damaged string.
#
# Exit code is non-zero if ANY table mismatches, so this is usable as a gate.
set -euo pipefail

# pg_env_from_url/psql_from_url live in lib/pg-env.sh, shared with every
# other db-box script that needs a libpq connection from a *_PG_URL value.
# No fallback if this file is missing next to a copy of this script — `set
# -e` above fails the whole run loudly, which is the correct behavior.
source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-env.sh"

EXPORT_DIR="${1:?usage: verify-firestore-load.sh <export-dir> [pg-url]}"
PG_URL="${2:-$(grep -ho 'BATCH_PG_URL=.*' /opt/interview-os/.env.local | cut -d= -f2-)}"
MANIFEST="${EXPORT_DIR}/manifest.json"

[[ -f "$MANIFEST" ]] || { echo "no manifest.json in ${EXPORT_DIR}" >&2; exit 1; }

failed=0
while IFS=$'\t' read -r table rows digest; do
    # `string_agg` over an ordered subquery reproduces exactly what the
    # exporter hashed: paths sorted, newline-joined, no trailing newline.
    actual_rows=$(psql_from_url "$PG_URL" -qAtc "select count(*) from intervu.\"${table}\"")
    actual_digest=$(psql_from_url "$PG_URL" -qAtc \
        "select coalesce(encode(sha256(convert_to(string_agg(path, e'\n' order by path), 'UTF8')), 'hex'), '') from intervu.\"${table}\"")

    if [[ "$actual_rows" == "$rows" && "$actual_digest" == "$digest" ]]; then
        printf '  OK    %-24s %6s rows\n' "$table" "$rows"
    else
        printf '  FAIL  %-24s expected %s rows / %s\n' "$table" "$rows" "${digest:0:16}"
        printf '        %-24s actual   %s rows / %s\n' "" "$actual_rows" "${actual_digest:0:16}"
        failed=1
    fi
done < <(python3 -c "
import json, sys
m = json.load(open('${MANIFEST}'))
for t in m['tables']:
    # An empty table hashes to the empty string on the SQL side, because
    # string_agg over zero rows is NULL -> coalesce. Match that here rather
    # than reporting a spurious mismatch for every not-yet-used collection.
    print('\t'.join([t['table'], str(t['rows']), t['pathDigest'] if t['rows'] else '']))
")

echo
if [[ "$failed" -eq 0 ]]; then
    echo "all tables match the export manifest"
else
    echo "MISMATCH — do not proceed to cutover" >&2
fi
exit "$failed"
