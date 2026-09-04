# Telemetry ledger launch runbook

Ordered, operator-run sequence to take `intervu.telemetry_events` from its
current pre-spec orphan shape (0 rows, wrong columns — see
`deploy/db-box/telemetry-events-drop-orphan.sql`) to a live, verified ingest
path. Each step's precondition is the previous step's pass condition — do
not skip ahead. Two steps are marked **HUMAN-ONLY**: never script them,
never pass the value in argv, never export it to a variable that ends up in
a process list (`ps`, `docker inspect`, cron logs).

None of this has been applied to prod. Steps 1–4 must be run manually, in
order, by an operator with box access.

## 0. What a silent failure looks like here

`POST /api/telemetry` never throws and always returns `204` — including
when it silently drops the event. **A `204` is not evidence of anything.**
Three different states of the world produce byte-identical `204`s:

- healthy (row lands in `intervu.telemetry_events`)
- drifted table (insert raises, caught, logged, still `204` —
  `route.ts:136-138`)
- missing `TELEMETRY_PG_URL` (`getTelemetryPg()` returns `null`, insert
  skipped outright, still `204` — `route.ts:133`)

Only `scripts/verify-telemetry-e2e.ts` (step 6) tells these apart — it reads
the row back over a *different* connection than ingest uses. Do not treat a
`204` from a manual curl or from the browser network tab as launch proof.

A second, unrelated silent-failure shape lives one hop upstream of the
ledger: `GET /api/geo/region` (`src/app/api/geo/region/route.ts`) decides
whether a new `visitor_id` is allowed to live in `localStorage` at all
(`resolveVisitorIdStorage()`, `src/lib/telemetry/client.ts:211`) — EU/UK
visitors must not get a durable id before consent. That route **fails
closed**: it returns `{"euUk":true}` both when a visitor is genuinely in
the EU/UK *and* when the mmdb country lookup throws for any reason
(`route.ts:34,37`) — e.g. the mmdb file missing or unreadable in the
container. A correct EU reading and a totally broken mmdb are byte-identical
from a non-EU caller's point of view unless you specifically check what a
*non-EU* IP gets back. Step 5 below exists solely to rule this out; read its
inverted-reading trap before running it.

## 1. Apply the schema migration

**Run:** on the DB box (169.58.140.49), as the `postgres` OS user, over the
local socket — fact-checked 2026-09-03: this box has exactly one
non-template database (`postgres`; `intervu` is a schema inside it, not a
database), and `postgres`-over-local-socket needs no password or connection
string at all.

```bash
scp deploy/db-box/apply-telemetry-migration.sh \
    deploy/db-box/telemetry-schema.sql \
    deploy/db-box/telemetry-events-drop-orphan.sql \
    root@169.58.140.49:/tmp/telemetry-migration/
ssh root@169.58.140.49
sudo -u postgres bash /tmp/telemetry-migration/apply-telemetry-migration.sh
```

The script detects the table's actual state from `information_schema` itself
(absent / orphan / correct) rather than trusting an operator-supplied flag,
runs `telemetry-events-drop-orphan.sql` only when it finds the known
pre-spec orphan shape, then applies `telemetry-schema.sql`. Both `.sql`
files set `\set ON_ERROR_STOP on` on line 1 — a guard failure aborts the run
with exit 3 no matter how the file is invoked, so there is no need to (and
you should not) pass `-v ON_ERROR_STOP=1` on top of it.

**Pass condition:** the script exits `0` and its last line of output is the
"manual steps remaining" banner naming step 2 and step 3 below. Re-running
it against an already-correct schema is a clean no-op (exit `0`, same
banner) — safe to re-run if you're ever unsure it applied.

## 2. Set the `telemetry_pg` password — HUMAN-ONLY

**Precondition:** step 1 exited 0 (the `telemetry_pg` role now exists,
password-less).

**Run**, still as `postgres` on the DB box, in an **interactive** psql
session:

```
sudo -u postgres psql -d postgres
=# \password telemetry_pg
```

**Why `\password` and not `ALTER ROLE telemetry_pg PASSWORD '...'`:**
`\password` hashes the value client-side inside psql and sends only the
SCRAM verifier over the wire — the plaintext never appears in the SQL
statement text, never shows up in `pg_stat_activity`, and never lands in a
server log. `ALTER ROLE ... PASSWORD '<plaintext>'` puts the plaintext in
all three.

**Pass condition** (no plaintext read-back needed or possible):

```sql
select rolname, rolpassword is not null as has_password
from pg_authid where rolname = 'telemetry_pg';
-- expect: telemetry_pg | t
```

## 3. Add `TELEMETRY_PG_URL` to the app box's env file — HUMAN-ONLY

**Precondition:** step 2's pass condition holds (a password exists to put in
the connection string).

**Run:** on the app box (194.163.147.154), as `subspace` — the file is
mode `-rw-------`, owned by `subspace`, and lives outside the git tree at
`/opt/interview-os/deploy/contabo-web/intervu.env`, so no `sudo` is needed
or wanted. Open it with an editor, not a shell redirect, so the connection
string (with its plaintext password) never touches shell history:

