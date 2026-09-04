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

echo
if (( fails )); then echo "$fails test(s) FAILED"; exit 1; fi
echo "all 8 tests passed"
