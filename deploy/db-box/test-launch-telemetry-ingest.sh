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

occurrences="$(grep -c '^TELEMETRY_PG_URL=' "$fixture")"
check "install_env_key (existing key): exactly one TELEMETRY_PG_URL line remains" "$occurrences" 1

new_value="$(sed -n 's/^TELEMETRY_PG_URL=//p' "$fixture" | tail -1)"
check "install_env_key (existing key): line holds the NEW value" "$new_value" "postgresql://telemetry_pg:NEWPW@169.58.140.49:5432/postgres"

still_has_foo="$(grep -c '^FOO=bar$' "$fixture")"
check "install_env_key (existing key): unrelated FOO=bar line untouched" "$still_has_foo" 1

still_has_baz="$(grep -c '^BAZ=qux$' "$fixture")"
check "install_env_key (existing key): unrelated BAZ=qux line untouched" "$still_has_baz" 1

# Second fixture: key absent entirely -> must be appended, not silently dropped.
fixture2="$FX/intervu-no-key.env"
cat > "$fixture2" <<'EOF'
FOO=bar
BAZ=qux
EOF

install_env_key "$fixture2" TELEMETRY_PG_URL "postgresql://telemetry_pg:FRESH@169.58.140.49:5432/postgres"

occurrences2="$(grep -c '^TELEMETRY_PG_URL=' "$fixture2")"
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

occurrences3="$(grep -c '^TELEMETRY_PG_URL=' "$fixture3")"
check "install_env_key (pre-existing duplicate keys): collapses to exactly one line" "$occurrences3" 1

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

got_agent="$(read_key_from_deploy_dir "$depdir" AGENT_PG_URL)"
check "read_key_from_deploy_dir: finds AGENT_PG_URL in intervu.env" "$got_agent" "postgresql://agent_pg:fakeagentpw@example:5432/postgres"

got_batch="$(read_key_from_deploy_dir "$depdir" BATCH_PG_URL)"
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

echo
if [[ "$fail" -eq 0 ]]; then
  echo "ALL TESTS PASSED"
else
  echo "TESTS FAILED" >&2
fi
exit "$fail"
