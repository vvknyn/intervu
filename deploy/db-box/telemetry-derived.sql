\set ON_ERROR_STOP on
-- ^ Load-bearing, not boilerplate — same reasoning as telemetry-schema.sql's
--   line 1: without it, a `raise exception` below prints ERROR but psql
--   keeps going and exits 0, so the two preconditions below would stop
--   protecting anything.

-- Telemetry DERIVED layer — Lane F (SPEC-2-PROFILES.md).
-- Rebuilt nightly from intervu.telemetry_events (owned by
-- deploy/db-box/telemetry-schema.sql — do not edit that file from here).
-- Every table here is a CACHE: safe to drop and regenerate from the raw
-- ledger. Idempotent throughout (`if not exists`); apply any number of times.
--
-- WHY THIS FILE CREATES TABLES AS `pipeline` INSTEAD OF WHOEVER INVOKES IT:
-- measured on the box 2026-09-04 — pg_default_acl on schema intervu carries
-- exactly one rule (defaclrole=postgres, objtype=r) that grants both
-- service_role and pipeline arwdDxtm on every table `postgres` creates in
-- this schema; zero rules anywhere in the cluster are keyed to
-- defaclrole=pipeline. Proven in a rolled-back transaction: `create table`
-- run as postgres picks up service_role=arwdDxtm on the new table; the
-- identical `create table` run after `set role pipeline` comes out with
-- relowner=pipeline and relacl=NULL (owner-only, no foreign grants at all).
-- apply-telemetry-migration.sh is documented to run `sudo -u postgres`, so
-- without this switch these tables would land with service_role able to
-- read/write every user-profile row. Switching role here — rather than
-- documenting "always run this as pipeline" — makes the resulting ACL
-- posture a property of this file, independent of which OS user runs it.
--
-- Owned by `pipeline` (also owns intervu.telemetry_events per SPEC.md §3);
-- never touched by `telemetry_pg` (insert-only on the raw ledger, no read
-- access here).

-- Runs as the invoking (super)user, before the role switch below: a fresh
-- box's `pipeline` role has USAGE+CREATE on schema intervu (measured) but
-- may not have CREATE on the database itself, which is what creating a
-- schema that doesn't exist yet would require.
create schema if not exists intervu;

set role pipeline;

-- Two catalog-driven preconditions. Either failure means the ACL reasoning
-- above no longer holds for this run, so every `create table` below must
-- not proceed.
do $$
begin
  if current_user <> 'pipeline' then
    raise exception 'expected current_user = pipeline after "set role pipeline", found %. If the role switch silently no-op''d, every table below would be created under the wrong owner and pick up schema intervu''s postgres-keyed default ACL (service_role+pipeline arwdDxtm) instead of no foreign grants at all.', current_user;
  end if;
end
$$;

do $$
declare
  found_rule regrole;
begin
  select defaclrole into found_rule
  from pg_default_acl
  where defaclrole = 'pipeline'::regrole
  limit 1;

  if found_rule is not null then
    raise exception 'pg_default_acl now has a rule keyed to defaclrole = % — measured 2026-09-04, this cluster had zero such rows. That absence is the entire reason this file creates tables as pipeline instead of postgres: a rule here means creating as pipeline would itself confer foreign grants, and the tables below must not be created until this is re-investigated.', found_rule;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- job_features — posting STRUCTURE, one row per job_id. Recomputed
