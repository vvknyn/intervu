#!/usr/bin/env bash
# Closes the last two human-only steps of the telemetry ingest launch
# (RUNBOOK-telemetry-launch.md §2 and §3) end to end, run from Vivek's Mac,
# and then PROVES the ingest path actually moved — not just that each step
# exited 0.
#
# WHY THIS EXISTS (measured 2026-09-04, not re-derived here — see the
# RUNBOOK for the full trail). Telemetry ingest has never received a single
# row. The sole established cause is `[telemetry] no pg pool configured
# (TELEMETRY_PG_URL unset?)`: the key is absent from the container env while
# every other `*_PG_URL` key is present. Role telemetry_pg already exists
# with exactly INSERT on intervu.telemetry_events, and pg_hba already admits
# it from the app box. Missing:
#   (a) telemetry_pg's password was never set
#   (b) TELEMETRY_PG_URL was never added to the app box's env file
#
# WHAT THIS SCRIPT DOES, IN ORDER (every step idempotent, every failure
# fatal with a specific message — see each step_* function below):
#   1. preflight        re-run preflight-telemetry-connectivity.sh (the
#                        existing credential-free pg_hba gate) exactly ONCE
#                        — every run costs one failed auth per role against
#                        the DB box, per that script's own header. Abort
#                        here: none of the later steps can succeed without
#                        this, and running them anyway would leave a
#                        half-applied state (password set, container
#                        rebuilt, still unable to connect).
#   2. set_password     generate an alphanumeric-only, >=MIN_PASSWORD_LEN
#                        char password on the DB box with `openssl rand`,
#                        and set it with `ALTER ROLE telemetry_pg
#                        PASSWORD :'pw'` fed to psql over STDIN (heredoc +
#                        \set) — never -c, never -v: both put the plaintext
#                        in argv, and `ps` is world-readable on that box.
#   3. install_env_key  compose the postgresql:// URL and install it as
#                        TELEMETRY_PG_URL in the app box's intervu.env,
#                        replacing an existing line in place rather than
#                        appending a duplicate (a duplicated key is a real
#                        silent-drift trap: dotenv is last-assignment-wins,
#                        so a file with two different values for the same
#                        key lies about which one is actually in effect).
#                        Timestamped backup taken first, matching this
#                        dir's own intervu.env.bak-<label> convention.
#   4. rebuild           /opt/interview-os/deploy/contabo-web/deploy.sh —
#                        NOT `docker compose up -d --force-recreate` and NOT
#                        a restart. docker-compose.yml consumes intervu.env
#                        BOTH as a build secret (gated by an ENV_DIGEST
#                        build-arg cache-buster) AND as the runtime
#                        env_file, so an env change needs a rebuild, not a
#                        recreate. deploy.sh derives INTERVU_ENV_DIGEST from
#                        the file's own sha256 and runs `docker compose up
#                        -d --build --remove-orphans`. A future reader will
#                        otherwise "just restart it" and the new key will
#                        silently not take — see
#                        RUNBOOK-telemetry-launch.md's §4 for the full
#                        correction.
#   5. verify_grants     re-read TELEMETRY_PG_URL back OUT of intervu.env on
#                        the app box (never reuse this script's own
#                        in-memory copy — a typo introduced by step 3 must
#                        fail HERE, not pass because we asked ourselves
#                        instead of the file the container actually reads)
#                        and run the existing verify-telemetry-grants.sh
#                        from the app box with real credentials.
#   6. prove_e2e          poll, with a bounded timeout, for BOTH (a) `select
#                        count(*) from intervu.telemetry_events` becoming >
#                        0 and (b) the telemetry.ingest_starvation row in
#                        ops_check_results leaving 'crit'. Reported
#                        SEPARATELY: they can legitimately diverge (a row
#                        can land while a slow-moving health check hasn't
#                        re-evaluated yet, or vice versa), and collapsing
#                        them to one boolean would hide that.
#
# WHAT THIS SCRIPT DELIBERATELY DOES NOT DO. It never writes a synthetic row
# into intervu.telemetry_events to "prove" ingest. A previous synthetic
# insert/delete here was exactly reversible in the table itself but NOT in
# pg_stat_user_tables, and the leftover n_tup_ins=1 / n_tup_del=1 made the
# live telemetry.ingest_freshness_h check publish "1 row(s) were inserted
# and are gone" — which reads as data loss to anyone who looks at that
# counter later. Step 6 only ever reads. Proving real traffic lands means
# generating some (e.g. browsing the live site) while step 6 is polling.
#
# SECRET HANDLING (load-bearing, not decoration). The telemetry_pg password
# this script generates is NEVER: echoed to the terminal, passed as a
# command-line argument to any process (local or remote — `ps` is
# world-readable on both boxes), or written unencrypted to disk outside a
# 0600 file. It crosses box boundaries only over an SSH session's own
# stdin, via this script's heredocs — the same mechanism the RUNBOOK itself
# prescribes for the ALTER ROLE statement — never as part of an ssh command
# line, which would land in that command's own argv on both ends. It is
# also briefly staged in a single local 0600 temp file ($URL_FILE below),
# removed by the trap on EXIT on every exit path, including a failure
# partway through. AGENT_PG_URL and BATCH_PG_URL are pre-existing,
# operator-managed secrets, not generated here — and, as of 2026-09-04, this
# script never asks the Mac for them at all. They already live on the app
# box (intervu.env / subspace.env under the deploy dir); step 5 and step 6
# each read them directly off that box, inside the same ssh session that
# uses them, via read_key_from_deploy_dir. Requiring them as `VAR=val` on
# the Mac's own invocation line was the earlier design, and it was wrong:
# it put two live production credentials into Vivek's shell history for no
# benefit, since both were already reachable from the app box.
#
# WHAT THIS SCRIPT DOES NOT PROVE. Step 5 proves grants; step 6 proves rows
# can land and/or the starvation check can clear. Neither substitutes for
# scripts/verify-telemetry-e2e.ts (RUNBOOK §7) — the actual launch gate,
# which posts one real event over real HTTP and reads it back over a
# DIFFERENT connection than ingest used. Run that separately.
#
# Env overrides (all optional — nothing is required on the Mac's own
# invocation; see SECRET HANDLING above for why AGENT_PG_URL/BATCH_PG_URL are
# deliberately not among these):
#   DB_SSH            ssh target for the DB box (default root@169.58.140.49)
#   APP_SSH           ssh target for the app box (default subspace@194.163.147.154)
#   DB_HOST/DB_PORT/DB_NAME  connection coordinates baked into the composed
#                     TELEMETRY_PG_URL (defaults 169.58.140.49 / 5432 /
#                     postgres — same defaults as
#                     preflight-telemetry-connectivity.sh)
#   ENV_FILE          app box env file (default
#                     /opt/interview-os/deploy/contabo-web/intervu.env) —
#                     also fixes the deploy dir that read_key_from_deploy_dir
#                     searches for AGENT_PG_URL/BATCH_PG_URL
#   MIN_PASSWORD_LEN  minimum generated-password length (default 32)
#   POLL_TIMEOUT_S    step 6 bound, seconds (default 600)
#   POLL_INTERVAL_S   step 6 per-check interval, seconds (default 15)
#
# Dependency-free beyond ssh/psql/docker/openssl, like every other script in
# deploy/db-box/ — psql, openssl and docker all run on the DB/app boxes over
# ssh, never on the machine invoking this script.
set -euo pipefail

