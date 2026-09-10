#!/usr/bin/env bash
# Drives launch-telemetry-ingest.sh's pure helpers against fixture inputs —
# no ssh, no psql, no docker, no network, no real intervu.env. Sourcing the
# script (rather than executing it) relies on its BASH_SOURCE guard to skip
# main() entirely, so this test never fires a real credential-provisioning
# run.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FX="$(mktemp -d)"
trap 'rm -rf "$FX"' EXIT

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

# Source the real script for real, with AGENT_PG_URL/BATCH_PG_URL guards
# satisfied (main() is still never invoked — only sourcing happens — but
# `main` itself is defined via `main() { ... }` so defining it does not run
# it; the guards only fire inside main()).
# shellcheck disable=SC1091  # dynamic path ($SCRIPT_DIR); it's this file's own sibling
source "$SCRIPT_DIR/launch-telemetry-ingest.sh"
# The sourced script installs its own `trap cleanup EXIT` and turns on
# `set -e` — sourcing runs in THIS shell, not a subshell, so both leak into
# this test harness. Re-assert this harness's own trap so $FX still gets
# removed, and so the sourced script's cleanup() (whose last command is a
# deliberately-false `[[ -n "$URL_FILE" ]]` since no real run ever happened)
# doesn't silently become this script's own exit status.
trap 'rm -rf "$FX"' EXIT

# --- is_valid_generated_password ------------------------------------------
long_alnum="$(printf 'A%.0s' $(seq 1 40))"
if is_valid_generated_password "$long_alnum"; then r=pass; else r=fail; fi
check "40-char alnum password: valid" "$r" pass

if is_valid_generated_password "short1"; then r=pass; else r=fail; fi
check "6-char password: rejected (too short)" "$r" fail

long_with_slash="$(printf 'A%.0s' $(seq 1 39))/"
if is_valid_generated_password "$long_with_slash"; then r=pass; else r=fail; fi
check "40-char password containing / : rejected (URL-unsafe)" "$r" fail

# --- compose_telemetry_pg_url ----------------------------------------------
# DB_HOST/DB_PORT/DB_NAME already carry the sourced script's own defaults
# (169.58.140.49/5432/postgres) — no override needed to exercise this.
got_url="$(compose_telemetry_pg_url 'sekret123')"
check "compose_telemetry_pg_url builds expected URL" "$got_url" "postgresql://telemetry_pg:sekret123@169.58.140.49:5432/postgres"

# --- ops_check_left_crit ----------------------------------------------------
if ops_check_left_crit "crit"; then r=pass; else r=fail; fi
check "ops_check_left_crit('crit'): still crit -> fail" "$r" fail

if ops_check_left_crit "ok"; then r=pass; else r=fail; fi
check "ops_check_left_crit('ok'): left crit -> pass" "$r" pass

if ops_check_left_crit ""; then r=pass; else r=fail; fi
check "ops_check_left_crit(''): unobservable -> fail, not a pass" "$r" fail

# --- install_env_key: the required minimum (replace, not duplicate; add when absent) ---
fixture="$FX/intervu.env"
cat > "$fixture" <<'EOF'
FOO=bar
TELEMETRY_PG_URL=postgresql://old:oldpw@old-host:5432/old
BAZ=qux
EOF

install_env_key "$fixture" TELEMETRY_PG_URL "postgresql://telemetry_pg:NEWPW@169.58.140.49:5432/postgres"

# `|| true` on every grep -c below is load-bearing, not decoration: sourcing
# launch-telemetry-ingest.sh above turned on `set -e` in THIS shell (its own
# `set -euo pipefail` leaks into the sourcing shell), and `grep -c` exits 1
# whenever its count is zero — exactly the shape a real regression here
# would produce. Without the guard, that exact failure aborts this whole
# harness on the spot (no FAIL line, no banner, remaining checks silently
# skipped — see finding #5) instead of landing in `check` as a reported
# mismatch.
occurrences="$(grep -c '^TELEMETRY_PG_URL=' "$fixture")" || true
check "install_env_key (existing key): exactly one TELEMETRY_PG_URL line remains" "$occurrences" 1

new_value="$(sed -n 's/^TELEMETRY_PG_URL=//p' "$fixture" | tail -1)"
check "install_env_key (existing key): line holds the NEW value" "$new_value" "postgresql://telemetry_pg:NEWPW@169.58.140.49:5432/postgres"

still_has_foo="$(grep -c '^FOO=bar$' "$fixture")" || true
check "install_env_key (existing key): unrelated FOO=bar line untouched" "$still_has_foo" 1

still_has_baz="$(grep -c '^BAZ=qux$' "$fixture")" || true
check "install_env_key (existing key): unrelated BAZ=qux line untouched" "$still_has_baz" 1

