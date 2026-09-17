-- Apply via the Supabase SQL editor (or psql against the project's direct
-- connection) as `postgres`. Requires PG13+ (gen_random_uuid, available by
-- default on Supabase). NEVER applied by CI or app code. Tables are
-- namespaced under the `intervu` schema, so this DDL is safe to run in an
-- existing Supabase project alongside its own tables.

CREATE SCHEMA IF NOT EXISTS intervu;

CREATE TABLE IF NOT EXISTS intervu.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_verified_at timestamptz,
  contact_token uuid NOT NULL DEFAULT gen_random_uuid(),
  firebase_uid text,
  google_sub text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_email_lower_key ON intervu.identities (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS identities_contact_token_key ON intervu.identities (contact_token);
CREATE UNIQUE INDEX IF NOT EXISTS identities_firebase_uid_key ON intervu.identities (firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS identities_google_sub_key ON intervu.identities (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS intervu.auth_tokens (
  token_hash bytea PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','login','verify_search_alert')),
  redirect_path text NOT NULL DEFAULT '/',
  request_ip text,
  intent_name text,
  intent_href text,
  intent_search_hash text,
  intent_distinct_id text,
  intent_analytics jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_tokens_identity_created_idx ON intervu.auth_tokens (identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS intervu.email_follows (
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  company_domain text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  PRIMARY KEY (identity_id, company_domain)
);

CREATE TABLE IF NOT EXISTS intervu.email_saved_searches (
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  search_hash text NOT NULL,
  name text NOT NULL,
  href text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  PRIMARY KEY (identity_id, search_hash)
);

-- Daily abuse brake on AI resume parsing (src/lib/resume/parse-rate-limit.ts),
-- keyed by the AUTHENTICATED app user's stable id (WorkOS externalId/id, the
-- `uid` getServerUser() returns) — NOT a row in intervu.identities above,
-- which is the anonymous email-follow identity, a different concern.
CREATE TABLE IF NOT EXISTS intervu.resume_parse_counters (
  user_uid text NOT NULL,
  window_date date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_uid, window_date)
);

-- D6 (Leg E) — per-credential DAILY company-read budget for the MCP
-- get_company/get_company_timeline/search_companies tools. Keyed by
-- credential_id (an agent_credentials doc id, not an identity), one row per
-- credential; window_start is a UTC-midnight timestamp — see
-- src/lib/agent/company-read-budget.ts for the read-decide-write cycle that
-- rolls this over daily.
CREATE TABLE IF NOT EXISTS intervu.company_read_budgets (
  credential_id text PRIMARY KEY,
  used integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent send log for one-off marketing/product-update campaigns
-- (scripts/send-marketing-update.ts, src/lib/marketing/send-log.ts). Keyed
-- by (campaign, user_id) — the WorkOS uid (externalId || id, see
-- toServerUser in workos-identity.ts) — so re-running a campaign's send
-- script is a no-op for anyone it already reached rather than a duplicate
-- send. Suppression (opt-out) is NOT tracked here — that stays the
-- existing Firestore `email_suppressions` collection (src/lib/email/
-- suppression.ts), scoped by the "marketing_update" EmailKind, same as
-- every other suppressible email kind. This table only ever answers "did
-- THIS campaign already reach this user."
CREATE TABLE IF NOT EXISTS intervu.marketing_sends (
  campaign text NOT NULL,
  user_id text NOT NULL,
  email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  message_id text,
  PRIMARY KEY (campaign, user_id)
);

-- ROLE SETUP — run manually as postgres, password set interactively, never committed:
--   CREATE ROLE intervu_web LOGIN PASSWORD '<set interactively>';
-- Schema/table grants for intervu_web are executable SQL at the end of this
-- file, not a comment — re-applying this whole file (after creating the role
-- above, or after adding a new intervu.* table anywhere above) keeps grants
-- current without anyone having to remember a manual GRANT step.

-- Existing deployments: extend auth_tokens for verify_search_alert intent columns.
ALTER TABLE intervu.auth_tokens ADD COLUMN IF NOT EXISTS intent_name text;
ALTER TABLE intervu.auth_tokens ADD COLUMN IF NOT EXISTS intent_href text;
ALTER TABLE intervu.auth_tokens ADD COLUMN IF NOT EXISTS intent_search_hash text;
-- Existing deployments: round-trip the submitter's PostHog distinct_id and
-- the search-alert event payload (surface/query_length/filter_count/
-- has_results) from submit through to verify, so `search_alert_verified`
-- (captured server-side — see src/lib/analytics/server-capture.ts) can carry
-- the same properties `search_alert_submitted` did, without re-deriving them
-- from a bare token-consume request that has no live search context.
ALTER TABLE intervu.auth_tokens ADD COLUMN IF NOT EXISTS intent_distinct_id text;
ALTER TABLE intervu.auth_tokens ADD COLUMN IF NOT EXISTS intent_analytics jsonb;
ALTER TABLE intervu.auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_purpose_check;
ALTER TABLE intervu.auth_tokens ADD CONSTRAINT auth_tokens_purpose_check
  CHECK (purpose IN ('verify_email','login','verify_search_alert'));
--
-- Through the Supavisor transaction pooler (port 6543) the connection
-- username is `intervu_web.<project-ref>`, not the bare role name. The app
-- is txn-pooler-safe because every transaction opens with
-- `SET LOCAL statement_timeout` (see src/lib/pg/pool.ts) rather than a
-- session-level SET, which would otherwise leak onto a pooled connection
-- reused by an unrelated request.
--
-- INTERVU_PG_URL should point at the pooled connection string with
-- `?sslmode=require` appended. If node-postgres rejects the certificate
-- chain, fall back to `?sslmode=no-verify` or supply the project's CA
-- certificate explicitly.
--
-- Default-deny: do NOT add the `intervu` schema to PostgREST "Exposed
-- schemas" in the Supabase dashboard. These tables are reached only through
-- the app's own pg pool, never through the Supabase REST/GraphQL surface.

-- Grants for intervu_web — idempotent and re-runnable, and enumerates no
-- table names, so a table added anywhere above this point is covered by
-- ALL TABLES IN SCHEMA immediately, and one added later (via a fresh
-- CREATE TABLE run as postgres) is covered by ALTER DEFAULT PRIVILEGES
-- without this file needing another edit. Guarded on pg_roles so this file
-- can be applied before intervu_web exists (e.g. first-time project setup)
-- without erroring; re-run it after creating the role to pick up the grants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intervu_web') THEN
    GRANT USAGE ON SCHEMA intervu TO intervu_web;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA intervu TO intervu_web;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA intervu
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO intervu_web;
  END IF;
END $$;