# pg_env_from_url/psql_from_url live in lib/pg-env.sh, shared with every
# other db-box script that needs a libpq connection from a *_PG_URL value.
# No fallback if this file is missing next to a copy of this script — `set
# -e` above fails the whole run loudly, which is the correct behavior.
source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-env.sh"

DB_SSH="${DB_SSH:-root@169.58.140.49}"
APP_SSH="${APP_SSH:-subspace@194.163.147.154}"
DB_HOST="${DB_HOST:-169.58.140.49}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
ENV_FILE="${ENV_FILE:-/opt/interview-os/deploy/contabo-web/intervu.env}"
MIN_PASSWORD_LEN="${MIN_PASSWORD_LEN:-32}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-600}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-15}"

PREFLIGHT_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/preflight-telemetry-connectivity.sh"
VERIFY_SCRIPT_REMOTE="/opt/intervu/deploy/db-box/verify-telemetry-grants.sh"

# Single scratch artifact for the whole run: a 0600 local temp file holding
# the composed TELEMETRY_PG_URL (see step2_set_password). One file, one
# variable — not an array — so cleanup can't trip the classic bash pitfall
# of "${arr[@]}" throwing "unbound variable" under `set -u` when the array
# is still empty (this script's own Mac ships bash 3.2, which has that bug;
# 4.4+ fixed it, but this must run correctly on 3.2 too).
URL_FILE=""
cleanup() {
  [[ -n "$URL_FILE" ]] && rm -f "$URL_FILE"
}
trap cleanup EXIT

