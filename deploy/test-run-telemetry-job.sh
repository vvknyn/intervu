#!/usr/bin/env bash
# Runnable tests for run-telemetry-job.sh. No database, no network, no Meili:
# every command the wrapper reaches for is a shim on a PATH this script builds
# from scratch, and the wrapper's roots are redirected through the INTERVU_*
# overrides it already honours. Safe to run anywhere, including a laptop.
#
#   bash deploy/test-run-telemetry-job.sh
#
# WHY THIS FILE EXISTS. Every case below is a way for the wrapper to report a
# job failure — or a success — for a job that never started. That is the
# failure this whole telemetry subsystem exists to detect, so reproducing it
# inside the subsystem's own scheduler would be the worst possible bug. Three
# of these were live defects found by RUNNING these tests, not by reading the
# script:
#
#   - a missing `timeout` exits 127 through the job's own exit path, logging
#     "FAIL exit=127 ... see the traceback above" with no traceback above it.
#   - a missing `flock` is indistinguishable from "lock held" (both are a
#     non-zero `flock -n`), so the wrapper took the SKIP branch and exited 0:
#     every run reporting success while never starting the job.
#   - `npm ci` omits devDependencies when NODE_ENV=production, so it can exit
#     0 having installed no tsx, and the job then dies at exec time.
#
# PATH is built explicitly rather than inherited, because /usr/bin carries
# timeout and flock on the Linux box and neither on macOS — inheriting it
# would make these tests pass or fail for reasons unrelated to the wrapper.
set -uo pipefail

WRAPPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-telemetry-job.sh"
# Resolved before PATH is restricted below — the test PATHs deliberately
# omit bash, so invoking it by name would fail with 127 for every case.
BASH_BIN="$(command -v bash)"
FX="$(mktemp -d)"
trap 'rm -rf "$FX"' EXIT
mkdir -p "$FX/root/scripts" "$FX/base" "$FX/shim"
echo 'console.log("unused");'              > "$FX/root/scripts/demo-job.ts"
echo '{"name":"fake"}'                     > "$FX/root/package.json"
printf 'BATCH_PG_URL=postgres://fake/db\n' > "$FX/env.local"

# $FX/base — everything the wrapper needs to log and parse, and nothing it
# needs to RUN a job. This is the "required commands missing" environment.
for c in date mkdir basename dirname cat rm chmod; do
    ln -sf "$(command -v "$c")" "$FX/base/$c"
