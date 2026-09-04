# Telemetry ledger launch runbook

Ordered, operator-run sequence to take `intervu.telemetry_events` from the
pre-spec orphan shape it had on 2026-09-03 (0 rows, wrong columns — see
`deploy/db-box/telemetry-events-drop-orphan.sql`) to a live, verified ingest
path. Each step's precondition is the previous step's pass condition — do
not skip ahead. Two steps are marked **HUMAN-ONLY**: never script them,
never pass the value in argv, never export it to a variable that ends up in
a process list (`ps`, `docker inspect`, cron logs).

## Where this stands (measured 2026-09-04, not inferred)

| step | state |
|---|---|
| 1. schema migration | **applied** — 2026-09-03, re-applied 2026-09-04 (exit `0`, state `correct`, 14 columns, 0 rows) |
| 2. `telemetry_pg` password | **not done — HUMAN-ONLY, blocked on an operator** |
| 3. `TELEMETRY_PG_URL` in the app box env | **not done** — key absent from both `/opt/interview-os/deploy/contabo-web/intervu.env` and the running `contabo-web-intervu-1` container (checked by key name; no value was read or printed) |
| 4. container recreate | not done (nothing to pick up until 3) |
| 5. mmdb geo sanity-check | not done |
| 6. `verify-telemetry-grants.sh` | not run (needs `BATCH_PG_URL`) |
| 7. `verify-telemetry-e2e.ts` | not run — **this is the launch gate** |
| 8. reaper cron | **installed** 2026-09-04; cron proven to fire for `postgres`; the 08:20 UTC run itself has not happened yet (see §8) |
| 9. derived-layer crons (`build-job-features`, `roll-up-telemetry`) | **not installed** — measured 2026-09-04, two ways: app box's installed crontab (1281 lines) has zero references to either script, and `intervu.job_heartbeats` holds exactly one row (`reap_telemetry`); neither job has ever run (see §9) |

**Consequence of 2+3 being open:** `/api/telemetry` currently answers `204`
and inserts nothing — `getTelemetryPg()` returns `null` with no
`TELEMETRY_PG_URL`, and the route's guard 8 logs once per process and drops
the batch. That is the exact silent-success failure §0 below describes, and
it is the current state, not a hypothetical.

Steps 2–4 must be run manually, in order, by an operator with box access.

## Deploy-order correction — the intervu app deploy is the keystone (measured 2026-09-04 ~05:30Z)

**This gates §2, §3, and §9 below and supersedes any reading of this runbook
as "run the human credential steps first."** Measured on prod just now, two
agreeing oracles — the extracted source tree at `/opt/intervu` and the
running `contabo-web-intervu-1` container's own built route manifest
(`.next/server/app/api`) — list the SAME 11 api routes: `account`, `auth`,
`contact`, `email`, `follow-email`, `jobs`, `mcp`, `oauth`, `search-alerts`,
`viewer`, `webhooks`. `/opt/intervu` matching the running container's
manifest confirms it as the source of the running build. **`telemetry` and
`geo` are not among the 11 — `/api/telemetry` is not deployed.** Second
oracle, same conclusion: `/opt/intervu/src/lib/telemetry` and
`/opt/intervu/src/app/api/telemetry` are both absent from the deployed tree.
(An HTTP 404 probe is NOT valid evidence here either way: `/api/jobs`,
`/api/viewer`, and `/api/account` all also 404 on a bare GET despite being
deployed — the route manifest above is the oracle, not a curl.)

**Consequence — §2 and §3 are INERT until this deploy lands.** There is no
`/api/telemetry` route in the running build to receive an event at all, so
setting the `telemetry_pg` password (§2) or adding `TELEMETRY_PG_URL` and
recreating the container (§3) cannot change the outcome of anything — there
is nothing on the other end of that route to read the credential yet.

**Consequence — §9's crons cannot be installed yet either.** Oracle: the
extracted tree's `/opt/intervu/scripts` (37 files) contains neither
`build-job-features.ts` nor `roll-up-telemetry.ts` — they are not on the box
at all. **And the intervu app deploy will not fix this** — an earlier draft
of this section implied it would. That deploy populates `/opt/intervu`, a
tree with no `node_modules`, no `tsx`, and zero `.env*` files (measured
2026-09-04), and the running container is a Next standalone image whose
`/app` holds only `data node_modules package.json public server.js` — no
`scripts/` directory at all. There is no runtime there to run either script
and no dotenv file for it to read.