die() {
  echo "FATAL: $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Pure helpers — no ssh, no psql, no network, no docker. Each is testable by
# sourcing this file (the BASH_SOURCE guard at the bottom skips main()) and
# calling it directly against fixture inputs.
# ---------------------------------------------------------------------------

# is_valid_generated_password <candidate>
# True iff <candidate> is alphanumeric-only and >= MIN_PASSWORD_LEN chars.
# Alphanumeric-only is load-bearing, not a style choice: the password is
# embedded in a postgresql:// URI, and any of / + = @ : in it would need
# percent-encoding — an unescaped one is a silent-corruption trap. The URL
# still "parses" either way; it just parses to a DIFFERENT, wrong password,
# and every symptom downstream looks like "the launch didn't work" rather
# than "the URL was malformed".
is_valid_generated_password() {
  local candidate="$1"
  [[ "$candidate" =~ ^[A-Za-z0-9]+$ ]] || return 1
  [[ "${#candidate}" -ge "$MIN_PASSWORD_LEN" ]]
}

# compose_telemetry_pg_url <password>
# Pure string composition, no I/O.
compose_telemetry_pg_url() {
  local password="$1"
  printf 'postgresql://telemetry_pg:%s@%s:%s/%s' "$password" "$DB_HOST" "$DB_PORT" "$DB_NAME"
}

# install_env_key <file> <key> <value>
# Rewrites <file> so exactly one line reads "<key>=<value>": replaces the
# FIRST existing "<key>=" line in place (dropping any further duplicate
# occurrences of that key — cleaning up pre-existing drift rather than
# adding to it), or appends a new line when the key is absent entirely.
# Never a second line for the same key: dotenv is last-assignment-wins, so a
# file with two different values for one key silently lies about which one
# is actually in effect. Pure text transform on a file path — no
# ssh/psql/network — so a test can drive it against a throwaway fixture
# file, never the real env file.
install_env_key() {
  local file="$1" key="$2" value="$3"
  local tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  chmod 600 "$tmp"
  if ! awk -v key="$key" -v line="${key}=${value}" '
    BEGIN { done = 0 }
    index($0, key "=") == 1 {
      if (!done) { print line; done = 1 }
      next
    }
    { print }
    END { if (!done) print line }
  ' "$file" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$file"
}

# read_key_from_deploy_dir <dir> <key>
# Searches every non-backup "*.env" file directly under <dir> for a line
# matching "^<key>=" and prints the value from the first one that has it.
# AGENT_PG_URL and BATCH_PG_URL already live on the app box (in intervu.env
# and subspace.env respectively, measured 2026-09-04) — this is the ONE
# chokepoint both step 5 and step 6 use to read them, on the box, instead of
# requiring them as Mac-side env vars (which would put live production
# credentials in Vivek's shell history for no reason: nothing needs to
# reach the Mac). Deliberately does NOT hardcode "AGENT_PG_URL is in
# intervu.env" — that pairing is incidental and would rot the moment a key
# moves to a different file; matching on the key itself, across every
# candidate file, is what makes this survive that.
# *.bak* files are always excluded: a stale backup holding an old value
# (e.g. subspace.env.bak.20260904035723) is a silent-wrong-credential trap,
# not a legitimate second source. If more than one non-backup file defines
# <key> with DIFFERING values, this refuses to guess and fails loudly —
# that ambiguity must be resolved by a human, not resolved silently by
# picking whichever file happened to sort first.
read_key_from_deploy_dir() {
  local dir="$1" key="$2"
  local file base v found_file="" value=""
  for file in "$dir"/*.env; do
    [[ -f "$file" ]] || continue
    base="${file##*/}"
    case "$base" in *.bak*) continue ;; esac
    v="$(sed -n "s/^${key}=//p" "$file" | tail -1)"
    [[ -n "$v" ]] || continue
    if [[ -z "$found_file" ]]; then
      found_file="$file"
      value="$v"
    elif [[ "$v" != "$value" ]]; then
      echo "$key is defined with DIFFERENT values in both $found_file and $file under $dir — refusing to pick one; resolve the drift by hand." >&2
      return 1
    fi
  done
  if [[ -z "$found_file" ]]; then
    echo "$key not found in any non-backup *.env file under $dir" >&2
    return 1
  fi
  printf '%s' "$value"
}

