#!/usr/bin/env bash
# Daily picks trigger (src/app/api/email/daily-picks/route.ts).
#
#   run-daily-picks.sh [--uid=<uid>] [--dry-run]
#
# Runs on the HOST from the subspace crontab once a day, like
# run-weekly-digest.sh: an HTTP call to intervu's own endpoint, with the same
# bearer (EMAIL_DIGEST_CRON_SECRET) read out of the compose env file rather
# than written into the crontab. Only accounts that turned daily picks on are
# mailed, at most once in 20 hours, and only on a day with new picks.
#
# --dry-run builds every email and sends none (the log line counts what would
# go out); --uid runs one account.
#
# Every run appends one line with the HTTP status and the response body
# (counts only, never an address). `curl -f` is deliberately NOT used: a 4xx
# body says WHY (`not configured`, `unauthorized`).
set -uo pipefail

ENV_FILE="${INTERVU_ENV_FILE:-/opt/interview-os/deploy/contabo-web/intervu.env}"
ENDPOINT="${INTERVU_DAILY_PICKS_URL:-https://velai.app/api/email/daily-picks}"
LOG="${INTERVU_DAILY_PICKS_LOG:-$HOME/logs/intervu-daily-picks.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

mkdir -p "$(dirname "$LOG")"

if [[ ! -r "$ENV_FILE" ]]; then
    log "FAIL cannot read $ENV_FILE"
    exit 1
fi

# Only the one key, and only its value.
SECRET="$(sed -n 's/^EMAIL_DIGEST_CRON_SECRET=//p' "$ENV_FILE" | head -1 | tr -d '"'"'"'\r')"
if [[ -z "$SECRET" ]]; then
    log "FAIL EMAIL_DIGEST_CRON_SECRET missing from $ENV_FILE"
    exit 1
fi

uid=""
dry=false
for arg in "$@"; do
    case "$arg" in
        --uid=*) uid="${arg#--uid=}" ;;
        --dry-run) dry=true ;;
        *) log "FAIL unknown argument $arg"; exit 2 ;;
    esac
done
body="{\"dryRun\":${dry}${uid:+,\"uid\":\"${uid}\"}}"

# Follow a redirect as the SAME POST (the weekly digest died silently for
# three weeks on a domain redirect, run-weekly-digest.sh).
response="$(curl -sS -m 1800 -w '\n%{http_code}' \
    --post301 --post302 --post303 -L \
    -X POST "$ENDPOINT" \
    -H "Authorization: Bearer ${SECRET}" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>&1)"
status="$(printf '%s' "$response" | tail -1)"
payload="$(printf '%s' "$response" | sed '$d' | tr -d '\n' | cut -c1-500)"

if [[ "$status" == "200" ]]; then
    log "OK   $status $payload"
    exit 0
fi
log "FAIL $status $payload"
exit 1