The credential is in place only on the *other* tree: `BATCH_PG_URL` is
present in `/opt/interview-os/.env.local` (46 unique keys across 47
assignment lines) on the box that actually runs cron scripts
(`/opt/interview-os` = the subspace repo; 848 files under `scripts/`, 606 at
top level). Both scripts resolve their dotenv path as
`dirname(import.meta.url)/../.env.local`, so they reach that credential
**only if they live in `/opt/interview-os/scripts/`** — that is, only if
they are moved into the subspace repo. Nothing deploys them there today, and
`dotenv` does not throw on a missing file, so a misplaced script fails later
as a `BATCH_PG_URL is not set` *credential* error when it is really a
*placement* error. See §9.

**Consequence — the `/privacy` disclosure gate (§0, §8) is still unmet.**
Oracle: the served build's own `.next/server/app/privacy.html` still
contains the string "Firestore" — the retention/profiling/Postgres-location
disclosures are not live, independent of where the crons stand.

This states what is measured now. It does not say when the intervu app
deploy will happen, and it is not an approval to run one.

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
    deploy/db-box/telemetry-derived.sql \
    root@169.58.140.49:/tmp/telemetry-migration/
ssh root@169.58.140.49
sudo -u postgres bash /tmp/telemetry-migration/apply-telemetry-migration.sh
```

The script detects the table's actual state from `information_schema` itself
(absent / orphan / correct) rather than trusting an operator-supplied flag,
runs `telemetry-events-drop-orphan.sql` only when it finds the known
pre-spec orphan shape, then applies `telemetry-schema.sql`, then applies
`telemetry-derived.sql` (the user-profile cache layer — job_features,
job_daily, company_daily, query_daily, feature_outcomes). All three `.sql`
files set `\set ON_ERROR_STOP on` on line 1 — a guard failure aborts the run
with exit 3 no matter how the file is invoked, so there is no need to (and
you should not) pass `-v ON_ERROR_STOP=1` on top of it.

**Why the derived layer's ownership matters:** this script runs as
`postgres`, and schema `intervu` has a default-ACL rule keyed to
`defaclrole=postgres` that grants `service_role` full privileges on every
table `postgres` creates there (measured 2026-09-04 — see
`telemetry-derived.sql`'s own header). `telemetry-derived.sql` switches to
`set role pipeline` before its `create table` statements specifically so
these five user-profile tables do NOT inherit that grant, regardless of
which OS user this script is invoked as.

**Pass condition:** the script exits `0` and its last line of output is the
"manual steps remaining" banner naming step 2 and step 3 below. Re-running
it against an already-correct schema is a clean no-op (exit `0`, same
banner) — safe to re-run if you're ever unsure it applied.

**STATUS — APPLIED.** First applied 2026-09-03; re-applied 2026-09-04 from
the merged integ tree so prod would pick up §8's catalog-driven function
hardening. Both runs exited `0`. The re-run's state detection reported
`correct` (14 columns, 0 rows), so `telemetry-events-drop-orphan.sql` was
skipped, and the re-run's only real effect was the one it was for — measured
on the box before and after, via two independent catalog paths
(`has_function_privilege`/`pg_get_userbyid`, and `aclexplode`/`proowner::regrole`):

| `intervu.reap_telemetry(integer)` | before | after |
|---|---|---|
| owner | `postgres` | `pipeline` |
| PUBLIC `EXECUTE` | granted | revoked |
| pinned `search_path` | none | `intervu, pg_catalog, pg_temp` |

`intervu.forget_telemetry_user(text)` was already in the correct posture and
did not change — §7 pins its `search_path` explicitly, which is why the
pre-§8 by-name hardening block covered it and left `reap_telemetry` behind.
This is the concrete reason §8 is catalog-driven rather than by-name.

## 2. Set the `telemetry_pg` password — HUMAN-ONLY

**See "Deploy-order correction" above first: this step is currently INERT.**
`/api/telemetry` is not in the deployed build, so setting this password
cannot yet change what happens to any request.

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

**See "Deploy-order correction" above first: this step is currently INERT**
for the same reason as §2 — the container being recreated still won't have
an `/api/telemetry` route to serve until the intervu app deploy lands.

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
demands. See the script's own header for what each of its 10 checks proves.

Check 5 reads the grantee census straight off the catalog (pg_class /
aclexplode) for both `telemetry_events` and `job_heartbeats`, rather than
asking about a role by name. A FAIL here names a grantee that checks 1-4
would never have asked about — meaning some role acquired privileges on one
of these tables via `ALTER DEFAULT PRIVILEGES` rather than from this
migration's own grants. Do not proceed past a check-5 failure: it means the
table's actual ACL is not the one this runbook believes it verified.

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

## 8. Reaper cron — INSTALLED 2026-09-04

**Precondition: step 1, not step 7.** This section previously said step 7.
That was wrong, and the reason it was wrong is the reason it is worth
recording: the precondition its own next sentence gives is *"the table
doesn't exist in its correct shape until step 1 runs"* — which is a
statement about step 1. Step 7 (`verify-telemetry-e2e.ts`) is the gate on
**ingest**, i.e. on rows arriving; the reaper only needs the table to exist,
and deleting nothing from an empty table is a legitimate run. Holding the
reaper behind step 7 would have left the `/privacy` retention sentence
unimplemented for exactly as long as the credential steps (2 and 3) stayed
blocked on a human.

**STATUS as of 2026-09-04, measured — read this before re-installing it.**

- The crontab line below **is installed**, as the `postgres` user on the DB
  box (`crontab -u postgres -l`), byte-identical to the one in this file.
- Cron genuinely fires for that user: proven by installing a throwaway
  marker line and watching it execute (`CRON[2998399]: (postgres) CMD (touch
  /tmp/cron-proof-...)`, 2026-09-04 06:28 CEST), then restoring the crontab
  and re-checking its sha. Exit status was deliberately not used as the
  evidence — see the pass condition below for why.
- **The 08:20 UTC scheduled run has not happened yet** at time of writing.
  There *is* a fresh `job_heartbeats` row (`ok=t`, `rows_affected=0`), but it
  was written by a **manual** invocation of the identical command at 04:26
  UTC, not by cron — `/var/lib/postgresql/reap-telemetry.log` holds exactly
  its output (`0`) with that mtime. Do not read that heartbeat as proof the
  schedule works; the first honest proof of the schedule is a `last_run_at`
  that lands shortly after 08:20 UTC.

**Release gate — status inverted 2026-09-04.** The mechanism is now the part
that exists and the copy is the part that does not: `https://velai.app/privacy`
was fetched on 2026-09-04 and does **not** contain the retention sentence,
the profiling disclosure, the Postgres-location sentence, or the query-text
sentence — all four are still only on `integ/2026-09-03-telemetry`, absent
from `main`, and the live page still tells users their data "lives in Google
Cloud Firestore". So the risk this gate was written to prevent (claim ships
without mechanism) can no longer happen in that direction; the open item is
the reverse, and it is a separate deploy decision, not a cron decision. The
original reasoning is kept below because it is still the right rule.

