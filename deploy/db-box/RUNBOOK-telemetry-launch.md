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
| 1b. pg_hba rule (`telemetry_pg` admitted from the app box) | **done** — 2026-09-04, rule appended to `/etc/postgresql/17/main/pg_hba.conf` + `select pg_reload_conf()` (reload, not restart); verified via `pg_hba_file_rules` (line 142, `error` IS NULL, 10 rules / 0 errors) and a credential-free before/after psql probe — see §1b |
| 2. `telemetry_pg` password | **not done — HUMAN-ONLY, blocked on an operator** |
| 3. `TELEMETRY_PG_URL` in the app box env | **not done** — key absent from both `/opt/interview-os/deploy/contabo-web/intervu.env` and the running `contabo-web-intervu-1` container (checked by key name; no value was read or printed) |
| 4. container recreate | not done (nothing to pick up until 3) |
| 5. mmdb geo sanity-check | not done |
| 6. `verify-telemetry-grants.sh` | not run (needs `BATCH_PG_URL`) |
| 7. `verify-telemetry-e2e.ts` | not run — **this is the launch gate** |
| 8. reaper cron | **done** — installed 2026-09-04 and the first *scheduled* run fired the same morning, 08:20:02 Europe/Berlin = 06:20:02 UTC, `ok=t` (see §8) |
| 9. derived-layer crons (`build-job-features`, `roll-up-telemetry`) | **check before trusting this row** — the two crontab lines and their host-side wrapper are committed (subspace `feat/2026-09-04/telemetry-derived-cron`, intervu `deploy/run-telemetry-job.sh`); being committed does not mean either job is installed or has ever run — re-verify both, don't assume a snapshot from an earlier read still holds. To check: (1) `crontab -l` on the app box for two `run-telemetry-job.sh` lines, one per job name; (2) `select job_name, last_run_at, ok from intervu.job_heartbeats order by last_run_at desc;` — a row for `build-job-features`/`roll-up-telemetry` with a recent `last_run_at` and `ok = t` means that job is installed and running; if only `reap_telemetry` (or an old `last_run_at`) shows up, it is not. **Ships only after the intervu deploy** (see §9) |

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
- pg_hba rejects the role (found and fixed 2026-09-04 — see §1b): with
  `TELEMETRY_PG_URL` set but no matching `pg_hba.conf` rule, the insert
  raises the connection's own FATAL — `FATAL:  no pg_hba.conf entry for
  host "194.163.147.154", user "telemetry_pg", database "postgres", SSL
  encryption` — which is caught by the **same** `route.ts:136-138` block as
  the drifted-table case above and logged with the **same**
  `[telemetry] insert failed:` prefix, still `204`. On the wire this cause
  is byte-identical to the drifted-table cause; only the error text after
  the log prefix tells them apart.
- missing `TELEMETRY_PG_URL` (`getTelemetryPg()` returns `null`, insert
  skipped outright, still `204` — `route.ts:133`) — logged differently from
  the two causes above, as `[telemetry] no pg pool configured
  (TELEMETRY_PG_URL unset?)`, not `[telemetry] insert failed:`

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

**Run in two hops.** The `scp` below runs on your **dev machine**, cwd =
the **root of this repo checkout** — its arguments are relative paths
(`deploy/db-box/...`) that only resolve from there. Everything after `ssh`
runs on the **DB box** (169.58.140.49), as the `postgres` OS user, over the
local socket — fact-checked 2026-09-03: this box has exactly one
non-template database (`postgres`; `intervu` is a schema inside it, not a
database), and `postgres`-over-local-socket needs no password or connection
string at all.

```bash
# Dev machine, cwd = repo root (paths below are relative to it):
scp deploy/db-box/apply-telemetry-migration.sh \
    deploy/db-box/telemetry-schema.sql \
    deploy/db-box/telemetry-events-drop-orphan.sql \
    deploy/db-box/telemetry-derived.sql \
    root@169.58.140.49:/tmp/telemetry-migration/
ssh root@169.58.140.49
# Now on the DB box (169.58.140.49); cwd doesn't matter — absolute path:
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

## 1b. pg_hba: admit `telemetry_pg` from the app box

**STATUS — DONE, 2026-09-04.** Applied directly on the DB box. This is not
run by any script in this repo — see "must be re-applied" below for why.