# Second fixture: key absent entirely -> must be appended, not silently dropped.
fixture2="$FX/intervu-no-key.env"
cat > "$fixture2" <<'EOF'
FOO=bar
BAZ=qux
EOF

install_env_key "$fixture2" TELEMETRY_PG_URL "postgresql://telemetry_pg:FRESH@169.58.140.49:5432/postgres"

occurrences2="$(grep -c '^TELEMETRY_PG_URL=' "$fixture2")" || true
check "install_env_key (absent key): exactly one TELEMETRY_PG_URL line added" "$occurrences2" 1

added_value="$(sed -n 's/^TELEMETRY_PG_URL=//p' "$fixture2" | tail -1)"
check "install_env_key (absent key): added line holds the given value" "$added_value" "postgresql://telemetry_pg:FRESH@169.58.140.49:5432/postgres"

# Third fixture: pre-existing DUPLICATE keys (drift already present) -> must
# collapse to exactly one line holding the new value, not grow to three.
fixture3="$FX/intervu-dup.env"
cat > "$fixture3" <<'EOF'
TELEMETRY_PG_URL=postgresql://first:pw@h:5432/d
FOO=bar
TELEMETRY_PG_URL=postgresql://second:pw@h:5432/d
EOF

install_env_key "$fixture3" TELEMETRY_PG_URL "postgresql://telemetry_pg:COLLAPSED@169.58.140.49:5432/postgres"

occurrences3="$(grep -c '^TELEMETRY_PG_URL=' "$fixture3")" || true
check "install_env_key (pre-existing duplicate keys): collapses to exactly one line" "$occurrences3" 1

# The count check above is hollow on its own: mutating the awk body's
# `if (!done) { print line; ... }` to `print $0` still prints exactly one
# TELEMETRY_PG_URL= line here (the first duplicate, echoed back unchanged;
# the second is still dropped by the `done` guard) — same count, wrong
# value. Only a value assertion on the surviving line catches that.
new_value3="$(sed -n 's/^TELEMETRY_PG_URL=//p' "$fixture3" | tail -1)"
check "install_env_key (pre-existing duplicate keys): surviving line holds the NEW value" "$new_value3" "postgresql://telemetry_pg:COLLAPSED@169.58.140.49:5432/postgres"

# Fourth fixture: a DIFFERENT key that happens to have the installed key's
# name as a SUFFIX (OLD_TELEMETRY_PG_URL vs TELEMETRY_PG_URL). This is the
# collision `index($0, key "=") == 1` (anchored at column 1) exists to
# prevent: mutating that to `> 0` (match anywhere in the line) treats this
# earlier OLD_ line as the first "hit" for the target key, overwrites IT in
# place with the new value, and then drops the real TELEMETRY_PG_URL= line
# that follows once `done` is already set — a real file containing, say, a
# backed-up OLD_TELEMETRY_PG_URL would be silently destroyed. A line-count
# check alone cannot see this (both the destroyed line and the correct
# line's replacement land on a "TELEMETRY_PG_URL=" prefix, so the count and
# even the target's own value still look right) — only checking that the
# UNRELATED colliding line survives verbatim catches it.
fixture4="$FX/intervu-suffix-collision.env"
cat > "$fixture4" <<'EOF'
OLD_TELEMETRY_PG_URL=postgresql://must:survive@unchanged:5432/db
TELEMETRY_PG_URL=postgresql://old:oldpw@old-host:5432/old
FOO=bar
EOF

install_env_key "$fixture4" TELEMETRY_PG_URL "postgresql://telemetry_pg:SUFFIXOK@169.58.140.49:5432/postgres"

collision_line="$(grep '^OLD_TELEMETRY_PG_URL=' "$fixture4")" || true
check "install_env_key (key-name-as-suffix collision): unrelated OLD_TELEMETRY_PG_URL line survives unchanged" "$collision_line" "OLD_TELEMETRY_PG_URL=postgresql://must:survive@unchanged:5432/db"

target_value4="$(sed -n 's/^TELEMETRY_PG_URL=//p' "$fixture4" | tail -1)"
check "install_env_key (key-name-as-suffix collision): TELEMETRY_PG_URL itself still updated correctly" "$target_value4" "postgresql://telemetry_pg:SUFFIXOK@169.58.140.49:5432/postgres"