done
# sed/tail/tr live in $FX/shim, not $FX/base: they are commands the preflight
# guards, so $FX/base must not carry them or the "required commands missing"
# case would be testing a different, weaker claim.
for c in sed tail tr; do ln -sf "$(command -v "$c")" "$FX/shim/$c"; done
# $FX/shim — base plus stand-ins for the commands the preflight guards.
ln -sf "$FX"/base/* "$FX/shim/" 2>/dev/null
cat > "$FX/shim/timeout" <<'SH'
#!/bin/bash
while [[ "$1" == --* ]]; do shift; done   # --signal / --kill-after
shift                                      # the duration
exec "$@"
SH
cat > "$FX/shim/flock" <<'SH'
#!/bin/bash
exit 0
SH
cat > "$FX/shim/npm" <<'SH'
#!/bin/bash
case "$NPM_MODE" in
  no-dev) echo "[shim npm] installed 0 devDependencies"; exit 0 ;;
  fail)   echo "[shim npm] ERR!"; exit 1 ;;
  ok)     mkdir -p "$PWD/node_modules/.bin"
          printf '#!/bin/bash\necho "TSX RAN"\n' > "$PWD/node_modules/.bin/tsx"
          chmod +x "$PWD/node_modules/.bin/tsx"; exit 0 ;;
  *)      echo "[shim npm] unset NPM_MODE"; exit 1 ;;
esac
SH
chmod +x "$FX/shim/timeout" "$FX/shim/flock" "$FX/shim/npm"

# $FX/notext — timeout, flock and npm all present, sed/tail/tr all absent.
# Isolates the claim that the preflight covers the text tools too: with
# $FX/base the preflight would fire on timeout anyway, so that case cannot
# tell whether sed/tail/tr are guarded or merely happen to be missing.
mkdir -p "$FX/notext"
ln -sf "$FX"/base/* "$FX/notext/" 2>/dev/null
cp "$FX/shim/timeout" "$FX/shim/flock" "$FX/shim/npm" "$FX/notext/"

fails=0 rc=0 ran=0 log=""

# run <npm-mode> [path-dir] [preinstall|jobname]
run() {
    local mode=$1 pathdir=${2:-$FX/shim} extra=${3:-}
    rm -rf "$FX/root/node_modules"; : > "$FX/log"
    if [[ "$extra" == "preinstall" ]]; then
        mkdir -p "$FX/root/node_modules/.bin"
        printf '#!/bin/bash\necho "TSX RAN"\n' > "$FX/root/node_modules/.bin/tsx"
        chmod +x "$FX/root/node_modules/.bin/tsx"
        extra=""
    fi
    NPM_MODE="$mode" PATH="$pathdir" \
    INTERVU_ROOT="$FX/root" INTERVU_JOB_ENV_FILE="$FX/env.local" \
    INTERVU_JOB_LOG="$FX/log" INTERVU_JOB_LOCK="$FX/lock" \
    INTERVU_JOB_TIMEOUT=20 \
        "$BASH_BIN" "$WRAPPER" "${extra:-demo-job}" >/dev/null 2>&1
    rc=$?
    ran=$(grep -c "TSX RAN" "$FX/log")
    log=$(cat "$FX/log")
}

check() { # check <label> <want-rc> <want-ran> <want-substring>
    if [[ "$rc" == "$2" && "$ran" == "$3" ]] && grep -qF -- "$4" <<<"$log"; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s\n     want rc=%s ran=%s containing %q\n     got  rc=%s ran=%s\n     log: %s\n' \
            "$1" "$2" "$3" "$4" "$rc" "$ran" "$log"
        fails=$((fails + 1))
    fi
}

# Every refusal below asserts ran=0. Refusing to run is only the correct
# behaviour if the job genuinely did not start; a message without that
# assertion would not distinguish this from the bugs it replaced.
run no-dev; check "npm ci exits 0 without installing tsx -> refuses, job never starts" \
    1 0 "npm ci exited 0 but node_modules/.bin/tsx is still missing"

run fail;   check "npm ci exits non-zero -> refuses, with a distinct message" \
    1 0 "npm ci failed"

run ok;     check "npm ci installs tsx -> the job actually runs" 0 1 "OK   exit=0"

# Negative control: npm is in FAIL mode, so passing here proves the skip
# branch is real rather than the test quietly reinstalling behind it.
run fail "$FX/shim" preinstall
            check "tsx already present -> npm ci skipped entirely" 0 1 "OK   exit=0"

# The class the preflight exists for: a PATH that can log but cannot run.
run ok "$FX/base"
            check "required commands missing -> refuses before doing any work" \
    1 0 "missing required command"

# Argument validation precedes environment validation, so a bad job name is
# reported as the caller's mistake even on a box that is also missing tools.
# read_key is built from sed/tail/tr, so an unguarded one of them makes every
# key read back empty and the wrapper blames the env file for a missing
# credential that is actually present.
run ok "$FX/notext"
            check "text tools missing -> named as missing commands, not a missing credential" \
    1 0 "missing required command"

run ok "$FX/base" "../../etc/passwd"
            check "path traversal rejected, and reported ahead of the tool check" \
    2 0 "FAIL usage:"

run ok "$FX/shim" "no-such-job"
            check "unknown job name -> named as a missing script, not a crash" \
    2 0 "no such job"

# ---------------------------------------------------------------------------
# Install-lock concurrency (double-checked locking around npm ci, keyed to
# INTERVU_ROOT rather than the per-job JOB name). Every case above runs one
# invocation at a time through a `flock` shim that unconditionally succeeds,
# so none of them can exercise real contention. These three use the REAL
# flock binary plus an `npm` stub that takes real wall-clock time, so two
# concurrent runs actually overlap instead of racing through sequentially.
# ---------------------------------------------------------------------------

REAL_FLOCK="$(command -v flock)" || { echo "SKIP install-lock races: no flock on PATH"; REAL_FLOCK=""; }
if [[ -n "$REAL_FLOCK" ]]; then
mkdir -p "$FX/rshim"
ln -sf "$FX"/base/* "$FX/rshim/" 2>/dev/null
for c in sed tail tr; do ln -sf "$(command -v "$c")" "$FX/rshim/$c"; done
ln -sf "$FX/shim/timeout" "$FX/rshim/timeout"
ln -sf "$REAL_FLOCK" "$FX/rshim/flock"
echo 'console.log("unused");' > "$FX/root/scripts/second-job.ts"

# Sleeps a beat (so two concurrent callers actually overlap instead of one
# finishing before the other starts), appends one line per invocation to
# $NPM_COUNTER_FILE, then installs tsx — standing in for `npm ci` actually
# taking measurable wall-clock time.
cat > "$FX/rshim/npm" <<'SH'
#!/bin/bash
sleep 0.3
echo "ci $$" >> "$NPM_COUNTER_FILE"
mkdir -p "$PWD/node_modules/.bin"
printf '#!/bin/bash\necho "TSX RAN"\n' > "$PWD/node_modules/.bin/tsx"
chmod +x "$PWD/node_modules/.bin/tsx"
SH
chmod +x "$FX/rshim/npm"

# run_race <job> <log-file> <lock-file> [extra-env...] — launches one
# concurrency-test invocation in the background against the shared
# $FX/root and sets $LAST_PID. Must background directly in THIS shell, not
# inside a $(...) command substitution — a subshell's background child is
# reparented away once the subshell exits, and `wait` on it then fails with
# "not a child of this shell" instead of returning its real exit status.
run_race() {
    local job=$1 logf=$2 lockf=$3; shift 3
    env "$@" NPM_COUNTER_FILE="$FX/counter" PATH="$FX/rshim" \
        INTERVU_ROOT="$FX/root" INTERVU_JOB_ENV_FILE="$FX/env.local" \
        INTERVU_JOB_LOG="$logf" INTERVU_JOB_LOCK="$lockf" INTERVU_JOB_TIMEOUT=20 \
        "$BASH_BIN" "$WRAPPER" "$job" >/dev/null 2>&1 &
    LAST_PID=$!
}

# (a) THE BUG: two DIFFERENT job names, started concurrently, both seeing
# tsx absent, racing to install into the same shared INTERVU_ROOT.
rm -rf "$FX/root/node_modules" "$FX/root/.npm-ci.lock"; : >"$FX/counter"; : >"$FX/clog1"; : >"$FX/clog2"
run_race demo-job "$FX/clog1" "$FX/lock1"; p1=$LAST_PID
run_race second-job "$FX/clog2" "$FX/lock2"; p2=$LAST_PID
wait "$p1"; rc1=$?
wait "$p2"; rc2=$?
ci_count=$(grep -c '^ci ' "$FX/counter")
ran1=$(grep -c "TSX RAN" "$FX/clog1")
ran2=$(grep -c "TSX RAN" "$FX/clog2")
if [[ "$rc1" == 0 && "$rc2" == 0 && "$ci_count" == 1 && "$ran1" == 1 && "$ran2" == 1 ]]; then
    printf 'ok   two different jobs racing on a fresh install -> exactly one npm ci, both jobs run\n'
else
    printf 'FAIL two different jobs racing -> want rc=0/0 ci=1 ran=1/1, got rc=%s/%s ci=%s ran=%s/%s\n     clog1: %s\n     clog2: %s\n' \
        "$rc1" "$rc2" "$ci_count" "$ran1" "$ran2" "$(cat "$FX/clog1")" "$(cat "$FX/clog2")"
    fails=$((fails + 1))
fi

# (b) a case other than the one that surfaced the bug: tsx already present
# -> the fast path must not take the install lock or invoke npm at all.
: >"$FX/counter"; : >"$FX/clog1"
mkdir -p "$FX/root/node_modules/.bin"
printf '#!/bin/bash\necho "TSX RAN"\n' >"$FX/root/node_modules/.bin/tsx"
chmod +x "$FX/root/node_modules/.bin/tsx"
run_race demo-job "$FX/clog1" "$FX/lock1"; wait "$LAST_PID"; rc=$?
ci_count=$(grep -c '^ci ' "$FX/counter")
if [[ "$rc" == 0 && "$ci_count" == 0 ]] && grep -qF "OK   exit=0" "$FX/clog1"; then
    printf 'ok   tsx already present -> install lock and npm untouched, fast path unchanged\n'
else
    printf 'FAIL tsx already present -> want rc=0 ci=0, got rc=%s ci=%s\n     clog1: %s\n' \
        "$rc" "$ci_count" "$(cat "$FX/clog1")"
    fails=$((fails + 1))
fi

# (c) negative control: install lock held externally past its wait timeout
# -> a loud, distinct failure, never a silent fall-through into a
# concurrently-mutating node_modules. INTERVU_JOB_INSTALL_LOCK_TIMEOUT=1
# keeps this from taking minutes.
rm -rf "$FX/root/node_modules"; : >"$FX/counter"; : >"$FX/clog1"
( exec 8>"$FX/root/.npm-ci.lock"; "$REAL_FLOCK" -x 8; sleep 2 ) &
holder=$!
sleep 0.3   # let the holder actually acquire the lock before we race it
run_race demo-job "$FX/clog1" "$FX/lock1" INTERVU_JOB_INSTALL_LOCK_TIMEOUT=1; wait "$LAST_PID"; rc=$?
wait "$holder"
ci_count=$(grep -c '^ci ' "$FX/counter")
if [[ "$rc" != 0 && "$ci_count" == 0 ]] && grep -qF "install lock" "$FX/clog1" && grep -qF "for over 1s" "$FX/clog1"; then
    printf 'ok   install lock held by another run -> loud timeout failure, npm never invoked\n'
else
    printf 'FAIL install lock held by another run -> want rc!=0 ci=0 with a timeout message, got rc=%s ci=%s\n     clog1: %s\n' \
        "$rc" "$ci_count" "$(cat "$FX/clog1")"
    fails=$((fails + 1))
fi
fi

echo
if (( fails )); then echo "$fails test(s) FAILED"; exit 1; fi
echo "all 11 tests passed"
