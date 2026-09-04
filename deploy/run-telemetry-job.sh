#!/usr/bin/env bash
# Runs one of intervu's telemetry derived-table jobs ON THE HOST.
#
#   run-telemetry-job.sh build-job-features
#   run-telemetry-job.sh roll-up-telemetry [--window-days=N]
#
# WHY THIS FILE EXISTS — the three traps it is the answer to, each measured
# on the box 2026-09-04 rather than assumed:
#
#  1. A DEPLOYED SCRIPT IS NOT A RUNNABLE SCRIPT. /opt/intervu is the full
#     repo source (scripts/, src/, tsconfig.json, package.json all present)
#     but has NO node_modules and NO .env.local. `npx tsx scripts/foo.ts`
#     there fails on module resolution, and even with modules it would fail
#     as "BATCH_PG_URL is not set" — a *placement* error wearing a
#     *credential* error's clothes, because dotenv does not throw on a
#     missing file. This script supplies both halves explicitly.
#
#  2. THE CONTAINER IS NOT AN OPTION, and that is a deliberate posture, not
#     an oversight. These are PIPELINE-tier jobs: they need BATCH_PG_URL
#     (the `pipeline` write role) and MEILI_ADMIN_KEY. The intervu compose
#     env carries NEITHER — it has a Meili *search* key and no pipeline
#     credential (key names enumerated 2026-09-04). Reaching these jobs over
#     HTTP the way run-weekly-digest.sh does would mean moving the
#     pipeline's write credentials onto the public web surface to make the
#     pattern fit. run-weekly-digest.sh is correct *because the digest is a
#     web-tier job* — it needs nothing the web tier does not already hold.
#     The precedent is about credential placement, not about HTTP.
#
#  3. A CRON LINE CAN ABORT EVERY FUTURE SUBSPACE DEPLOY. The subspace
#     crontab.conf is reinstalled verbatim on every ship, and
#     validate-crontab-scripts.mjs aborts the deploy on any `scripts/...`
#     reference it cannot resolve against the SUBSPACE repo root. This
#     file's absolute path contains no `scripts/` segment, so a cron line
#     naming it is safe by construction — the same structural reason
#     run-weekly-digest.sh's line has been safe for months. Cron must call
#     THIS path, never `npx tsx .../scripts/....ts` directly.
#
# Credentials are read from the host env file one key at a time and exported.
# They never appear in argv, where `crontab -l` and `ps` print them in full.
set -uo pipefail

JOB="${1:-}"
shift || true

INTERVU_ROOT="${INTERVU_ROOT:-/opt/intervu}"
ENV_FILE="${INTERVU_JOB_ENV_FILE:-/opt/interview-os/.env.local}"
LOG="${INTERVU_JOB_LOG:-$HOME/logs/intervu-telemetry-jobs.log}"
LOCK="${INTERVU_JOB_LOCK:-/tmp/intervu-telemetry-$JOB.lock}"
TIMEOUT="${INTERVU_JOB_TIMEOUT:-3600}"

mkdir -p "$(dirname "$LOG")"
log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${JOB:-?}" "$*" >>"$LOG"; }