# ops_check_left_crit <status>
# True iff <status> — a raw value read from ops_check_results.status — is
# non-empty AND anything other than the literal 'crit'. Empty (no such row,
# or the query failed) is deliberately NOT "left crit": we cannot claim
# recovery from a state we could not observe. Kept separate from the psql
# call that produces <status> (step 6, prove_e2e) so the recovery predicate
# is unit-testable without a database, and so the SAME definition — via
# `declare -f`, never a second hand-copied version — runs both here and
# inside the remote polling loop step 6 builds. lib/pg-env.sh's own
# functions travel the same way, via that lib's `PG_ENV_FUNCS` list, so a
# helper added there is shipped automatically rather than needing a new
# `declare -f` line here.
ops_check_left_crit() {
  [[ -n "$1" && "$1" != "crit" ]]
}

# ---------------------------------------------------------------------------
# Steps. Each is I/O (ssh/psql/docker) around the pure helpers above; each
# fails via `die` with a specific, actionable message rather than a bare
# `set -e` abort.
# ---------------------------------------------------------------------------

step1_preflight() {
  echo "=== step 1: preflight pg_hba admission (single run, all three roles) ==="
  # Piped over ssh's stdin via `bash -s -- --run`, per
  # preflight-telemetry-connectivity.sh's own header: this runs it against a
  # box the repo need not be deployed to, and needs no local copy on either
  # end beyond the one already in this checkout.
  if ! ssh "$APP_SSH" 'bash -s' -- --run < "$PREFLIGHT_SCRIPT"; then
    die "preflight-telemetry-connectivity.sh failed from $APP_SSH — see FAIL lines above. None of steps 2-6 can succeed until pg_hba admits every role from here; aborting before anything is half-applied."
  fi
  echo "step 1 OK — pg_hba admits telemetry_pg/agent_pg/pipeline from $APP_SSH"
}

