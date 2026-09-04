# Telemetry retention cron

Makes `SEARCH_LOG_TTL_DAYS = 90`'s counterpart for the telemetry ledger real:
Postgres has no TTL feature, so nothing deletes `intervu.telemetry_events`
rows on its own without this cron. The runner is `scripts/reap-telemetry.ts`
— see that file's header for why it batches its own DELETEs instead of
calling the `intervu.reap_telemetry()` SQL function directly.

This file documents the crontab entry to add. **It does not install one** —
no server was touched to produce this.

## Where it runs

On the **pipeline box** (194.163.147.154), as user **`subspace`**, from
`/opt/interview-os` (the same checkout `deploy/run-weekly-digest.sh` and the
`deploy/db-box/*.sh` loaders already run from). The db-box's firewall admits
port 5432 only from this box, so the reaper — like every other script that
touches `intervu.telemetry_events` — has to run here, not on the db-box
itself, even though this doc lives under `deploy/db-box/`.

## Prerequisites

1. `deploy/db-box/telemetry-schema.sql` has been applied (creates
   `intervu.telemetry_events`, `intervu.job_heartbeats`, and the
   `pipeline` role's grants this script relies on).
2. `/opt/interview-os/.env.local` has `BATCH_PG_URL` set to a connection
   string for the `pipeline` role — the same variable
   `load-firestore-export.sh`/`verify-firestore-load.sh` already read.
3. `npx`/`tsx` resolve for user `subspace` in a login shell (`bash -lc`
   below) — confirm with `su - subspace -c 'bash -lc "which npx"'` once,
   the same way any other node-based cron on this box was verified.

## Crontab line

Add with `crontab -u subspace -e` (or as `subspace`, `crontab -e`). Runs
daily at 04:00 UTC — off the peak-traffic hours the other daily box crons
already avoid:

```cron
0 4 * * * cd /opt/interview-os && bash -lc 'npx tsx scripts/reap-telemetry.ts' >> $HOME/logs/reap-telemetry.log 2>&1
```

`bash -lc` loads the login shell's PATH (nvm-managed node included) the same
way an interactive `subspace` session would — cron's own minimal
environment is the usual reason a node script that works by hand fails
silently under cron. Output — including a failure's stack trace — goes to
`$HOME/logs/reap-telemetry.log`, matching `run-weekly-digest.sh`'s
`$HOME/logs/*.log` convention, because a cron whose only failure signal is
"no email arrived" is invisible by design.

## Verifying it actually ran

Exit status alone is not evidence — five daily crons on this system once
ran dead for up to ten days while exiting 0 every time. The one query that
proves a run happened, and when:

```sql
select job_name, last_run_at, rows_affected, ok
from intervu.job_heartbeats
where job_name = 'reap_telemetry';
```

`last_run_at` should be within the last 24h once the cron is live; `ok`
should be `true`; a `rows_affected` of `0` on a given day is a legitimate
outcome (nothing was 90+ days old yet), not a sign the job failed — that's
exactly why the heartbeat is written on a zero-row run too, rather than
only on a run that deleted something.

Run this on the db-box directly (`psql "$BATCH_PG_URL" -c "..."`) or via the
same `BATCH_PG_URL` connection from the pipeline box.
