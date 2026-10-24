#!/usr/bin/env bash
# Résumé retention trigger (src/app/api/retention/resumes/route.ts).
#
#   run-resume-retention.sh [--apply]
#
# Runs on the HOST from the subspace crontab once a day, like
# run-daily-picks.sh: same endpoint host, its own bearer (RESUME_RETENTION_CRON_SECRET)
# read from the compose env file. DRY RUN unless --apply is given. The log line
# is counts only (scanned, warned, deleted, no_access_period, no_email, send_failed, mirror_unreachable, errors);
# a non-200 (errors or send_failed > 0 answers 500) logs FAIL and exits 1.
set -uo pipefail

ENV_FILE="${INTERVU_ENV_FILE:-/opt/interview-os/deploy/contabo-web/intervu.env}"
ENDPOINT="${INTERVU_RETENTION_URL:-https://velai.app/api/retention/resumes}"
LOG="${INTERVU_RETENTION_LOG:-$HOME/logs/intervu-resume-retention.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }
mkdir -p "$(dirname "$LOG")"

[[ -r "$ENV_FILE" ]] || { log "FAIL cannot read $ENV_FILE"; exit 1; }
SECRET="$(sed -n 's/^RESUME_RETENTION_CRON_SECRET=//p' "$ENV_FILE" | head -1 | tr -d '"'"'"'\r')"
[[ -n "$SECRET" ]] || { log "FAIL RESUME_RETENTION_CRON_SECRET missing from $ENV_FILE"; exit 1; }

# The bearer goes to curl as a config on stdin, never as an -H argument (argv is world-readable in ps).
bearer_config() { printf 'header = "Authorization: Bearer %s"\n' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g')"; }

apply=false
for arg in "$@"; do
    case "$arg" in
        --apply) apply=true ;;
        *) log "FAIL unknown argument $arg"; exit 2 ;;
    esac
done

response="$(bearer_config "$SECRET" | curl --config - -sS -m 1800 -w '\n%{http_code}' \
    --post301 --post302 --post303 -L \
    -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -d "{\"apply\":${apply}}" 2>&1)"
status="$(printf '%s' "$response" | tail -1)"
payload="$(printf '%s' "$response" | sed '$d' | tr -d '\n' | cut -c1-500)"

if [[ "$status" == "200" ]]; then
    log "OK   $status $payload"
    exit 0
fi
log "FAIL $status $payload"
exit 1
