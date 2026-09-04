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
# Keyed to $INTERVU_ROOT (sanitized), not $JOB — shared across every job
# name installing into the same tree (see the npm-ci block below for why
# this one must be shared, unlike the per-job LOCK above).
#
# Lives OUTSIDE $INTERVU_ROOT, deliberately: the intervu deploy is
# extract-then-swap (`mv $INTERVU_ROOT $INTERVU_ROOT.old`, a fresh tree
# takes its place at the same path), and `flock` locks the underlying
# INODE, not the path string. A default lock path inside the swapped tree
# means a deploy landing while one job holds the lock hands the NEXT job a
# DIFFERENT inode at the same path — acquired instantly, while the first
# holder's lock (and its still-running `npm ci`) sits orphaned on the old,
# unlinked inode. Two `npm ci` runs then proceed concurrently against the
# same fresh tree — exactly the race commit 9053dd4 closed, reopened by the
# deploy. `/tmp` is never touched by the swap, so a lock there survives it;
# `tr` (asserted present below, same as sed/tail) collapses the root path
# into one safe filename segment. That collapse is lossy — `tr -cs
# 'A-Za-z0-9' '_'` squeezes runs of non-alphanumerics, so distinct roots
# CAN collide on the same lock name (measured: /opt/intervu-a,
# /opt/intervu/a, /opt/intervu--a and /opt/intervu_a all collapse to
# `_opt_intervu_a`). The consequence is over-serialization, not corruption:
# two unrelated trees would share one install lock and queue behind each
# other, failing loudly at INSTALL_LOCK_TIMEOUT rather than corrupting a
# shared node_modules — conservative, and it can never produce the
# concurrent-`npm ci` race this lock exists to prevent.
INSTALL_LOCK="${INTERVU_JOB_INSTALL_LOCK:-/tmp/intervu-npm-ci-$(printf '%s' "$INTERVU_ROOT" | tr -cs 'A-Za-z0-9' '_').lock}"
INSTALL_LOCK_TIMEOUT="${INTERVU_JOB_INSTALL_LOCK_TIMEOUT:-600}"

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
#
# node_modules is shared by every job, but LOCK above is keyed to $JOB — so
# without the lock below, two different jobs starting close together both
# see tsx missing and both run `npm ci` into the same tree at once. `npm ci`
# deletes node_modules before repopulating it, so one run can delete the
# tree the other is mid-install into; the failure then surfaces later, in a
# job that "installed successfully", as a module-resolution error. Only a
# 30-minute gap between two cron lines has prevented this so far — a
# crontab coincidence, not a guarantee, and a third job or a manual run
# collapses it.
#
# INSTALL_LOCK fixes that: it is keyed to $INTERVU_ROOT (not $JOB), so every
# job installing into the same tree contends for the SAME lock, on fd 8 (fd
# 9 is the per-job LOCK below and must stay free for it). Unlike that job
# lock, this one must WAIT (`flock -w`, not `-n`): a waiter that skipped
# here would fall through to exec tsx out of a node_modules a concurrent
# holder is still deleting/repopulating — exactly the bug this closes.
# flock's own presence is already asserted above (:102-104), so a non-zero
# exit from `flock -w` below is unambiguously "timed out waiting", never the
# missing-binary case that makes a bare `flock -n` ambiguous (see the header
# comment this script opens with). 600s is ~4.6x the 2m10s cold-cache
# `npm ci` measured on this box 2026-09-04 (log 07:33:15Z "running npm ci" ->
# 07:35:25Z "npm ci OK") — real headroom for a slow disk or network hiccup,
# without letting a genuinely stuck install starve every job behind it.
if [[ ! -x "$INTERVU_ROOT/node_modules/.bin/tsx" ]]; then
    exec 8>"$INSTALL_LOCK"
    if ! flock -w "$INSTALL_LOCK_TIMEOUT" 8; then
        log "FAIL install lock $INSTALL_LOCK held by another job's npm ci for over ${INSTALL_LOCK_TIMEOUT}s — refusing to run against a possibly half-installed node_modules"
        exit 1
    fi
    # Double-checked: the holder above has almost always finished installing
    # by the time we get the lock, and re-running npm ci here would delete a
    # node_modules tree that is now correct.
    if [[ ! -x "$INTERVU_ROOT/node_modules/.bin/tsx" ]]; then
        log "deps: node_modules/.bin/tsx absent — running npm ci in $INTERVU_ROOT (first run after a deploy)"
        # --include=dev is not optional: tsx is a devDependency, and npm omits
        # devDependencies when NODE_ENV is "production".
        if ! (cd "$INTERVU_ROOT" && npm ci --include=dev --no-audit --no-fund >>"$LOG" 2>&1); then
            log "FAIL npm ci failed — job did not run"
            exit 1
        fi
    fi
    # Assert the post-condition rather than trusting npm's exit status. This
    # runs whether WE just ran npm ci above or another run did while we
    # waited for the lock — it must not become reachable only from the
    # install branch, because it is what catches the NODE_ENV case and every
    # other reason tsx could be absent from a "successful" install; without
    # it the job dies at the exec below with "no such file or directory" and
    # is logged as a job failure pointing at a traceback that was never
    # written.
    if [[ ! -x "$INTERVU_ROOT/node_modules/.bin/tsx" ]]; then
        log "FAIL npm ci exited 0 but node_modules/.bin/tsx is still missing — refusing to run" \
            "(tsx is a devDependency; check NODE_ENV and that package.json still declares it)"
        exit 1
    fi
    log "deps: npm ci OK"
    flock -u 8
    exec 8>&-
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

# A job that reaches its own try/catch writes its OWN terminal heartbeat
# in-process (src/lib/telemetry/heartbeat.ts) — including on failure, with
# ok=false and the real row count reached. But a child killed by SIGKILL, an
# OOM kill, or the timeout above never reaches that code, so it writes
# nothing there at all — a missing/stale row used to be equally consistent
# with "never started" and "started and died mid-run". This wrapper is the
# one thing that survives that death, so on ANY non-zero exit it records the
# failure itself, reusing BATCH_PG_URL already exported above (no new
# credential). That write is guarded (writeHeartbeat's onlyIfOlderThanSeconds
# in heartbeat.ts) to only land if the row was not already updated during
# this run, so a child that wrote its own richer row is never clobbered.
#
# $elapsed, not $started: the guard compares against the DB's own now() on
# the DB box, while this wrapper's clock is the APP box's. Passing $started
# (an absolute app-box timestamp) would make the guard's correctness depend
# on the two boxes' clocks agreeing. $elapsed is a duration computed
# entirely from this box's own two `date +%s` reads, so it carries no
# cross-box skew — the DB derives its own threshold via
# now() - make_interval(secs => $elapsed), comparing its own clock against
# itself.
if [[ "$rc" -ne 0 ]]; then
    ./node_modules/.bin/tsx "scripts/record-job-failure.ts" "$JOB" "$elapsed" >>"$LOG" 2>&1
    hb_rc=$?
    if [[ "$hb_rc" -ne 0 ]]; then
        log "WARN supervisor failure-heartbeat write for $JOB exited $hb_rc — see log above"
    fi
fi

case "$rc" in
    0)   log "OK   exit=0 ${elapsed}s" ;;
    124) log "FAIL TIMEOUT after ${TIMEOUT}s — killed; job_heartbeats now shows ok=false for this run (supervisor-recorded, unless the child's own row is newer)" ;;
    *)   log "FAIL exit=$rc ${elapsed}s — see the traceback above this line" ;;
esac
exit "$rc"
