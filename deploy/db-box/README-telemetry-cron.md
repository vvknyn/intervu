# Telemetry retention cron

**Superseded 2026-09-03 — see `RUNBOOK-telemetry-launch.md` §8 instead.**

This file previously recommended installing a crontab entry on
`/opt/interview-os` (194.163.147.154, user `subspace`) running
`npx tsx scripts/reap-telemetry.ts`. Verified on the box, that recommendation
was never viable: `/opt/interview-os` is a checkout of the separate
**subspace** repo (`git remote` → `vvknyn/subspace.git`), not this repo — it
has no `scripts/reap-telemetry.ts` and never will via the normal deploy flow,
since intervu ships to `/opt/intervu` and the container's own `/app` (a
Next.js standalone build) has no `scripts/` directory or `tsx` binary either.
There is no host-side Node runtime anywhere in this deploy that can run that
script in production.

The actual production path is `intervu.reap_telemetry()`, a self-contained
SQL function (`telemetry-schema.sql` §6) run directly on the DB box over the
local socket — no Node runtime, no pipeline-box hop needed. See
`RUNBOOK-telemetry-launch.md` §8 for the exact crontab line, the chosen UTC
time and why, and the heartbeat-based pass condition (exit status alone is
not evidence — see that section).

`scripts/reap-telemetry.ts` stays in the repo for manual/dev use against a
real accumulated backlog (its batched, separately-committed DELETEs matter
there); it is documented, not installed, and is not the production cron —
see the runbook for why.
