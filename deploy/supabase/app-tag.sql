-- public.has_app(app) — RLS helper for the shared intervu/subspace
-- auth.users table.
--
-- REVIEW-ONLY FILE. Not executed by any script or CI job. Nobody has run
-- this against Postgres or Supabase as part of authoring it. Apply it
-- deliberately (e.g. via a migration or `supabase db push`) when the
-- product-tagging cutover is actually ready.
--
-- What it does: both intervu and subspace tag an account's product access
-- as an array of slugs at app_metadata.apps (see
-- src/lib/auth/app-tag.ts — appsFromClaims/hasApp). This function lifts
-- that same membership check into SQL so RLS policies can read
--   USING (public.has_app('subspace'))
-- instead of naming tables/products one by one in every policy — new
-- product-scoped tables get covered by writing the same one-line USING
-- clause, not by extending a hand-maintained allowlist.
--
-- Null-safe / fail-closed: `auth.jwt()` is NULL for an unauthenticated
-- (anon) request, so `auth.jwt() -> 'app_metadata' -> 'apps'` is NULL, the
-- `?` (jsonb "does this array contain this string") test on a NULL operand
-- is NULL, and `coalesce(..., false)` turns that NULL into `false` —
-- an anonymous or tagless caller is denied, never defaulted to allowed.
-- Note `?` matches a JSON array element or a JSON *scalar string* equal to
-- `app`, so this also honors the legacy scalar `apps` form that
-- appsFromClaims() tolerates on read.
--
-- security invoker (not definer): runs with the calling role's privileges,
-- so it carries no elevated access of its own — it only reads the caller's
-- own JWT claims, which is all it needs.
create or replace function public.has_app(app text)
returns boolean
language sql
stable
security invoker
as $$
    select coalesce(auth.jwt() -> 'app_metadata' -> 'apps' ? app, false)
$$;