-- whenever the posting changes. Every column is a fact read directly off
-- the posting text/metadata — never an inference. NULL means "not stated
-- in the posting" and is itself a finding: never coalesced to 0 or false.
-- ---------------------------------------------------------------------
create table if not exists intervu.job_features (
  job_id                     text        primary key,
  computed_at                timestamptz not null default now(),

  -- structural. NULL (not 0) when the posting body is still a truncated
  -- teaser (src/lib/jobs/fill-description.ts:descriptionNeedsFill) — a
  -- count off a stub is a count of the stub, not the posting.
  description_chars         integer,
  bullet_count               integer,
  paragraph_count            integer,
  section_count              integer,
  requirement_count          integer,
  responsibility_count       integer,
  -- title is always present on a job (PublicJob.title: string) so these two
  -- are the only structural columns that are ever knowable.
  title_chars                 integer     not null,
  title_word_count           integer     not null,

  -- disclosure. has_salary is knowable independent of the description body
  -- (it reads structured salary_min/salary_max, not text), so it alone is
  -- NOT NULL among the disclosure flags. The rest read the description text
  -- and are NULL under the same teaser condition as the structural block.
  has_salary                 boolean     not null,
  salary_min                 numeric,
  salary_max                 numeric,
  salary_span_pct            numeric,
  has_equity_mention         boolean,
  has_benefits_section       boolean,
  benefit_count              integer,
  has_visa_statement         boolean,
  has_eeo_boilerplate        boolean,

  -- requirements
  years_experience_min       numeric,
  degree_required            boolean,
  degree_level               text,
  named_tech_count           integer,
  has_nice_to_have_section   boolean,

  -- shape of the role. is_remote/is_hybrid/is_onsite are NULL exactly when
  -- the upstream work_type is itself "unknown" — a genuinely unstated fact,
  -- not a text-scan result, so it is gated separately from the block above.
  seniority_word              text,
  is_remote                  boolean,
  is_hybrid                  boolean,
  is_onsite                  boolean,
  employment_type            text,

  -- process. apply_method always resolves to a value (an ats provider name
  -- or the literal 'direct'), so it alone is NOT NULL; ats_provider is NULL
  -- exactly when apply_method is 'direct'.
  apply_method                text        not null,
  screening_question_count   integer,
  ats_provider                text,

  -- freshness. first_seen_at mirrors PublicJob.first_seen_at, which the wire
  -- type allows to be null, so it cannot be NOT NULL here either.
  first_seen_at               timestamptz,
  posted_at                   timestamptz,
  -- repost_count requires matching this posting across DIFFERENT job_ids
  -- over time (a repost is a new listing of the same role) — something a
  -- single-job snapshot cannot determine. Left NULL (not 0) until a
  -- cross-job matching pass exists; fabricating 0 would be a lying default.
  repost_count                integer,
  days_open                   integer
);

-- ---------------------------------------------------------------------
-- job_daily / company_daily / query_daily — one row per (key, day).
-- Each nightly run recomputes ONE day's numbers from raw events and
-- REPLACES that day's row (upsert on the natural key below); it never
-- increments a stored counter, so a retried cron cannot double a count.
-- ---------------------------------------------------------------------
create table if not exists intervu.job_daily (
  job_id           text        not null,
  day              date        not null,
  impressions      integer     not null default 0,
  clicks           integer     not null default 0,
  applies          integer     not null default 0,
  saves            integer     not null default 0,
  dismissals       integer     not null default 0,
  median_dwell_ms  integer,
  mean_position    numeric,
  computed_at      timestamptz not null default now(),
  primary key (job_id, day)
);

create table if not exists intervu.company_daily (
  company_domain   text        not null,
  day              date        not null,
  impressions      integer     not null default 0,
  clicks           integer     not null default 0,
  applies          integer     not null default 0,
  saves            integer     not null default 0,
  dismissals       integer     not null default 0,
  median_dwell_ms  integer,
  mean_position    numeric,
  computed_at      timestamptz not null default now(),
  primary key (company_domain, day)
);

create table if not exists intervu.query_daily (
  query_normalized     text        not null,
  day                  date        not null,
  searches             integer     not null default 0,
  zero_result_count    integer     not null default 0,
  click_through_count  integer     not null default 0,
  refinement_count     integer     not null default 0,
  computed_at          timestamptz not null default now(),
  primary key (query_normalized, day)
);

-- ---------------------------------------------------------------------
-- feature_outcomes — THE analysis table. Keyed on (feature, bucket,
-- position) exactly, per SPEC-2 §5: position is never collapsed into the
-- key. Each rollup recomputes the full trailing window available in the
-- raw ledger (bounded by the 90-day raw retention) and REPLACES each
-- row's counts outright — never `count = count + n` — so a retried cron
-- reproduces, not doubles, the same numbers.
-- ---------------------------------------------------------------------
create table if not exists intervu.feature_outcomes (
  feature      text        not null,
  bucket       text        not null,
  position     integer     not null,
  impressions  integer     not null default 0,
  clicks       integer     not null default 0,
  applies      integer     not null default 0,
  computed_at  timestamptz not null default now(),
  primary key (feature, bucket, position)
);

-- job_heartbeats (one current-state row per job_name, upserted every run —
-- SPEC.md §7) is owned by deploy/db-box/telemetry-schema.sql, not this file:
-- do not redefine it here. `build-job-features` and `roll-up-telemetry`
-- (scripts/) write to it through the shared `src/lib/telemetry/heartbeat.ts`
-- helper, which upserts on the `job_name` primary key exactly like that
-- file's own `reap_telemetry()` does.

reset role;
