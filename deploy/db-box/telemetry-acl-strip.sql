-- Catalog-driven ownership-pin + privilege-strip loop. SINGLE SOURCE OF
-- TRUTH: telemetry-schema.sql section 4 \i's this file against the real
-- tables; apply-telemetry-migration.sh's preflight self-test \i's it again
-- against a throwaway table before the real migration is allowed to run.
-- Do not copy this loop anywhere else — see telemetry-schema.sql section 4
-- for the full rationale (owner-then-strip ordering, why grantees come off
-- aclexplode(relacl) instead of a hardcoded role list).
--
-- Caller must \set strip_tables to a comma-separated list of schema-
-- qualified table names (no braces, no quoting) before \i-ing this file:
--   \set strip_tables 'intervu.telemetry_events,intervu.job_heartbeats'
--
-- The value crosses into the do-block via a session GUC, not a bare
-- :'strip_tables' reference inside the do $$ ... $$ body — psql's variable
-- interpolation does not reach inside dollar-quoted (or single-quoted)
-- strings, so a reference placed there is never substituted at all and
-- reaches the server as literal, unparseable text (measured 2026-09-04).
select set_config('acl_strip.tables', :'strip_tables', false);

do $$
declare
  tbl_name text;
  tbl_oid  oid;
  g        oid;
begin
  foreach tbl_name in array string_to_array(current_setting('acl_strip.tables'), ',')
  loop
    execute format('alter table %s owner to pipeline', tbl_name);
    tbl_oid := tbl_name::regclass;
    for g in
      select distinct a.grantee
      from pg_class c, aclexplode(c.relacl) a
      where c.oid = tbl_oid and a.grantee <> c.relowner
    loop
      if g = 0 then
        execute format('revoke all on %s from public', tbl_name);
      else
        -- %s, NOT %I: g::regrole::text is already quote_identifier'd by
        -- regrole's own output function (it has to round-trip through SQL
        -- for names like `"Weird Role"` or reserved words). %I quotes a
        -- SECOND time, turning `"Weird Role"` into `"""Weird Role"""` and
        -- erroring `role ""Weird Role"" does not exist`. Do not revert this.
        execute format('revoke all on %s from %s', tbl_name, g::regrole::text);
      end if;
    end loop;
  end loop;
end
$$;