step2_set_password() {
  echo "=== step 2: generate + set telemetry_pg's password on $DB_SSH (heredoc + \\set — never -c/-v) ==="
  local pw
  if ! pw="$(ssh "$DB_SSH" bash -s <<'REMOTE_GEN'
set -euo pipefail
# cut -c1-48, not head -c 48: head closes the pipe as soon as it has its 48
# bytes, and under `set -o pipefail` that early close can make `tr` see
# SIGPIPE and report failure if its write ever blocks — a rare, hard-to-
# reproduce flake. cut reads the tr output to EOF, so there is no early close
# and no SIGPIPE window.
pw="$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | cut -c1-48)"
if [[ "${#pw}" -lt 32 ]]; then
  echo "generated candidate is only ${#pw} alphanumeric chars after stripping non-alphanumerics — openssl rand needs a larger input" >&2
  exit 1
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres >/dev/null <<SQL
\set pw '$pw'
ALTER ROLE telemetry_pg PASSWORD :'pw';
SQL
printf '%s' "$pw"
REMOTE_GEN
  )"; then
    die "could not generate/set telemetry_pg's password on $DB_SSH — see stderr above. No partial state to unwind: the role either has its old password (possibly none) or the new one, never a half-written value."
  fi

  is_valid_generated_password "$pw" || die "generated password failed local validation (alphanumeric, >=${MIN_PASSWORD_LEN} chars) — the remote leg's stdout must be exactly the password (psql's stdout is silenced there for this reason), so something else printed on that channel. Refusing to use it."

  URL_FILE="$(mktemp)"
  chmod 600 "$URL_FILE"
  compose_telemetry_pg_url "$pw" > "$URL_FILE"
  echo "step 2 OK — telemetry_pg password set on $DB_SSH (never printed; staged in a 0600 temp file, removed on exit)"
}

step3_install_env_key() {
  echo "=== step 3: install TELEMETRY_PG_URL into $ENV_FILE on $APP_SSH (backup first, replace not duplicate) ==="
  local url
  url="$(cat "$URL_FILE")"
  # Unquoted heredoc: $ENV_FILE and $url (the secret) are interpolated HERE,
  # on the Mac, into the text sent over ssh's stdin — never as part of the
  # ssh command line itself, which would land in argv on both ends. Escaped
  # \$-prefixed names below are evaluated on the APP BOX once this arrives,
  # e.g. the backup timestamp must be computed there, not here.
  # `$(declare -f install_env_key)` embeds this file's own function
  # definition verbatim so the exact same install logic this script's test
  # drives locally is what actually edits the real file — one definition,
  # not a hand-copied second version that could drift from it.
  # shellcheck disable=SC2087  # unquoted on purpose: $ENV_FILE/$url must
  # expand HERE, on the Mac, before the text ever leaves for the app box.
  if ! ssh "$APP_SSH" bash <<REMOTE_INSTALL
set -euo pipefail
env_file="$ENV_FILE"
ts="\$(date -u +%Y%m%dT%H%M%SZ)"
backup="\${env_file}.bak-\${ts}"
cp "\$env_file" "\$backup"
chmod 600 "\$backup"
$(declare -f install_env_key)
install_env_key "\$env_file" TELEMETRY_PG_URL "$url"
echo "installed TELEMETRY_PG_URL into \$env_file (backup: \$backup)"
REMOTE_INSTALL
  then
    die "installing TELEMETRY_PG_URL into $ENV_FILE on $APP_SSH failed — see stderr above. A timestamped backup was taken before any edit was attempted; re-run this script once the cause is fixed (install_env_key is idempotent)."
  fi
  echo "step 3 OK"
}

step4_rebuild() {
  echo "=== step 4: rebuild via deploy.sh on $APP_SSH (env change requires a rebuild, not a recreate — see header) ==="
  if ! ssh "$APP_SSH" 'cd /opt/interview-os/deploy/contabo-web && ./deploy.sh'; then
    die "deploy.sh failed on $APP_SSH — the running container may still have the OLD env. Do not proceed to step 5 until this is fixed and re-run."
  fi
  echo "step 4 OK"
}

