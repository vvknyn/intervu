#!/usr/bin/env bash
# Orphan-account report trigger (src/app/api/ops/orphan-accounts/route.ts).
#
#   run-orphan-accounts.sh
#
# Runs on the HOST from the crontab once a day, like run-resume-retention.sh:
# same endpoint host, its own bearer (ORPHAN_ACCOUNTS_CRON_SECRET) read from the
# compose env file. Report only; it deletes nothing. The log line is counts only:
#   <ts> OK   200 orphans=0 with_creds=0
#   <ts> WARN 200 orphans=N with_creds=M     (N > 0)
#   <ts> FAIL <status> ...                   (non-200; exits 1)
set -uo pipefail

ENV_FILE="${INTERVU_ENV_FILE:-/opt/interview-os/deploy/contabo-web/intervu.env}"
ENDPOINT="${INTERVU_ORPHAN_ACCOUNTS_URL:-https://velai.app/api/ops/orphan-accounts}"
LOG="${INTERVU_ORPHAN_ACCOUNTS_LOG:-$HOME/logs/intervu-orphan-accounts.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }
mkdir -p "$(dirname "$LOG")"

[[ -r "$ENV_FILE" ]] || { log "FAIL cannot read $ENV_FILE"; exit 1; }
SECRET="$(sed -n 's/^ORPHAN_ACCOUNTS_CRON_SECRET=//p' "$ENV_FILE" | head -1 | tr -d '"'"'"'\r')"
[[ -n "$SECRET" ]] || { log "FAIL ORPHAN_ACCOUNTS_CRON_SECRET missing from $ENV_FILE"; exit 1; }

response="$(curl -sS -m 600 -w '\n%{http_code}' \
    --post301 --post302 --post303 -L \
    -X POST "$ENDPOINT" \
    -H "Authorization: Bearer ${SECRET}" 2>&1)"
status="$(printf '%s' "$response" | tail -1)"
payload="$(printf '%s' "$response" | sed '$d' | tr -d '\n' | cut -c1-500)"

if [[ "$status" == "200" ]]; then
    orphans="$(printf '%s' "$payload" | sed -n 's/.*"orphans":\([0-9][0-9]*\).*/\1/p')"
    creds="$(printf '%s' "$payload" | sed -n 's/.*"withActiveCredentials":\([0-9][0-9]*\).*/\1/p')"
    if [[ -n "$orphans" && -n "$creds" ]]; then
        if [[ "$orphans" == "0" ]]; then
            log "OK   $status orphans=$orphans with_creds=$creds"
        else
            log "WARN $status orphans=$orphans with_creds=$creds"
        fi
        exit 0
    fi
    log "FAIL $status unparseable body: $payload"
    exit 1
fi
log "FAIL $status $payload"
exit 1