**Original gate — `/privacy` must not ship before this cron is live.** The
privacy page on this same branch tells users their search-activity records
are "kept for 90 days and then deleted" (`src/app/privacy/page.tsx:157`).
Nothing else in this system deletes them: `intervu.reap_telemetry()` *is*
that sentence's implementation. Until this cron is installed and its
heartbeat is fresh, that sentence is not a pending TODO — it is a false
statement to users about their own data. Ship the claim and the mechanism
together, or hold the privacy copy until the cron is live.

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

## 9. Nightly rollup — NOT INSTALLED

**See "Deploy-order correction" above first.** Installing these crons is
blocked on more than "not yet done": measured 2026-09-04, neither
`build-job-features.ts` nor `roll-up-telemetry.ts` exists anywhere on the
box (oracle: `/opt/intervu/scripts`, 37 files, contains neither). Box cron
scripts actually run from `/opt/interview-os` (the subspace repo, a
separate checkout; 848 files under `scripts/`, 606 at top level) — getting
either script there needs its own deploy step, which the intervu app deploy
above does **not** provide (it populates `/opt/intervu`, which has no
runtime and no dotenv file — see the keystone section). The credential
they'd need (`BATCH_PG_URL`) is already present in that box's
`/opt/interview-os/.env.local` (46 unique keys across 47 assignment lines),
but only reachable by a script that actually sits in that tree.

**Precondition: step 1** (same reasoning as §8 — `telemetry-derived.sql`'s
tables must exist, which step 1 now also applies; ingest arriving, step 7,
is not a precondition for a job that legitimately no-ops over an empty
window).

**STATUS as of 2026-09-04, measured two independent ways — neither job has
ever run:**

- The app box's installed crontab (1281 lines, `crontab -l` as `subspace` on
  194.163.147.154) contains zero lines referencing either script.
- `intervu.job_heartbeats` on prod holds exactly one row (`reap_telemetry`,
  2026-09-04 04:26 UTC). Neither `build-job-features` nor `roll-up-telemetry`
  has ever written a heartbeat.