step5_verify_grants() {
  echo "=== step 5: verify-telemetry-grants.sh from $APP_SSH, with real credentials ==="
  # Reads TELEMETRY_PG_URL back OUT of $ENV_FILE inside the remote script,
  # never from this script's own $URL_FILE — a typo introduced by step 3
  # must fail HERE, against the value the container actually reads, not
  # pass because we asked ourselves instead of the file. Same tail -1
  # parsing as RUNBOOK §6's read_key() (dotenv is last-assignment-wins).
  # AGENT_PG_URL and BATCH_PG_URL are read the same way — off the box, via
  # read_key_from_deploy_dir — never as Mac-side env vars (see SECRET
  # HANDLING in the header for why).
  # shellcheck disable=SC2087  # unquoted on purpose: $ENV_FILE and
  # $VERIFY_SCRIPT_REMOTE must expand HERE, on the Mac — never as literal
  # argv on the remote end.
  if ! ssh "$APP_SSH" bash <<REMOTE_VERIFY
set -euo pipefail
env_file="$ENV_FILE"
deploy_dir="\$(dirname "\$env_file")"
read_key() { sed -n "s/^\$1=//p" "\$env_file" | tail -1 | tr -d '"'"'"'\\r'; }
$(declare -f read_key_from_deploy_dir)
telemetry_url="\$(read_key TELEMETRY_PG_URL)"
if [[ -z "\$telemetry_url" ]]; then
  echo "TELEMETRY_PG_URL missing/empty in \$env_file after step 3 — refusing to verify" >&2
  exit 1
fi
agent_url="\$(read_key_from_deploy_dir "\$deploy_dir" AGENT_PG_URL)"
batch_url="\$(read_key_from_deploy_dir "\$deploy_dir" BATCH_PG_URL)"
verify_script="$VERIFY_SCRIPT_REMOTE"
if [[ ! -x "\$verify_script" ]]; then
  echo "\$verify_script not found or not executable on this box — the intervu app keystone deploy has not landed yet (see RUNBOOK-telemetry-launch.md's 'Deploy-order correction' section); step 4's rebuild alone does not create this file" >&2
  exit 1
fi
AGENT_PG_URL="\$agent_url" BATCH_PG_URL="\$batch_url" TELEMETRY_PG_URL="\$telemetry_url" "\$verify_script"
REMOTE_VERIFY
  then
    die "verify-telemetry-grants.sh failed (or a credential could not be read back) on $APP_SSH — see output above. Do not treat telemetry_pg as safe to deploy against; fix and re-run this script."
  fi
  echo "step 5 OK"
}

# run_poll_query <sql>
# NOT a pure helper (it shells out to psql) — kept next to step6, the only
# caller, rather than in the pure-helpers block above. Runs
# `psql -qAt -c <sql>`, merging stderr into the same capture: for a single
# `-c` statement psql prints nothing to stdout on failure and nothing to
# stderr on success, so the merge can't conflate a value with an error.
# On success: POLL_QUERY_VALUE=<psql's output>, POLL_QUERY_ERR="", returns 0.
# On failure: POLL_QUERY_VALUE="" (preserving the pre-existing "empty means
# unobservable" contract every caller already relies on — see
# ops_check_left_crit's own docblock) and POLL_QUERY_ERR=<first line of
# psql's stderr, capped to 200 chars>; returns psql's exit status. Exists so
# step6's poll can tell a wrong dbname, a wrong column name, and any other
# psql failure apart, instead of collapsing all of them into one generic
# "<query failed>" for the whole poll window. Embedded into the remote poll
# via `$(declare -f run_poll_query)`, same mechanism as the helpers below.
# shellcheck disable=SC2034  # POLL_QUERY_VALUE/POLL_QUERY_ERR are read from
# the REMOTE_POLL heredoc via "\$POLL_QUERY_VALUE"/"\$POLL_QUERY_ERR" —
# escaped so they expand on the remote box, not here — which shellcheck's
# single-file analysis can't see, so it (falsely) flags both as unused.
run_poll_query() {
  local sql="$1" out rc
  out="$(psql -qAt -c "$sql" 2>&1)"
  rc=$?
  if [[ "$rc" -eq 0 ]]; then
    POLL_QUERY_VALUE="$out"
    POLL_QUERY_ERR=""
  else
    POLL_QUERY_VALUE=""
    POLL_QUERY_ERR="$(printf '%s' "$out" | head -n1 | cut -c1-200)"
  fi
  return "$rc"
}

