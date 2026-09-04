\set ON_ERROR_STOP on
-- ^ Load-bearing, not boilerplate. §0 below is only a guard if execution
--   actually stops when it raises. Measured on the box 2026-09-03: with
--   psql's default on_error_stop=off, a `raise exception` in a do-block
--   prints ERROR, the NEXT statement still runs, and psql exits 0 — so §1's
--   `create table if not exists` would no-op past a failed drift check and
--   §2–§7 would grant on the wrong table, all under a clean exit status.
--   Setting it here instead of relying on `-v ON_ERROR_STOP=1` makes the
--   abort a property of the file rather than of whoever remembers the flag;
--   self-set is exactly equivalent to the flag, exit code included (both
--   exit 3). Do not remove this line.

-- Telemetry ledger table plus its least-privilege ingest role.
--
-- Companion to deploy/db-box/agent-credentials-role.sql: same shape (DDL and
-- GRANTs in one file so they cannot drift), same reasoning extended to a
-- second internet-facing path — a role scoped to exactly what its request
-- path needs, nothing else on the schema.
--
-- Run manually against the box, as a superuser or the schema-owning role
-- (`pipeline`), top to bottom. Idempotent: every statement is safe to
-- re-run. Not applied by CI or app code. Run with
-- `psql -f telemetry-schema.sql` — the file sets ON_ERROR_STOP itself on
-- line 1, so a §0 guard failure aborts the run whatever the call site does.

-- ---------------------------------------------------------------------------
-- 0. Drift guard. §1's `create table if not exists` is a no-op if a table by
--    this name already exists — including one with a completely different
--    shape. That is exactly what happened on prod 2026-09-03: an unrelated
--    pre-spec `telemetry_events` table already existed, so this file ran
--    "successfully" while creating nothing, every insert downstream started
--    failing on missing columns, the ingest route's catch-and-204
--    (src/app/api/telemetry/route.ts:136-138) swallowed every failure, and
--    the launch looked completely healthy while storing zero rows.
--
--    This block makes that failure loud instead of silent. If the table
--    already exists, its column set must match this file's exactly — same
--    names AND same types, so a same-named column with a drifted type (e.g.
--    text where this file expects uuid) is caught, not just an added or
--    missing column — and it must carry the event_id unique constraint.
--    Anything else aborts the run with the actual diff named. The diff is
--    computed from information_schema/pg_catalog at run time, not hardcoded
--    against today's known drift, so it catches whatever the next drift
--    turns out to be too.
--
--    If this fires with the 2026-09-03 orphan shape (no event_id, 0 rows),
--    run deploy/db-box/telemetry-events-drop-orphan.sql first, then re-run
--    this file.
-- ---------------------------------------------------------------------------
do $$
declare
  -- One entry per column this file guarantees, as `name:data_type` — the
  -- exact strings information_schema.columns.data_type reports for the
  -- types declared in §1 below.
  expected_columns text[] := array[
    'id:bigint',
    'event_id:uuid',
    'received_at:timestamp with time zone',
    'occurred_at:timestamp with time zone',
    'session_id:uuid',
    'visitor_id:uuid',
    'user_id:text',
    'event_name:text',
    'source:text',
    'query_id:uuid',
    'job_id:text',
    'company_domain:text',
    'position:integer',
    'props:jsonb'
  ];
  actual_columns      text[];
  missing_columns     text[];
  unexpected_columns  text[];
  has_event_id_unique boolean;