# A name, not a path. The character class is the whole gate: it admits any
# job this repo may add later while making `../` and absolute paths
# unrepresentable. Deliberately NOT a list of known job names — a gate that
# enumerates the jobs someone thought of stops being a gate the day someone
# adds one.
if [[ ! "$JOB" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    log "FAIL usage: $(basename "$0") <job-name> [args] — got '${JOB}'"
    exit 2
fi

SCRIPT="$INTERVU_ROOT/scripts/$JOB.ts"
if [[ ! -f "$SCRIPT" ]]; then
    log "FAIL no such job: $SCRIPT does not exist (deploy stale, or job renamed)"
    exit 2
fi

# EVERY external command this script depends on, resolved up front.
#
# This exists because two of them fail *misleadingly* rather than loudly:
#
#   flock   — `if ! flock -n 9` cannot tell "lock is held" (exit 1) from
#             "flock is not installed" (exit 127). Both take the SKIP branch,
#             and SKIP exits 0. A missing flock would therefore make every
#             single run report success while never starting the job — the
#             precise silent-success failure this whole subsystem exists to
#             detect, reproduced inside its own scheduler.
#   timeout — exits 127 through the job's own exit path, logging
#             "FAIL exit=127 ... see the traceback above" and pointing a
#             reader at a traceback that does not exist, for a job that never
#             started. A missing dependency must never be reportable as a job
#             failure.
#
# Resolving both here, before either is used, collapses those two failure
# modes into one honest message. GNU coreutils is `timeout` on Linux and
# `gtimeout` where it is installed g-prefixed; same tool, so accepting both
# is portability, not a fallback that drops the protection.
TIMEOUT_BIN=""
for c in timeout gtimeout; do
    if command -v "$c" >/dev/null 2>&1; then TIMEOUT_BIN="$c"; break; fi
done
missing=()
[[ -n "$TIMEOUT_BIN" ]] || missing+=("timeout (or gtimeout)")
#
# sed/tail/tr are here for the same reason, one step removed: read_key below
# is built from them, so if any is absent every key reads back empty and the
# wrapper reports "BATCH_PG_URL missing from <env file>" — sending whoever
# reads that to inspect an env file which is perfectly fine. A missing tool
# must not be able to impersonate a missing credential either.
for c in flock npm sed tail tr; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
done
if (( ${#missing[@]} )); then
    log "FAIL missing required command(s): ${missing[*]} — refusing to run (a missing tool here reports success without running the job)"
    exit 1
fi

if [[ ! -r "$ENV_FILE" ]]; then
    log "FAIL cannot read $ENV_FILE"
    exit 1
fi

# Only the keys these jobs need, and only their values — sourcing the whole
# file would pull ~46 unrelated credentials into this shell for no reason.
# `tail -1`, not `head -1`: dotenv's last-assignment-wins is the semantics
# the scripts themselves get, and this file is known to assign at least one
# key twice. Matching that exactly means the job cannot read a different
# value here than it would read from dotenv.
read_key() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"'"'"'\r'; }

BATCH_PG_URL="$(read_key BATCH_PG_URL)"
if [[ -z "$BATCH_PG_URL" ]]; then
    log "FAIL BATCH_PG_URL missing from $ENV_FILE"
    exit 1
fi
export BATCH_PG_URL

# Supplied when present; NOT required here. build-job-features enforces its
# own Meili requirement and says so by name, and roll-up-telemetry needs
# neither — so the wrapper must not invent a requirement the job does not
# have. Each job stays the authority on what it needs.
for k in MEILI_URL MEILI_ADMIN_KEY; do
    v="$(read_key "$k")"
    [[ -n "$v" ]] && export "$k=$v"
done
unset v

# The deploy replaces /opt/intervu wholesale, so node_modules is absent after
# every deploy unless it is carried across the swap. Self-healing rather than
# relying on an operator remembering a recipe step: the failure this repairs
# is invisible until a scheduled job silently stops running. `npm ci` (not
# `npm install`) so versions come from the lockfile already on the box, and
# not --omit=dev: `tsx` and `dotenv` are both devDependencies here.
if [[ ! -x "$INTERVU_ROOT/node_modules/.bin/tsx" ]]; then
    log "deps: node_modules/.bin/tsx absent — running npm ci in $INTERVU_ROOT (first run after a deploy)"
    # --include=dev is not optional: tsx is a devDependency, and npm omits
    # devDependencies when NODE_ENV is "production".
    if ! (cd "$INTERVU_ROOT" && npm ci --include=dev --no-audit --no-fund >>"$LOG" 2>&1); then
        log "FAIL npm ci failed — job did not run"
        exit 1
    fi
    # Assert the post-condition rather than trusting npm's exit status. This
    # catches the NODE_ENV case above and every other reason tsx could be
    # absent from a "successful" install; without it the job dies at the exec
    # below with "no such file or directory" and is logged as a job failure
    # pointing at a traceback that was never written.
    if [[ ! -x "$INTERVU_ROOT/node_modules/.bin/tsx" ]]; then
        log "FAIL npm ci exited 0 but node_modules/.bin/tsx is still missing — refusing to run" \
            "(tsx is a devDependency; check NODE_ENV and that package.json still declares it)"
        exit 1
    fi
    log "deps: npm ci OK"
fi

started="$(date +%s)"
# -n, never a blocking wait: two copies of a nightly rollup queueing up behind
# each other is a worse failure than a skipped run, and a skip that says so is
# recoverable. Reported at the same level as any other refusal to run.
exec 9>"$LOCK"
if ! flock -n 9; then
    log "SKIP another run still holds $LOCK — not starting a second one"
    exit 0
fi

cd "$INTERVU_ROOT" || { log "FAIL cannot cd $INTERVU_ROOT"; exit 1; }
"$TIMEOUT_BIN" --signal=TERM --kill-after=60 "$TIMEOUT" \
    ./node_modules/.bin/tsx "scripts/$JOB.ts" "$@" >>"$LOG" 2>&1
rc=$?
elapsed=$(( $(date +%s) - started ))

# Liveness is judged by intervu.job_heartbeats, which each job writes itself
# (including on failure, with ok=false and the real row count reached). This
# log line is for a human reading back a specific run, not the health signal.
case "$rc" in
    0)   log "OK   exit=0 ${elapsed}s" ;;
    124) log "FAIL TIMEOUT after ${TIMEOUT}s — killed; heartbeat will show ok=false or be stale" ;;
    *)   log "FAIL exit=$rc ${elapsed}s — see the traceback above this line" ;;
esac
exit "$rc"