# --- read_key_from_deploy_dir ----------------------------------------------
depdir="$FX/deploy-dir"
mkdir -p "$depdir"
cat > "$depdir/intervu.env" <<'EOF'
FOO=bar
AGENT_PG_URL=postgresql://agent_pg:fakeagentpw@example:5432/postgres
EOF
cat > "$depdir/subspace.env" <<'EOF'
BATCH_PG_URL=postgresql://pipeline:fakebatchpw@example:5432/postgres
EOF
# Three exclusion-candidate fixtures, each the SOLE guard for a different
# filename shape. This is what actually proves the two guards at :236/:239
# work: each fixture defines an already-used key with a DIFFERING fake
# value, so admitting it flips that key's lookup into the ambiguity branch
# (two disagreeing files -> refuse to pick one) and turns the got_agent /
# got_batch checks below RED. A fixture that the code excludes BEFORE it can
# ever disagree with anything proves nothing about the guard that excludes
# it.
#   subspace.bak.env                 -> matches "*.env", so ONLY the
#                                        *.bak* case at :239 excludes it.
#   intervu.env.old                  -> contains no ".bak", so ONLY the
#                                        "*.env" glob at :236 excludes it.
#   subspace.env.bak.20260904035723  -> excluded by BOTH guards at once (the
#                                        real-world shape seen on the box);
#                                        kept for that realism, not as a
#                                        guard proof — it cannot fail if
#                                        either guard alone is dropped.
cat > "$depdir/subspace.bak.env" <<'EOF'
BATCH_PG_URL=postgresql://pipeline:STALEBAKGUARDFAKE@example:5432/postgres
EOF
cat > "$depdir/intervu.env.old" <<'EOF'
AGENT_PG_URL=postgresql://agent_pg:STALEOLDGUARDFAKE@example:5432/postgres
EOF
cat > "$depdir/subspace.env.bak.20260904035723" <<'EOF'
BATCH_PG_URL=postgresql://pipeline:OLDSTALEFAKEVALUE@example:5432/postgres
EOF

# `|| true` here too (see the note above the first grep -c): a regression
# that makes read_key_from_deploy_dir wrongly hit its own error branch would
# `return 1`, and without the guard that aborts the harness silently instead
# of landing in `check` as a reported (empty-vs-expected) mismatch.
got_agent="$(read_key_from_deploy_dir "$depdir" AGENT_PG_URL)" || true
check "read_key_from_deploy_dir: finds AGENT_PG_URL in intervu.env" "$got_agent" "postgresql://agent_pg:fakeagentpw@example:5432/postgres"

got_batch="$(read_key_from_deploy_dir "$depdir" BATCH_PG_URL)" || true
check "read_key_from_deploy_dir: finds BATCH_PG_URL in subspace.env, ignoring the .bak with a different value" "$got_batch" "postgresql://pipeline:fakebatchpw@example:5432/postgres"

# Two non-backup files disagreeing on the same key must fail, never silently
# pick one.
depdir2="$FX/deploy-dir-ambiguous"
mkdir -p "$depdir2"
echo 'SOME_KEY=value-one' > "$depdir2/a.env"
echo 'SOME_KEY=value-two' > "$depdir2/b.env"
if read_key_from_deploy_dir "$depdir2" SOME_KEY >/dev/null 2>&1; then r=pass; else r=fail; fi
check "read_key_from_deploy_dir: two non-backup files disagreeing on a key -> fails rather than picking one" "$r" fail

# Key present nowhere must fail, never print empty and call it OK.
depdir3="$FX/deploy-dir-missing"
mkdir -p "$depdir3"
echo 'UNRELATED=1' > "$depdir3/c.env"
if read_key_from_deploy_dir "$depdir3" MISSING_KEY >/dev/null 2>&1; then r=pass; else r=fail; fi
check "read_key_from_deploy_dir: key absent from every file -> fails" "$r" fail

# step 2 captures the remote leg's whole stdout as the password. Real psql
# prints its command tag ("ALTER ROLE") to stdout, so anything the remote
# script lets through lands in front of the password and the local validator
# rejects it — exactly how the first real run died on 2026-09-09. Emulate
# ssh/sudo/psql locally with psql's real stdout behaviour and assert the
# staged URL carries only the alphanumeric password.
ssh() { bash -s; }
sudo() { shift 2; "$@"; }
psql() { cat >/dev/null; echo "ALTER ROLE"; }
export -f sudo psql
got_shape="$(
  DB_SSH=fake-db step2_set_password >/dev/null 2>&1 || exit 1
  sed -E 's#^postgresql://telemetry_pg:[A-Za-z0-9]{32,}@[^/]+/postgres$#SHAPE_OK#' "$URL_FILE"
  rm -f "$URL_FILE"
)" || got_shape="step2_set_password died (rc=$?)"
unset -f ssh sudo psql
check "step2_set_password: psql's command tag on the remote stdout never leaks into the staged password" "$got_shape" "SHAPE_OK"

echo
if [[ "$fail" -eq 0 ]]; then
  echo "ALL TESTS PASSED"
else
  echo "TESTS FAILED" >&2
fi
exit "$fail"