step6_prove_e2e() {
  echo "=== step 6: poll for real ingest — no synthetic row is ever written (see header) ==="
  echo "timeout=${POLL_TIMEOUT_S}s interval=${POLL_INTERVAL_S}s — generate a real hit (e.g. browse the live site) while this polls"
  # BATCH_PG_URL is read off the box, via read_key_from_deploy_dir, once at
  # the top of the loop — never as a Mac-side env var (see SECRET HANDLING
  # in the header).
  # shellcheck disable=SC2087  # unquoted on purpose: $ENV_FILE, $POLL_TIMEOUT_S
  # and $POLL_INTERVAL_S must expand HERE, on the Mac.
  if ssh "$APP_SSH" bash <<REMOTE_POLL
set -euo pipefail
env_file="$ENV_FILE"
deploy_dir="\$(dirname "\$env_file")"
$(declare -f ops_check_left_crit)
$(declare -f read_key_from_deploy_dir)
# shellcheck disable=SC2086  # unquoted on purpose: PG_ENV_FUNCS is a
# space-separated list of function names that must word-split for declare -f
# to see each one — see lib/pg-env.sh's own PG_ENV_FUNCS docblock.
$(declare -f $PG_ENV_FUNCS)
$(declare -f run_poll_query)
batch_url="\$(read_key_from_deploy_dir "\$deploy_dir" BATCH_PG_URL)"
pg_env_from_url "\$batch_url" || { echo "BATCH_PG_URL: not a parseable postgresql://user:pass@host[:port]/db URL" >&2; exit 1; }
deadline=\$(( \$(date +%s) + $POLL_TIMEOUT_S ))
count_ok=0
starv_ok=0
while [[ \$(date +%s) -lt \$deadline ]]; do
  if run_poll_query 'select count(*) from intervu.telemetry_events'; then
    count="\$POLL_QUERY_VALUE"
    count_disp="\$count"
  else
    count=""
    count_disp="<query failed: \$POLL_QUERY_ERR>"
  fi
  if run_poll_query "select status from ops_check_results where check_id = 'telemetry.ingest_starvation'"; then
    status="\$POLL_QUERY_VALUE"
    status_disp="\$status"
  else
    status=""
    status_disp="<query failed: \$POLL_QUERY_ERR>"
  fi
  echo "\$(date -u +%H:%M:%SZ)  telemetry_events count=\$count_disp  ingest_starvation status=\$status_disp"
  if [[ "\$count" =~ ^[0-9]+$ ]] && [[ "\$count" -gt 0 ]]; then count_ok=1; fi
  ops_check_left_crit "\$status" && starv_ok=1
  [[ "\$count_ok" -eq 1 && "\$starv_ok" -eq 1 ]] && break
  sleep $POLL_INTERVAL_S
done
echo
echo "RESULT telemetry_events count > 0:  \$([[ \$count_ok -eq 1 ]] && echo YES || echo 'NO (timed out)')"
echo "RESULT ingest_starvation left crit: \$([[ \$starv_ok -eq 1 ]] && echo YES || echo 'NO (timed out)')"
[[ "\$count_ok" -eq 1 && "\$starv_ok" -eq 1 ]]
REMOTE_POLL
  then
    echo "step 6 OK — both conditions observed"
  else
    die "step 6 timed out before BOTH conditions were met within ${POLL_TIMEOUT_S}s — see the two RESULT lines above for which one (they can legitimately diverge); that is the one that needs attention next, not necessarily both."
  fi
}

main() {
  step1_preflight
  step2_set_password
  step3_install_env_key
  step4_rebuild
  step5_verify_grants
  step6_prove_e2e
  echo
  echo "launch-telemetry-ingest.sh: all steps completed. See the two RESULT lines above for what step 6 actually proved — neither substitutes for scripts/verify-telemetry-e2e.ts (RUNBOOK §7), the actual launch gate."
}

# Only run main when this file is executed directly. Sourcing it (e.g. a
# test driving the pure helpers above in isolation) must not also fire real
# ssh/psql/docker commands against production boxes.
if [[ "${BASH_SOURCE[0]:-}" == "${0}" || "${1:-}" == "--run" ]]; then
  [[ "${1:-}" == "--run" ]] && shift
  main "$@"
fi