**Why this is a separate step from applying `telemetry-schema.sql`.** A
least-privilege ROLE and a least-privilege NETWORK RULE are two different
objects. Step 1 creates the `telemetry_pg` role and grants it exactly one
privilege — INSERT on `intervu.telemetry_events` — which governs what the
role may do *once it has a connection*. It says nothing about which host is
even allowed to open that connection; that is `pg_hba.conf`'s job, a
separate file the schema migration never touches. Measured 2026-09-04,
before this fix: `/etc/postgresql/17/main/pg_hba.conf` on the DB box
(169.58.140.49) had exactly two remote rules — for `pipeline` and
`agent_pg`, both `host postgres <role> 194.163.147.154/32 scram-sha-256` —
and no rule for `telemetry_pg` at all. Re-running step 1 any number of
times would never have created one.

**Consequence measured before the fix**, from the app box
(194.163.147.154), using a deliberately fake password so no secret was ever
involved:

```
psql: error: connection to server at "169.58.140.49", port 5432 failed: FATAL:  no pg_hba.conf entry for host "194.163.147.154", user "telemetry_pg", database "postgres", SSL encryption
```

This is exactly why steps 2 and 3 below, though each individually correct,
are **jointly insufficient** on their own: `/api/telemetry`'s guard 8
(`route.ts:158-169`) wraps the insert in try/catch and still returns `204`
no matter what the connection attempt raises, so a pg_hba rejection like
this one is invisible on the wire (§0's cause list above now names it).

**Fix applied** — appended to `/etc/postgresql/17/main/pg_hba.conf` (backup
taken first at `/root/pg_hba.conf.bak-20260904T083301Z`), then reloaded, a
**reload, never a restart** (`select pg_reload_conf();` — no dropped
connections):

```
# Added 2026-09-04: the telemetry ingest seam. /api/telemetry runs in the
# intervu container on the app box and connects as telemetry_pg, whose ONLY
# privilege in this cluster is INSERT on intervu.telemetry_events (it cannot
# even SELECT its own writes). Without this line the runbook's §2 (password)
# and §3 (TELEMETRY_PG_URL) are individually correct but jointly insufficient:
# the route's guard-8 try/catch swallows the connection FATAL and still
# returns 204, so the miss is invisible on the wire.
host    postgres    telemetry_pg    194.163.147.154/32    scram-sha-256
```

**Verified after reload** via `pg_hba_file_rules`: the new rule is line 142,
its `error` column is `NULL`, and the file parses as 10 rules with 0
errors.

**Pass condition — credential-free, the same probe, now the other side of
the fix.** Password still deliberately wrong:

```
psql: error: connection to server at "169.58.140.49", port 5432 failed: FATAL:  password authentication failed for user "telemetry_pg"
```

The error moved from "no pg_hba.conf entry" to "password authentication
failed" — that move is the pass signal. `telemetry_pg`'s `rolpassword` is
still `NULL`, so this rule alone grants zero real access; it only proves the
role is now reachable and admitted from the app box, with step 2 (the
password) as the one thing left. `deploy/db-box/preflight-telemetry-connectivity.sh`
automates exactly this before/after probe for all three roles this runbook
uses — see its own header — and is the credential-free gate this repo did
not have when this gap went unnoticed.

**Must be re-applied if the DB box is ever rebuilt.** This rule lives in
`/etc/postgresql/17/main/pg_hba.conf`, not in any file this repo owns.
`apply-telemetry-migration.sh` (step 1) only runs `.sql` files over the
local socket — it has no reason to touch host-based authentication config,
and it does not. A fresh box, or a Postgres package reinstall that
regenerates this file from its default template, will not carry this rule
forward on its own.

## 2. Set the `telemetry_pg` password — HUMAN-ONLY

**See "Deploy-order correction" above first: this step is currently INERT.**
`/api/telemetry` is not in the deployed build, so setting this password
cannot yet change what happens to any request.

**Precondition:** step 1 exited 0 (the `telemetry_pg` role now exists,
password-less).

**Run**, still as `postgres` on the DB box (169.58.140.49), in an
**interactive** psql session (cwd doesn't matter — no relative paths):

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

**Pass condition** (same DB box, same psql session; no plaintext read-back
needed or possible):

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

**Two different env files exist for this product on the app box — do not
confuse them.** Measured 2026-09-04, key presence only, no values read:

| file | consumer | keys | has |
|---|---|---|---|
| `/opt/interview-os/deploy/contabo-web/intervu.env` | the **container** — `docker-compose.yml`'s `env_file` (lines 43-44) | 31 | `TELEMETRY_PG_URL`: 0 (this step adds it); `BATCH_PG_URL`: 0 |
| `/opt/interview-os/.env.local` | the **host cron jobs** — `run-telemetry-job.sh`'s `ENV_FILE` default (`run-telemetry-job.sh:46`) | 46 | `BATCH_PG_URL`, `MEILI_URL`, `MEILI_ADMIN_KEY`: 1 each; `TELEMETRY_PG_URL`: 0 |

This step edits `intervu.env` and only `intervu.env` — deliberately, not an
oversight: `/api/telemetry` runs in the container, so the container's env
file is the only one that can affect it. §9's two derived-table cron jobs
(`build-job-features`, `roll-up-telemetry`) do **not** need
`TELEMETRY_PG_URL` at all — audited: `build-job-features` reaches only
`BATCH_PG_URL`/`MEILI_URL`/`MEILI_ADMIN_KEY`, `roll-up-telemetry` only
`BATCH_PG_URL`, exactly what `run-telemetry-job.sh`'s wrapper exports from
`.env.local` (§9). So there is no missing step on that side; adding
`TELEMETRY_PG_URL` to `.env.local` too would not be wrong, just useless.

**Run:** on the app box (194.163.147.154), as `subspace` — the file is
mode `-rw-------`, owned by `subspace`, and lives outside the git tree at
`/opt/interview-os/deploy/contabo-web/intervu.env`, so no `sudo` is needed
or wanted (cwd doesn't matter — the path below is absolute). Open it with
an editor, not a shell redirect, so the connection string (with its
plaintext password) never touches shell history:

```bash
nano /opt/interview-os/deploy/contabo-web/intervu.env
```

Add one line:

```
TELEMETRY_PG_URL=postgresql://telemetry_pg:<the password from step 2>@169.58.140.49:5432/postgres
```

**Pass condition**, same app box (194.163.147.154), cwd doesn't matter —
absolute path (counts the line without ever printing the value):

```bash
grep -c '^TELEMETRY_PG_URL=' /opt/interview-os/deploy/contabo-web/intervu.env
# expect: 1
```

## 4. Recreate the container

**Precondition:** step 3's grep returned `1`.

**Run:** on the app box (194.163.147.154). The block below `cd`s to its own
working directory and chains it with `&&`, so it's safe to start from
anywhere: a failed `cd` stops there rather than running `docker compose`
from whatever directory the operator was standing in (compose resolves its
project from cwd).

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
cd /opt/interview-os/deploy/contabo-web && \
docker compose up -d --force-recreate intervu
```

Do not add `--build` here — nothing in the image changed, only the runtime
env file. `--build` is for an actual code deploy (extract → swap →
`docker compose up -d --build intervu`, documented elsewhere); running it
here is unnecessary time and risk for zero benefit. Never run two concurrent
compose builds against this stack.

**Pass condition**, same app box (194.163.147.154); cwd doesn't matter —
`docker exec` targets a container name, not a path — container was
actually recreated, and the container's own env now carries the key,
without ever printing its value:

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

**Run, from a known non-EU host — not from the Contabo box itself** (cwd
doesn't matter — the command uses no relative paths):

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
password, app has `TELEMETRY_PG_URL`, container is running with it) — which
already includes §1b, since step 2's password is meaningless until §1b's
pg_hba rule admits the role at all. Run this from 194.163.147.154: that is
the only address any of the three roles' pg_hba rules (`telemetry_pg`,
`agent_pg`, `pipeline`) admit a connection from.

**Run:** on the app box (194.163.147.154) — it is both the only address any
of the three roles' pg_hba rules admit, and the box holding
`intervu.env`. **No `cd` needed:** the only copy of this script on the box
is `/opt/intervu/deploy/db-box/verify-telemetry-grants.sh` (mode `755`,
measured 2026-09-04) — invoke it by that absolute path. The script is
cwd-independent by construction (its own line 241 resolves its sibling SQL
file as `"$(dirname "${BASH_SOURCE[0]}")/telemetry-derived.sql"`,
script-relative, not cwd-relative), so do not "helpfully" add a `cd` back;
an unguarded `cd` that failed would let the invocation silently resolve
against whatever directory the operator happened to be in. Do
**not** hand-type `TELEMETRY_PG_URL` here: a typo in a hand-typed value
would still let this check pass while §3's actual line (the one the
container reads) stays broken, which is exactly the seam this step exists
to close. Instead read it back from the file, with the same `read_key()`
parsing `run-telemetry-job.sh:121` uses — `tail -1`, not `head -1`, because
dotenv is last-assignment-wins and this file is known to assign at least
one key twice — so this check can never pass against a value the container
does not actually use. The value is never echoed. **A failed check must
not `exit` here** — this block is meant to be pasted into an interactive
SSH session, and `exit 1` logs the operator out of that shell rather than
just failing the check, which reads as a dropped connection, not a failed
precondition. The guard below only skips running the verifier on failure;
it never terminates the shell:

```bash
ENV_FILE=/opt/interview-os/deploy/contabo-web/intervu.env
read_key() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"'"'"'\r'; }

TELEMETRY_PG_URL="$(read_key TELEMETRY_PG_URL)"
if [[ -z "$TELEMETRY_PG_URL" ]]; then
  echo "TELEMETRY_PG_URL missing/empty in $ENV_FILE — §3 is not done" >&2
else
  AGENT_PG_URL="postgresql://agent_pg:<password>@169.58.140.49:5432/postgres" \
  BATCH_PG_URL="postgresql://pipeline:<password>@169.58.140.49:5432/postgres" \
  TELEMETRY_PG_URL="$TELEMETRY_PG_URL" \
    /opt/intervu/deploy/db-box/verify-telemetry-grants.sh
fi
```

`AGENT_PG_URL`/`BATCH_PG_URL` stay hand-typed: neither role's URL is stored
in `intervu.env` (§3's env-file table above — `BATCH_PG_URL`: 0 there),
so there is no file to fall out of sync with for those two.

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

**Run:** on the app box (194.163.147.154) — measured 2026-09-04, the DB
box's `ufw` is `active`, default-deny incoming, with exactly one `ACCEPT`
rule for port 5432 (a single `/32`, the app box) and zero port-less
`ACCEPT` rules. "A machine that can reach both the live app and the DB box"
therefore names a set with exactly one member: this box. **Cwd:
`/opt/intervu`.** `npx tsx` needs `node_modules`, which this tree has only
after `deploy/run-telemetry-job.sh` has self-healed it for some job
(`npm ci --include=dev`, then an explicit `-x node_modules/.bin/tsx`
assertion — see that script's lines 140-165); a bare deploy leaves
`/opt/intervu` with no `node_modules` at all. If it's missing here, run
`npm ci --include=dev` in `/opt/intervu` first, or let a
`run-telemetry-job.sh` invocation create it. Unlike §6, `npx tsx` genuinely
does resolve `node_modules` from the cwd, so the `cd` below is chained with
`&&` rather than dropped: a failed `cd` must not let the command run
against `node_modules` in the wrong directory, and (same reasoning as §6's
`if`/`else`) it still must not `exit`/kill an interactive shell — `&&`
satisfies both.

**Trap — `nc` is not a valid reachability check for the DB box.** Measured
2026-09-04: `nc -z 169.58.140.49 5432` from a dev machine prints
"succeeded" (something upstream answers the TCP handshake) while `psql` to
the same host and port times out. Chasing that `nc` result sends you
hunting a network problem that isn't the one you actually have. Use
`deploy/db-box/preflight-telemetry-connectivity.sh` instead — it
classifies the server's own reply rather than just the handshake, and it
needs no credential.

```bash
cd /opt/intervu && \
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

## 8. Reaper cron — INSTALLED AND PROVEN 2026-09-04

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
- **The first scheduled run has now happened**: 2026-09-04 08:20:02
  Europe/Berlin (06:20:02 UTC), `ok=t`, `rows_affected=0`. Measured three
  independent ways, because for most of that morning the only available
  evidence was an oracle that could not tell the two cases apart —
  a `job_heartbeats` row identical in every respect to one a **manual**
  invocation of the same command had already written. A heartbeat says the
  function ran; it does not say *cron* ran it. The three legs:
  1. syslog, which names the scheduler:
     `2026-09-04T08:20:02+02:00 … CRON[3033046]: (postgres) CMD (psql -d
     postgres -Atc "select intervu.reap_telemetry(90)" …)`.
  2. the redirect log `/var/lib/postgresql/reap-telemetry.log`, appended to
     at 08:20:03.18 +0200 — a second `0` line beneath the manual run's.
  3. the heartbeat row itself: `last_run_at = 2026-09-04 08:20:02.688+02`.
- Note the ordering that made leg 1 necessary: the marker test earlier that
  morning proved cron fires **for this user at all**
  (`CRON[2998399]: (postgres) CMD (touch /tmp/cron-proof-…)`, 06:28 CEST) —
  a strictly weaker claim than "this line fires on its schedule". Both were
  needed; neither substitutes for the other.

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

**Why 08:20 — and it is 08:20 *Europe/Berlin*, not UTC.** Both boxes run
`Europe/Berlin` (`timedatectl` on each, 2026-09-04: `CEST, +0200`), and cron
reads box-local time, so every hour field here and in the app box's
`crontab.conf` is local — that file's own header warns that its older
comments saying "UTC" are wrong by two hours. The slot analysis below is
therefore still sound: it compares local against local. Only the label was
wrong. In UTC this line runs at 06:20.

Cross-referenced against the app box's full production
crontab (`crontab -l` as `subspace` on 194.163.147.154, which is what
actually generates load against this same DB box's Postgres). Hour 8 local is
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

## 9. Derived tables — SCHEDULED 2026-09-04, not yet run

**See "Deploy-order correction" above first.** These two jobs fill the
user-profile half of the telemetry layer. Both were written, reviewed and
deployed weeks ago; neither has ever run, because nothing scheduled them.

| script | `JOB_NAME` | writes |
|---|---|---|
| `scripts/build-job-features.ts` | `build-job-features` | `intervu.job_features` |
| `scripts/roll-up-telemetry.ts` | `roll-up-telemetry` | `intervu.job_daily`, `intervu.company_daily`, `intervu.feature_outcomes` |

Both connect as `pipeline` via `BATCH_PG_URL` and both call the same
`writeHeartbeat` helper (`src/lib/telemetry/heartbeat.ts`) that
`reap_telemetry()` uses, so liveness is judged from
`intervu.job_heartbeats`, never from an exit code.

**Precondition: step 1** (same reasoning as §8 — `telemetry-derived.sql`'s
tables must exist. Ingest arriving, step 7, is *not* a precondition: both
jobs legitimately no-op over an empty window).

### How they run: host-side, from `/opt/intervu`

`deploy/run-telemetry-job.sh <job-name>`, called directly from the app
box's crontab. Two alternatives were considered against measurements and
rejected:

- **HTTP into the container**, the `run-weekly-digest.sh` pattern.
  Rejected on credential placement. The digest works over HTTP because it
  is a *web-tier* job needing nothing the web tier lacks. These are
  *pipeline-tier*: they need `BATCH_PG_URL` (the pipeline write role) and
  `MEILI_ADMIN_KEY`, and `intervu.env` deliberately carries neither.
  Adopting the digest's shape would mean moving the pipeline write role and
  a Meili admin key onto the public web surface to save a shell script.
- **Moving both scripts into the subspace repo** (an earlier draft of this
  section assumed this, and a ruling was owed on it — that ruling is now
  moot). Rejected on cost: the import closure is 14 files and 2,216
  lines (re-derived 2026-09-04 by walking the `@/` and relative import
  edges out from both entrypoints), and it would permanently fork `features.ts`, the extractor that
  defines what a job feature *is*.

Host-side execution needs no new credential, no new Postgres role and no
new surface: `/opt/interview-os/.env.local` on the app box already holds
`BATCH_PG_URL`, `MEILI_URL` and `MEILI_ADMIN_KEY` (verified 2026-09-04,
one assignment each).

**A deployed script is not a runnable script.** `/opt/intervu` carries the
full repo source but no `node_modules` and no `.env` file, so the scripts
sit there deployed and unrunnable. The wrapper closes both gaps: it runs
`npm ci --include=dev` once per deploy (the swap replaces the tree, so
`node_modules` is absent again after every ship), and it reads exactly the
three keys these jobs need rather than sourcing a 47-key env file into the
shell.

`--include=dev` is load-bearing: `tsx` is a devDependency, and npm omits
devDependencies when `NODE_ENV=production`, which would leave `npm ci`
exiting 0 with no runtime installed. The wrapper asserts afterwards that
`tsx` is actually executable rather than trusting npm's exit status.

`tsx` is a *declared, pinned* devDependency as of `b4abff5`. Before that,
`npx tsx` resolved it from the npm registry at run time — an unpinned
supply-chain dependency for a scheduled job on a credential-holding box.

### The crontab lines

**Do not add these by hand.** They live in the subspace repo at
`scripts/oracle-vm/crontab.conf` and are installed by the ship:

```cron
37 9 * * *  /opt/intervu/deploy/run-telemetry-job.sh build-job-features
7 11 * * *  /opt/intervu/deploy/run-telemetry-job.sh roll-up-telemetry
```

Four properties of that shape, each of which an earlier draft got wrong:

1. **`crontab -e` is silently reverted.** `crontab.conf` is the sole source
   of truth: `scripts/deploy-to-vms.sh:383` reinstalls it verbatim on every
   ship, so a hand-added line survives until the next deploy and then
   vanishes with no error.
2. **A `scripts/…` reference aborts the whole deploy.**
   `deploy-to-vms.sh:373` runs `validate-crontab-scripts.mjs`, which
   regexes `scripts/…\.(ts|js|mjs|sh)` out of every active line (`:52`) and
   requires `path.join(repoRoot, ref)` to exist against the *subspace* root
   (`:69`), exiting 1 otherwise. A line reading
   `npx tsx scripts/roll-up-telemetry.ts` would match that pattern, never
   resolve, and block every subsequent subspace ship — not just this one.
   The wrapper's absolute path contains no `scripts/` segment, so these
   lines are outside the pattern by construction. This is the same
   structural reason `/opt/intervu/deploy/run-weekly-digest.sh` has
   survived every ship.
3. **No `BATCH_PG_URL=...` prefix.** `crontab -l` prints a prefix in full
   to anyone on the box. The wrapper reads the key from the env file
   itself, which is also why it can be added to a repo without a secret in
   the diff.
4. **Not `$RUN`-wrapped.** `run-job.sh` fast-forwards `/opt/interview-os`
   before every job; these are intervu's jobs and must not drag a subspace
   git pull behind them. Same reasoning as the weekly-digest line directly
   above them in `crontab.conf`.

**Why these times.** Europe/Berlin box-local, like every line in that file
— `crontab.conf` warns in its own header that older comments claiming UTC
are wrong by two hours, and the app box confirms `CEST, +0200`. The
minutes are deliberately not multiples of five: `ops-health` runs `*/5`,
the watcher fleet `*/15`, and `:40`/`:50` carry hourly jobs, so **every
round minute is already occupied in every hour**. 09:37 and 11:07 have no
concurrent job at all.

The 90-minute gap makes an overlap unlikely, **not impossible** — neither
script's runtime has been measured against the full corpus. It does not
need to be impossible: `roll-up-telemetry` skips any `job_id` missing from
`job_features` rather than failing, and replaces the window's rows on every
run, so a rollup that caught a half-refreshed table simply emits fewer
`feature_outcomes` rows and the next night's run restores them. Time one
real run before tightening the gap.

They are two separate lines rather than one `&&` chain because `job_daily`
and `company_daily` are computed from the events alone
(`roll-up-telemetry.ts:219,221`) — only `feature_outcomes` reads
`job_features` — so a failed build must not suppress them.

### Deploy order — this matters

`/opt/intervu/scripts/` did **not** contain either script as of
2026-09-04 (the deployed tree predates them), and the wrapper is not there
either. A cron line pointing at a missing script fails every day, quietly.
So:

1. Deploy intervu (the keystone deploy, above). This puts both scripts
   *and* the wrapper into `/opt/intervu`.
2. Confirm `/opt/intervu/deploy/run-telemetry-job.sh` exists and is
   executable, and that `scripts/build-job-features.ts` and
   `scripts/roll-up-telemetry.ts` are present.
3. Only then ship the subspace change carrying the two crontab lines.

The wrapper's own guards make step 3 safe if this order slips — it refuses
with `no such job: … does not exist (deploy stale, or job renamed)` rather
than reporting a failure for a job that never started — but a refusal every
morning is still a broken schedule.

### Testing the wrapper

`bash deploy/test-run-telemetry-job.sh` — 8 cases, no database, no network,
no Meili. Every case that expects a refusal also asserts the job did not
start, because "exited non-zero" and "refused before starting" are the two
outcomes this subsystem exists to tell apart. The suite is verified
discriminating by mutation, not merely green.
**Pass condition, once installed** — same heartbeat-based check as §8 (on
the DB box, or via `BATCH_PG_URL` from anywhere), one row per job:

```sql
select job_name, last_run_at, rows_affected, ok
from intervu.job_heartbeats
where job_name in ('build-job-features', 'roll-up-telemetry');
```

Do not treat exit status alone as evidence — §8's own precedent (five daily
crons ran dead for up to ten days while exiting 0 every time) applies here
identically.