```bash
nano /opt/interview-os/deploy/contabo-web/intervu.env
```

Add one line:

```
TELEMETRY_PG_URL=postgresql://telemetry_pg:<the password from step 2>@169.58.140.49:5432/postgres
```

**Pass condition** (counts the line without ever printing the value):

```bash
grep -c '^TELEMETRY_PG_URL=' /opt/interview-os/deploy/contabo-web/intervu.env
# expect: 1
```

## 4. Recreate the container

**Precondition:** step 3's grep returned `1`.

An `env_file` change is invisible to a running container until it is
**recreated** — `docker restart` reuses the existing container's already-
fixed environment and will NOT pick up the new line. Confirmed on this box's
actual compose file
(`/opt/interview-os/deploy/contabo-web/docker-compose.yml`): the `intervu`
service also references `intervu.env` as a **build secret**
(`secrets: [{source: intervu_env, target: env}]` under `build:`, gated by an
`ENV_DIGEST` build arg) — that path is for `NEXT_PUBLIC_*` values baked into
the client bundle at build time. `TELEMETRY_PG_URL` is server-only, read at
runtime via `process.env` (`src/lib/pg/pool.ts`'s `getTelemetryPg()`), so it
only needs the **runtime** `env_file` layer refreshed — a recreate, not a
rebuild:

```bash
cd /opt/interview-os/deploy/contabo-web
docker compose up -d --force-recreate intervu
```

Do not add `--build` here — nothing in the image changed, only the runtime
env file. `--build` is for an actual code deploy (extract → swap →
`docker compose up -d --build intervu`, documented elsewhere); running it
here is unnecessary time and risk for zero benefit. Never run two concurrent
compose builds against this stack.

**Pass condition** — container was actually recreated, and the container's
own env now carries the key, without ever printing its value:

```bash
docker exec contabo-web-intervu-1 sh -c 'env | grep -c "^TELEMETRY_PG_URL="'
# expect: 1
```

## 5. Sanity-check the mmdb-backed geo lookup

**Precondition:** step 4's container recreate is done (this is a fresh
container, same mmdb dependency it always had — this step is not telemetry-
schema-dependent, it's a shared-dependency check that belongs here because a
container recreate is exactly the moment a stale/missing mmdb mount would
first show up).

**Why this is here at all:** the telemetry client decides where a *new*
`visitor_id` may be stored — `session` (EU/UK) vs `local` (everywhere else)
— by calling `GET /api/geo/region`, which fails **closed**: on any thrown
error (e.g. the mmdb file missing or unreadable in this container) it
returns `{"euUk":true}`, identical to what a genuinely-EU visitor gets. If
the mmdb lookup silently breaks, every visitor on earth gets a
session-scoped id instead of a durable one, forever, with no error anywhere.

**Run, from a known non-EU host — not from the Contabo box itself:**

```bash
curl -s https://velai.app/api/geo/region
```

**Pass condition:** `{"euUk":false}`.

**The inverted-reading trap — read this before running it:** getting back
`{"euUk":true}` from a non-EU IP is NOT evidence that EU-gating is working.
It means the mmdb lookup is broken and the durable visitor id is dead
site-wide. The only way this check means anything is running it from an
actual non-EU vantage point. **Running it from the Contabo box itself proves
nothing** — Contabo is in Germany, so a `true` from there is the legitimately
correct answer and tells you nothing about whether the lookup would also
(wrongly) return `true` for a US visitor. Run it from your own machine or
any other non-EU host.

This is not a new dependency this launch introduces: `src/actions/jobs.ts`
already calls the same mmdb lookup in production today for the jobs-search
IP-based location default. If the mmdb were already broken, that feature
would already be broken. This step is cheap insurance on a dependency this
launch now also leans on, not a new risk.

## 6. `verify-telemetry-grants.sh`

**Precondition:** steps 1–4 all passed (schema correct, role has a
password, app has `TELEMETRY_PG_URL`, container is running with it).

**Run:** from a host that can reach the DB box's Postgres over the network
(the DB box firewall admits 5432 only from the pipeline box, 194.163.147.154
— same constraint every other `deploy/db-box/` script already documents).
Connection details are environment-only, scoped to this one command, never
argv:

```bash
TELEMETRY_PG_URL="postgresql://telemetry_pg:<password>@169.58.140.49:5432/postgres" \
AGENT_PG_URL="postgresql://agent_pg:<password>@169.58.140.49:5432/postgres" \
BATCH_PG_URL="postgresql://pipeline:<password>@169.58.140.49:5432/postgres" \
  deploy/db-box/verify-telemetry-grants.sh
```

**Pass condition:** exit `0`, final line `all grant checks pass`. This
proves `telemetry_pg` can insert and cannot select/delete, `agent_pg` has no
privilege on the ledger at all, `reap_telemetry()` runs and heartbeats, and
`forget_telemetry_user()` is wired the way its `SECURITY DEFINER` design
demands. See the script's own header for what each of its 9 checks proves.

## 7. `verify-telemetry-e2e.ts`

