-- Telemetry ledger table plus its least-privilege ingest role.
--
-- Companion to deploy/db-box/agent-credentials-role.sql: same shape (DDL and
-- GRANTs in one file so they cannot drift), same reasoning extended to a
-- second internet-facing path — a role scoped to exactly what its request
-- path needs, nothing else on the schema.
--
-- Run manually against the box, as a superuser or the schema-owning role
-- (`pipeline`), top to bottom. Idempotent: every statement is safe to
-- re-run. Not applied by CI or app code.

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
-- 2. Ingest role. LOGIN, no password set here — set one out of band with
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
-- 3. Corrective revoke. `intervu.telemetry_events` carries acl agent_pg=arwd
--    on production TODAY, and that grant should not exist: agent_pg serves
--    the internet-facing per-request bearer-token path
--    (deploy/db-box/agent-credentials-role.sql:11-25 keeps it deliberately
--    narrow to intervu.agent_credentials alone), so a leaked agent
--    credential must never be able to read or delete the behavioural
--    ledger. This revoke is corrective, not preventative — undoing a grant
--    that was already made, not guarding against one that might be.
-- ---------------------------------------------------------------------------
revoke all on intervu.telemetry_events from agent_pg;

-- ---------------------------------------------------------------------------
-- 4. Grants, exactly per spec: INSERT only. No select, no update, no
--    delete. The reaper and the nightly rollup run as `pipeline` (the table
--    owner), never as telemetry_pg — telemetry_pg exists solely to serve
--    the internet-facing ingest path and has no legitimate reason to read,
--    aggregate, or delete anything it wrote.
-- ---------------------------------------------------------------------------
grant usage on schema intervu to telemetry_pg;
grant insert on intervu.telemetry_events to telemetry_pg;
grant usage, select on sequence intervu.telemetry_events_id_seq to telemetry_pg;

-- ---------------------------------------------------------------------------
-- 5. Heartbeat table. One row per named job. A job that cannot prove it ran
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

-- Ownership is pinned rather than left to whoever ran this file: under
-- SECURITY DEFINER the owner IS the privilege, so a run as superuser would
-- otherwise silently install a far stronger function than a run as pipeline.
alter function intervu.forget_telemetry_user(text) owner to pipeline;

revoke all on function intervu.forget_telemetry_user(text) from public;
grant execute on function intervu.forget_telemetry_user(text) to telemetry_pg;
