#!/usr/bin/env bash
# Weekly digest trigger.
#
#   run-weekly-digest.sh [--uid=<firebase-uid>]
#
# Runs on the HOST from the subspace crontab, not inside the container: it is
# an HTTP call to intervu's own endpoint, so it needs nothing from the image.
# With --uid it targets one user, which is how the path gets exercised without
# mailing anybody (pick a uid the digest will skip).
#
# The bearer secret is read out of the compose env file rather than written
# into the crontab, where `crontab -l` prints it in full to anyone on the box.
#
# Every run appends one line with the HTTP status and the response body. A
# weekly job that fails silently is indistinguishable from one that never ran,
# and this one is invisible by design — its only success signal is an email
# that someone else receives. `curl -f` is deliberately NOT used: a 4xx body
# says WHY (`not configured`, `unauthorized`), and -f throws that body away.
set -uo pipefail

ENV_FILE="${INTERVU_ENV_FILE:-/opt/interview-os/deploy/contabo-web/intervu.env}"
# Default is the CURRENT site domain, overridable so a future move never
# needs a code change here — only the env var. intervuhq.com 301-redirected
# here from 2026-09-01 to 2026-09-17 (dead cron: curl below didn't follow
# redirects), so the default must track deploy/Caddyfile's live vhost, not
# a retired one.
ENDPOINT="${INTERVU_DIGEST_URL:-https://velai.app/api/email/digest}"
LOG="${INTERVU_DIGEST_LOG:-$HOME/logs/intervu-digest.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

mkdir -p "$(dirname "$LOG")"

if [[ ! -r "$ENV_FILE" ]]; then
    log "FAIL cannot read $ENV_FILE"
    exit 1
fi

# Only the one key, and only its value — sourcing the whole file would pull 27
# unrelated credentials into this shell's environment for no reason.
SECRET="$(sed -n 's/^EMAIL_DIGEST_CRON_SECRET=//p' "$ENV_FILE" | head -1 | tr -d '"'"'"'\r')"
if [[ -z "$SECRET" ]]; then
    log "FAIL EMAIL_DIGEST_CRON_SECRET missing from $ENV_FILE"
    exit 1
fi

body='{}'
for arg in "$@"; do
    case "$arg" in
        --uid=*) body="{\"uid\":\"${arg#--uid=}\"}" ;;
        *) log "FAIL unknown argument $arg"; exit 2 ;;
    esac
done

# --post301/302/303 -L: if ENDPOINT ever again points at a domain that
# redirects (the exact way this job died silently for three weeks), follow
# it as the SAME POST instead of curl's default of dropping to GET, or of
# not following at all. One documented hop, not a repeat of the outage.
response="$(curl -sS -m 900 -w '\n%{http_code}' \
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