begin
  if to_regclass('intervu.telemetry_events') is null then
    return; -- doesn't exist yet; §1 below creates it fresh.
  end if;

  select coalesce(array_agg(column_name || ':' || data_type), '{}')
    into actual_columns
    from information_schema.columns
    where table_schema = 'intervu' and table_name = 'telemetry_events';

  -- Expected-but-absent (by exact name:type). A same-named, wrong-typed
  -- column shows up here AND in unexpected_columns below, which reads as
  -- "this column exists but with the wrong type" rather than two unrelated
  -- facts.
  select coalesce(array_agg(c), '{}') into missing_columns
    from unnest(expected_columns) c
    where c <> all(actual_columns);

  -- Present-but-not-expected (extra columns, or a name:type this file
  -- never declared).
  select coalesce(array_agg(c), '{}') into unexpected_columns
    from unnest(actual_columns) c
    where c <> all(expected_columns);

  -- The event_id column must carry a UNIQUE constraint on exactly that one
  -- column (matching §1's `constraint telemetry_events_event_id_key unique
  -- (event_id)`), not merely exist.
  select exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'intervu'
      and rel.relname = 'telemetry_events'
      and con.contype = 'u'
      and con.conkey = array(
        select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'event_id'
      )
  ) into has_event_id_unique;

  if cardinality(missing_columns) > 0
     or cardinality(unexpected_columns) > 0
     or not has_event_id_unique then
    raise exception 'intervu.telemetry_events exists but does not match this file. missing (name:type expected, absent or wrong-typed here): %. unexpected (name:type present, not expected by this file): %. event_id unique constraint present: %. Refusing to continue: create table if not exists would silently leave the existing table in place while application inserts begin failing against it. If this is the known 2026-09-03 orphan, run deploy/db-box/telemetry-events-drop-orphan.sql first, then re-run this file.',
      missing_columns, unexpected_columns, has_event_id_unique;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The ledger. Column names, types and indexes are FIXED by the telemetry
--    spec's data model (§2) — do not rename or add a column here without
--    updating the spec first.
-- ---------------------------------------------------------------------------
create table if not exists intervu.telemetry_events (
  id             bigserial   primary key,
  event_id       uuid        not null,
  received_at    timestamptz not null default now(),
  occurred_at    timestamptz not null,
  session_id     uuid        not null,
  visitor_id     uuid,
  user_id        text,
  event_name     text        not null,
  source         text,
  query_id       uuid,
  job_id         text,
  company_domain text,
  position       integer,
  props          jsonb       not null default '{}'::jsonb,
  constraint telemetry_events_event_id_key unique (event_id)
);

create index if not exists telemetry_events_received_brin
  on intervu.telemetry_events using brin (received_at);
create index if not exists telemetry_events_user_time
  on intervu.telemetry_events (user_id, received_at desc) where user_id is not null;
create index if not exists telemetry_events_query
  on intervu.telemetry_events (query_id) where query_id is not null;
create index if not exists telemetry_events_job_time
  on intervu.telemetry_events (job_id, received_at desc) where job_id is not null;

-- NO GIN INDEX ON `props` — DELIBERATE. The 2026-09-03 prod incident: GIN
-- pending-list conscription on a high-write table made unrelated writers
-- pay the cleanup and produced 30 minutes of lost PostgREST writes, and that
-- GIN was read by no production plan. telemetry_events is the highest-write
-- table this system owns. If a props query is ever genuinely needed, add a
-- generated column plus a btree over that one field — never a GIN over the
-- whole blob.

-- ---------------------------------------------------------------------------
-- 2. Heartbeat table. One row per named job. A job that cannot prove it ran
--    is a job nobody knows is dead — five daily crons in this system ran
--    dead for up to 10 days while exiting 0.
-- ---------------------------------------------------------------------------
create table if not exists intervu.job_heartbeats (
  job_name      text        primary key,
  last_run_at   timestamptz not null,
  rows_affected bigint,
  ok            boolean     not null
);

-- ---------------------------------------------------------------------------
-- 3. Ingest role. LOGIN, no password set here — set one out of band with
--    `\password telemetry_pg` after creation and never commit it (same
--    convention as agent-credentials-role.sql's ROLE SETUP block).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'telemetry_pg') then
    create role telemetry_pg login;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Ownership pin + catalog-driven privilege strip.
--
--    Measured on the box 2026-09-03 (pg_default_acl, cross-validated across
--    5 query oracles): defaclrole=postgres, defaclnamespace=intervu,
--    defaclobjtype=r -> {service_role=arwdDxtm/postgres,
--    pipeline=arwdDxtm/postgres}. That rule fires on EVERY table `postgres`
--    creates in schema intervu — full privileges including DELETE and
--    TRUNCATE to service_role, at creation time, before any GRANT below
--    runs. apply-telemetry-migration.sh runs this file as `sudo -u
--    postgres`, so both tables §1 and §2 create above acquired it the
--    moment they were created, not from any statement in this file.
--
--    Today's intervu.telemetry_events (the pre-spec orphan dropped by
--    deploy/db-box/telemetry-events-drop-orphan.sql, not the table §1
--    creates) never showed this, because it happens to be owned by
--    `pipeline`, not `postgres` — the default-ACL rule never fired on it.
--    That is an absence of evidence, not evidence of absence: the rule
--    still applies to this schema, it simply never matched that one
--    table's owner. This resolves the "RULING OWED (Vivek)" this section
--    used to carry about service_role — the grant is neither stale nor
--    mysterious, it is ALTER DEFAULT PRIVILEGES doing exactly what it is
--    configured to do.
--
--    ALTER DEFAULT PRIVILEGES is keyed on the CREATING role (defaclrole),
--    not on anything this file writes. Left alone, security posture here
--    depends on which OS user happened to type `create table` — run this
--    file by hand as yourself instead of via sudo -u postgres and the table
--    comes out clean by accident, not by design. Pinning ownership to
--    `pipeline` below makes the posture depend on this file instead:
--    `pipeline` is not the role the rule matches (defaclrole=postgres), so
--    a table owned by `pipeline` never acquires service_role in the first
--    place — not on this run, not on any re-run, regardless of which role
--    executes the file. It also makes §5's own comment ("the reaper and
--    the nightly rollup run as `pipeline`, the table owner") true rather
--    than aspirational — today that sentence is false whenever this
--    migration is applied by a superuser.
--
--    Order inside the do-block matters and is not cosmetic. ALTER TABLE
--    OWNER TO does not touch relacl — it changes pg_class.relowner and
--    nothing else. The strip loop below decides who to revoke by comparing
--    each ACL grantee to c.relowner AT THE MOMENT THE LOOP RUNS. If the
--    strip ran before the owner change, relowner would still read
--    `postgres`, and the loop would revoke `pipeline` right alongside
--    service_role — stripping the very grant the default-ACL rule just
--    gave it, and requiring a human to notice and re-grant it by hand.
--    Altering the owner first means the loop's owner-exclusion already
--    matches the table's correct, final owner, so only the illegitimate
--    grantee(s) get stripped.
--
--    The strip reads grantees off the catalog (aclexplode(c.relacl))
--    rather than naming roles — the failure this section closes is "a
--    privilege arrived by a path this file does not control", and a
--    hardcoded list of today's offenders (service_role, agent_pg) cannot
--    close that: a role added to the default-ACL rule next month would
--    sail through a hand-written revoke list exactly the way service_role
--    did.
--
--    This also carries forward, in effect rather than by name, the old
--    `revoke all on intervu.telemetry_events from agent_pg` line that used
--    to live here: agent_pg is stripped by this same loop if it is ever
--    present on either table. It is not named because agent_pg is not
--    part of the default-ACL rule above — on a freshly created table that
--    revoke was always a no-op; the table it was guarding against was the
--    pre-spec orphan, which is handled by dropping it
--    (deploy/db-box/telemetry-events-drop-orphan.sql), not by this file
--    recreating it.
--
--    The loop itself lives in telemetry-acl-strip.sql, not inline here —
--    apply-telemetry-migration.sh's preflight self-test \ir's that same
--    file against a throwaway table, so there is exactly one copy of this
--    logic to keep correct. \ir (not \i): \ir resolves a relative path
--    against the directory of the currently-executing script, whatever the
--    caller's cwd is; plain \i resolves against the caller's cwd instead
--    (even with this file itself opened via an absolute -f path) and would
--    fail to find telemetry-acl-strip.sql the moment `psql -f
--    .../telemetry-schema.sql` is run from any other directory (measured
--    2026-09-04: "No such file or directory", non-fatal without
--    ON_ERROR_STOP, so it can pass silently too).
-- ---------------------------------------------------------------------------
\set strip_tables 'intervu.telemetry_events,intervu.job_heartbeats'
\ir telemetry-acl-strip.sql

-- ---------------------------------------------------------------------------
-- 5. Grants, exactly per spec: INSERT only. No select, no update, no
--    delete. The reaper and the nightly rollup run as `pipeline` (the table
--    owner), never as telemetry_pg — telemetry_pg exists solely to serve
--    the internet-facing ingest path and has no legitimate reason to read,
--    aggregate, or delete anything it wrote.
-- ---------------------------------------------------------------------------
grant usage on schema intervu to telemetry_pg;
grant insert on intervu.telemetry_events to telemetry_pg;
grant usage, select on sequence intervu.telemetry_events_id_seq to telemetry_pg;

-- ---------------------------------------------------------------------------
-- 6. Reaper. Deletes rows past the retention window (default 90 days, per
--    spec §7) and always upserts its own heartbeat — including on a
--    zero-row run, which is exactly the run a silently-dead cron hides
--    behind.
-- ---------------------------------------------------------------------------
create or replace function intervu.reap_telemetry(retain_days int default 90)
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  delete from intervu.telemetry_events
    where received_at < now() - make_interval(days => retain_days);
  get diagnostics deleted_count = row_count;

  insert into intervu.job_heartbeats (job_name, last_run_at, rows_affected, ok)
  values ('reap_telemetry', now(), deleted_count, true)
  on conflict (job_name) do update
    set last_run_at   = excluded.last_run_at,
        rows_affected = excluded.rows_affected,
        ok            = excluded.ok;

  return deleted_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Erasure. `forgetIdentity` (src/lib/identity/forget.ts) must be able to
--    delete one user's ledger rows, and the two obvious ways to let it are
--    both worse than they look:
--
--      * granting DELETE to telemetry_pg hands the internet-facing ingest
--        credential an unconstrained `delete from telemetry_events` — a
--        whole-ledger-wipe primitive on the most attackable surface we have;
--      * giving the web app BATCH_PG_URL hands it `pipeline`, which owns
--        every table in this schema.
--
--    SECURITY DEFINER is the narrow middle: the privilege stays with the
--    owner, and what telemetry_pg gets is not "delete rows" but "erase the
--    rows belonging to one user id". It still holds no SELECT, so even a
--    fully compromised ingest credential cannot read one query string, job
--    id or props blob back out of the ledger.
--
--    Unbatched DELETE here is deliberate and is NOT the reaper's case: this
--    is bounded by one account's own rows inside the 90-day window
--    (thousands), not a global retention sweep over every writer's traffic
--    (millions) — that one batches in scripts/reap-telemetry.ts precisely
--    because it is unbounded. The 30s statement timeout on the calling pool
--    (`getTelemetryForgetPg`, src/lib/pg/pool.ts) is the backstop.
--
--    `search_path` is pinned: an unpinned SECURITY DEFINER function is
--    hijackable by anything the caller can put earlier on the path.
-- ---------------------------------------------------------------------------
create or replace function intervu.forget_telemetry_user(p_user_id text)
returns bigint
language plpgsql
security definer
set search_path = intervu, pg_catalog, pg_temp
as $$
declare
  deleted_count bigint;
begin
  -- A null/blank uid would match no row anyway; refusing it explicitly keeps
  -- a caller bug from ever reaching the table with an unconstrained-looking
  -- predicate.
  if p_user_id is null or p_user_id = '' then
    return 0;
  end if;

  delete from intervu.telemetry_events where user_id = p_user_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Function ownership pin + catalog-driven privilege strip. Same failure
--    §4 closes for tables, for functions: forget_telemetry_user used to get
--    its owner pin and PUBLIC revoke by name (that hand-written block lived
--    right here), while reap_telemetry got neither. Measured on prod
--    2026-09-04: reap_telemetry owned by whichever OS user last applied this
--    file, prosecdef=f, proconfig null, PUBLIC holds EXECUTE. Not
--    exploitable today — reap_telemetry is SECURITY INVOKER, so PUBLIC
--    EXECUTE still hits the table grants and fails closed as telemetry_pg
--    ("permission denied for table telemetry_events") — but it is drift,
--    and a hand-written block only ever covers the function it names: the
--    next function added to this schema would inherit the same gap.
--
--    Loops every function in pg_proc for this schema instead of naming
--    them, same reasoning as §4's aclexplode-driven table strip: a function
--    added here next month is covered by construction.
--
--    Owner is pinned before the ACL/config is touched — same ordering
--    concern as §4.
--
--    Only PUBLIC is revoked, not every grantee. Unlike §4's table strip
--    (where no non-owner grant on telemetry_events/job_heartbeats is ever
--    legitimate), a function here can carry a deliberate, narrow grant —
--    forget_telemetry_user's `grant execute ... to telemetry_pg` below is
--    exactly that, and must survive this loop untouched.
--
--    search_path is pinned only when the function does not already set one,
--    so the block stays idempotent and leaves forget_telemetry_user's own
--    explicit `set search_path` (§7 above) alone rather than fighting it.
--
--    Function identity renders via `p.oid::regprocedure` formatted with %s,
--    NOT %I: regprocedure's output function already runs the result through
--    quote_identifier, so %I would quote it a second time and error on any
--    name that needs quoting. Same bug, same fix, as the %I-on-regrole
--    mistake documented at telemetry-acl-strip.sql:38-42 — that mistake
--    cost this repo a full review cycle on 2026-09-03. Do not revert this.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid,
           format('%s', p.oid::regprocedure) as ident,
           p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'intervu'
  loop
    execute format('alter function %s owner to pipeline', fn.ident);
    execute format('revoke all on function %s from public', fn.ident);

    if not exists (
      select 1 from unnest(coalesce(fn.proconfig, '{}'::text[])) c
      where c like 'search_path=%'
    ) then
      execute format('alter function %s set search_path = intervu, pg_catalog, pg_temp', fn.ident);
    end if;
  end loop;
end
$$;

-- Scoped, deliberate grant — not catalog-driven, because the mechanism above
-- has no way to know which role legitimately needs this one function; that
-- is a per-function business decision (§7's rationale), not a security
-- posture to derive from the catalog.
grant execute on function intervu.forget_telemetry_user(text) to telemetry_pg;
