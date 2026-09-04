# Telemetry end-to-end verification

`POST /api/telemetry` (`src/app/api/telemetry/route.ts`) is deliberately
written to never throw and to always return `204`, even when it silently
drops the event it was just handed — that's guards 9/10 of the route's own
doc comment: "telemetry failing must never break a page or surface a 500."
A `204` therefore proves the HTTP layer accepted the request. It proves
nothing about whether a row actually reached
`intervu.telemetry_events`. This doc is about `scripts/verify-telemetry-e2e.ts`,
the script that closes that gap. It is a separate concern from
`README-telemetry-cron.md` (the retention reaper cron) and is documented
here as its own file rather than a section bolted onto that one, since the
two scripts share nothing except living in the same table.

## What it proves

Two independent ways a telemetry event can vanish in prod right now, with
nothing today distinguishing either from a healthy write:

1. **Schema drift.** The live `intervu.telemetry_events` table has a
   pre-spec shape missing a column this route's insert depends on
   (`event_id`, `event_name`, `query_id`, `job_id`, `company_domain`,
   `position`, ...). The insert raises, `route.ts` catches it
   (`route.ts:136-138`), logs it, and still returns `204`.
2. **Missing env.** `TELEMETRY_PG_URL` is unset in the container running the
   app. `getTelemetryPg()` returns `null`, the insert is skipped outright
   (`route.ts:133` — `if (pg && admitted.length > 0)`), and the route still
   returns `204`.

`verify-telemetry-e2e.ts` posts one real, synthetic event over real HTTP
to a running instance of the app, then reads it back from Postgres over a
**different** connection than the app uses for ingest — `BATCH_PG_URL` (the
`pipeline` role, the table owner), not `TELEMETRY_PG_URL` (the `telemetry_pg`
role, which is INSERT-only by design and cannot `SELECT` — see
`telemetry-schema.sql` §4). If the row isn't there, or a column landed with
the wrong value, this script fails loudly and says which of the two causes
above it looks like — a `204` from the endpoint is not treated as success by
itself.

## Running it

After a deploy, from a machine that can reach both the running app and the
box's Postgres:

```bash
TARGET_URL=https://app.example.com BATCH_PG_URL="postgresql://pipeline:...@194.163.147.154:5432/postgres" \
  npx tsx scripts/verify-telemetry-e2e.ts
```

Locally against a dev server:

```bash
TARGET_URL=http://localhost:3000 BATCH_PG_URL="postgresql://pipeline:...@194.163.147.154:5432/postgres" \
  npx tsx scripts/verify-telemetry-e2e.ts
```

Both env vars are required with no default — the script also loads
`.env.local` via `dotenv` so an operator who already has `BATCH_PG_URL` set
there for other box scripts doesn't have to re-export it by hand, but
`TARGET_URL` will essentially never live in `.env.local` (nothing else in
this repo needs "which host am I hitting"), so the no-env-set case still
fails loudly with a clear message naming the missing var and a non-zero exit
code. This is deliberately **not** a cron and is **not** part of
`preflight` — it makes a real HTTP request and writes a real (if
synthetic) row, so it only runs when an operator asks for it.

## Reading a failure

Each check prints its own `PASS`/`FAIL` line with actual vs. expected — a
single "row exists" check was never enough (that's exactly what let a
promoted-columns-stuck-in-props bug through before this script existed).
On a missing row, the script queries `information_schema.columns` for
`intervu.telemetry_events` itself and prints one of two diagnoses:

- **"likely schema drift"** — one or more expected columns are missing from
  the live table. Compare it against `deploy/db-box/telemetry-schema.sql`
  and re-apply that file.
- **"likely TELEMETRY_PG_URL unset"** — the schema looks correct but the row
  still never showed up. Check the container's env file for
  `TELEMETRY_PG_URL` (the same file the deploy recipe in this directory's
  other docs populate `BATCH_PG_URL` from).

## Cleanup

The script always deletes its own synthetic row (`event_id` is a fresh
random UUID generated per run, `company_domain` uses the `.invalid` TLD
reserved by RFC 2606 for exactly this kind of non-production placeholder) in
a `finally` block that runs whether the checks above passed or failed, and
verifies the delete actually removed exactly one row rather than assuming it
did. A run that leaves its synthetic row behind in a production ledger exits
non-zero even if every other check passed — that's precisely the kind of
"looks fine, isn't" outcome this script exists to catch.