Unlike §8's reaper, this is **not** a case where the SQL-function path
sidesteps a missing runtime: `build-job-features.ts` and `roll-up-telemetry.ts`
do their own JS-side computation (posting-text parsing; unnesting the
`results_impressed` parallel-array payload — see that file's own header) and
have no SQL-function equivalent, so they need an actual Node/`tsx` runtime
with network access to the DB box. No host has been confirmed to run them —
this section documents the crontab lines to install, not a completed
installation, and does not claim a runtime exists to run them on.

Two scripts, not one, feed this layer — both connect as `pipeline` via
`BATCH_PG_URL` and both call the same `writeHeartbeat` helper
(`src/lib/telemetry/heartbeat.ts`) as `reap_telemetry()` does:

| script | `JOB_NAME` | writes |
|---|---|---|
| `scripts/build-job-features.ts` | `build-job-features` | `intervu.job_features` |
| `scripts/roll-up-telemetry.ts` | `roll-up-telemetry` | `intervu.job_daily`, `intervu.company_daily`, `intervu.feature_outcomes` |

**Ordering constraint:** `build-job-features` populates posting-structure
facts (`job_features`) that the outcome rollup's analysis sits on top of, so
it must run — and land — before `roll-up-telemetry` each night.

**Crontab lines — DO NOT INSTALL THESE BY HAND.** An earlier draft of this
section gave two `crontab -e` lines that were wrong in three independent
ways. They are recorded here as a correction, not as instructions:

1. **`crontab -e` is silently reverted.**
   `/opt/interview-os/scripts/oracle-vm/crontab.conf` is the sole source of
   truth: `scripts/deploy-to-vms.sh:383` reinstalls it verbatim
   (`crontab $APP_DIR/scripts/oracle-vm/crontab.conf`) on every ship, so a
   hand-added line survives only until the next deploy and then vanishes
   with no error.
2. **A cron line naming a script absent from the subspace repo aborts the
   whole deploy.** `deploy-to-vms.sh:373` runs
   `scripts/oracle-vm/validate-crontab-scripts.mjs` before anything touches
   the box; it regexes `scripts/…\.(ts|js|mjs|sh)` out of every uncommented
   line (`validate-crontab-scripts.mjs:52`) and requires
   `path.join(repoRoot, ref)` to exist (`:69`), exiting 1 otherwise. A line
   reading `npx tsx scripts/roll-up-telemetry.ts` while that file lives in
   the *intervu* repo fails this check and blocks every subsequent subspace
   ship — not just this one.
3. **The `BATCH_PG_URL=...` prefix leaks a credential.** `crontab -l` prints
   it in full to anyone on the box. The house pattern is
   `/opt/intervu/deploy/run-weekly-digest.sh`, whose own header states the
   secret is read from the compose env file rather than written into the
   crontab for exactly this reason. A script sitting in the subspace tree
   needs no prefix at all — it reads `BATCH_PG_URL` from
   `/opt/interview-os/.env.local` itself.

The correct shape, once the scripts live in the subspace repo, is a
`$RUN`-wrapped pair (`crontab.conf:21` defines
`RUN=/opt/interview-os/scripts/oracle-vm/run-job.sh`) added to
`crontab.conf` **in the same commit that adds the scripts** — the only
ordering the validator permits:

```cron
50 7 * * *  $RUN build-job-features "npx tsx scripts/build-job-features.ts"
5 8 * * *   $RUN roll-up-telemetry  "npx tsx scripts/roll-up-telemetry.ts"
```

**BLOCKED — ruling owed.** Whether the two scripts move into the subspace
repo (which is what makes the block above valid at all) was put to Vivek on
2026-09-04 and is unanswered. Do not install, commit, or deploy any of this
until it is answered.

**Why these times — provisional, not validated.** §8 established that hour
8 UTC (except the Monday/Thursday-only `10 8`/`35 8` entries) is the one
block in the app box's production crontab with no daily fixed-start job.
07:50 and 08:05 UTC extend that same free window backward and into it,
15 minutes apart in dependency order, ahead of the reaper's 08:20 UTC. That
15-minute spacing is a guess at how long each job takes against a table this
size today — **neither script's runtime has been measured**, so these gaps
are not validated against an actual run and could prove too tight or
unnecessarily wide once one exists to time.

**Pass condition, once installed** — same heartbeat-based check as §8, one
row per job:

```sql
select job_name, last_run_at, rows_affected, ok
from intervu.job_heartbeats
where job_name in ('build-job-features', 'roll-up-telemetry');
```

Do not treat exit status alone as evidence — §8's own precedent (five daily
crons ran dead for up to ten days while exiting 0 every time) applies here
identically.