**Precondition:** step 6 passed (grants are correct, so a real insert from
the running app has a chance of landing).

**Run**, from a machine that can reach both the live app and the DB box:

```bash
TARGET_URL=https://velai.app \
BATCH_PG_URL="postgresql://pipeline:<password>@169.58.140.49:5432/postgres" \
  npx tsx scripts/verify-telemetry-e2e.ts
```

**Pass condition:** exit `0`, `all checks passed` printed. This is the only
step that actually distinguishes "healthy" from the two silent-`204` states
described in §0 — it posts one real event over real HTTP and reads it back
via `BATCH_PG_URL` (never `TELEMETRY_PG_URL` — that role cannot `SELECT`).
On failure it prints its own diagnosis (schema drift vs. missing env) rather
than a bare "row not found."

**This is the actual launch gate.** Steps 1–6 are necessary; this one is
sufficient. Do not declare the ledger live without a passing run of this
script against the production URL.

## 8. Reaper cron — documented here, NOT installed

**Precondition:** step 7 passed. **Do not install this cron before that** —
the table doesn't exist in its correct shape until step 1 runs, so a cron
installed today would fail every night.

**Prod path is the SQL function, not the TypeScript script.** Verified
2026-09-03: the running `contabo-web-intervu-1` container's `/app` is a
Next.js standalone build containing only `data node_modules package.json
public server.js` — no `scripts/` directory, no `tsx` binary, nothing to
cron `scripts/reap-telemetry.ts` against. The extracted deploy tree
`/opt/intervu` has no `node_modules` at all either. Separately (and this
corrects `README-telemetry-cron.md`'s existing recipe — see the note added
to that file): `/opt/interview-os` on that same box is a checkout of the
**subspace** repo (`git remote` → `vvknyn/subspace.git`), not this repo — it
has no `scripts/reap-telemetry.ts` and never will via the normal deploy
flow, since intervu ships to `/opt/intervu`, not `/opt/interview-os`. There
is no host-side runtime anywhere in this deploy that can run
`npx tsx scripts/reap-telemetry.ts` in production.

`intervu.reap_telemetry(retain_days int default 90)` (`telemetry-schema.sql`
§6) needs none of that — it's a self-contained plpgsql function that
deletes past the retention window and upserts its own
`intervu.job_heartbeats` row (`ok=true`), including on a zero-row run, and
runs over the exact same local socket as everything else in this runbook.

**Crontab line to install as `postgres`, on the DB box, once step 7 has
passed** (`crontab -u postgres -e`, or `crontab -e` as `postgres`):

```cron
20 8 * * * psql -d postgres -Atc "select intervu.reap_telemetry(90)" >> $HOME/reap-telemetry.log 2>&1
```

**Why 08:20 UTC:** cross-referenced against the app box's full production
crontab (`crontab -l` as `subspace` on 194.163.147.154, which is what
actually generates load against this same DB box's Postgres). Hour 8 UTC is
the only hour block in that crontab with no *daily* fixed-start job at all —
the only two entries anywhere inside hour 8 are Monday/Thursday-only
(`10 8 * * 1,4`, `35 8 * * 1,4`), and minute `:20` lands on neither.
Disclosed, not swept under the rug: two long batch jobs elsewhere in that
crontab (`compute-fingerprints` at 07:15 with up to a 4h budget, and
`compute-lead-queue` at 07:45 with up to a 3h budget — the latter is a
known 13 GB TOAST scan) could still be mid-run at 08:20 on a slow day. Given
`reap_telemetry()` is one bounded `DELETE` against what will still be a
comparatively small table plus one upsert — not a comparable full-table
scan — the residual contention risk from that overlap is low, but it is not
zero, and this line does not attempt to prove otherwise. If `job_heartbeats`
ever shows `reap_telemetry` running long or landing late, this is the first
place to look.

**Pass condition — a stale heartbeat is how a dead cron is caught here.**
Exit status alone is not evidence: five daily crons in this system once ran
dead for up to ten days while exiting 0 every time. Query, on the DB box or
via `BATCH_PG_URL`:

```sql
select job_name, last_run_at, rows_affected, ok
from intervu.job_heartbeats
where job_name = 'reap_telemetry';
```

`last_run_at` should be within the last 24h once the cron is live; `ok`
should be `true`; `rows_affected = 0` on a given day is a legitimate outcome
(nothing 90+ days old yet exists), not a failure sign — that's exactly why
the function writes a heartbeat on a zero-row run too.

**`scripts/reap-telemetry.ts` stays in the repo — it is NOT the production
path.** It exists for manual/dev use against a real accumulated backlog,
where its batched, separately-committed `DELETE`s matter (see its own
header: a single unbatched multi-year delete against the highest-write table
in this system is a long lock + a large WAL burst). At launch there is no
such backlog — the table is created empty by step 1 — so the unbatched SQL
function is fine for the ongoing daily job. Do not wire this script into a
cron on this box: there is no runtime here to run it with, and if that ever
changes, the batching-vs-unbatched tradeoff above needs re-deciding, not
silently inherited.
