-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/db/firestore-migration-manifest.ts
-- Regenerate: npx tsx scripts/pg-generate-schema.ts
--
-- Firestore -> Postgres, phase 1 (COPY, never move). Applying this file
-- creates empty tables and touches nothing that already exists; it contains
-- no DROP and no DELETE. Firebase Auth is unaffected — uid remains the key
-- and continues to come from Firebase.
--
-- Every table is: path (Firestore document path) as the primary key, doc
-- (the whole document) as jsonb, and generated columns derived from doc, so
-- an indexed column can never disagree with the document it came from.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "intervu";

CREATE TABLE IF NOT EXISTS "intervu"."agent_clients" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    created_at_ms bigint GENERATED ALWAYS AS ((doc->>'createdAt')::bigint) STORED
);
CREATE INDEX IF NOT EXISTS "agent_clients_created_at_ms_idx" ON "intervu"."agent_clients" ("created_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."agent_codes" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    uid         text GENERATED ALWAYS AS (doc->>'uid') STORED,
    client_id   text GENERATED ALWAYS AS (doc->>'clientId') STORED,
    expires_at_ms bigint GENERATED ALWAYS AS ((doc->>'expiresAt')::bigint) STORED
);
CREATE INDEX IF NOT EXISTS "agent_codes_uid_idx" ON "intervu"."agent_codes" ("uid");
CREATE INDEX IF NOT EXISTS "agent_codes_client_id_idx" ON "intervu"."agent_codes" ("client_id");
CREATE INDEX IF NOT EXISTS "agent_codes_expires_at_ms_idx" ON "intervu"."agent_codes" ("expires_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."agent_credentials" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    token_hash  text GENERATED ALWAYS AS (doc->>'tokenHash') STORED,
    uid         text GENERATED ALWAYS AS (doc->>'uid') STORED,
    client_id   text GENERATED ALWAYS AS (doc->>'clientId') STORED,
    expires_at_ms bigint GENERATED ALWAYS AS ((doc->>'expiresAt')::bigint) STORED,
    revoked_at_ms bigint GENERATED ALWAYS AS ((doc->>'revokedAt')::bigint) STORED
);
CREATE INDEX IF NOT EXISTS "agent_credentials_token_hash_idx" ON "intervu"."agent_credentials" ("token_hash");
CREATE INDEX IF NOT EXISTS "agent_credentials_uid_idx" ON "intervu"."agent_credentials" ("uid");
CREATE INDEX IF NOT EXISTS "agent_credentials_client_id_idx" ON "intervu"."agent_credentials" ("client_id");
CREATE INDEX IF NOT EXISTS "agent_credentials_expires_at_ms_idx" ON "intervu"."agent_credentials" ("expires_at_ms");
CREATE INDEX IF NOT EXISTS "agent_credentials_revoked_at_ms_idx" ON "intervu"."agent_credentials" ("revoked_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."agent_record_budgets" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "intervu"."applications" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    status      text GENERATED ALWAYS AS (doc->>'status') STORED,
    updated_at  text GENERATED ALWAYS AS (doc->>'updated_at') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED,
    job_id      text GENERATED ALWAYS AS (doc->>'job_id') STORED
);
CREATE INDEX IF NOT EXISTS "applications_user_id_idx" ON "intervu"."applications" ("user_id");
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "intervu"."applications" ("status");
CREATE INDEX IF NOT EXISTS "applications_updated_at_idx" ON "intervu"."applications" ("updated_at");
CREATE INDEX IF NOT EXISTS "applications_created_at_idx" ON "intervu"."applications" ("created_at");
CREATE INDEX IF NOT EXISTS "applications_job_id_idx" ON "intervu"."applications" ("job_id");

CREATE TABLE IF NOT EXISTS "intervu"."profiles" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    username    text GENERATED ALWAYS AS (doc->>'username') STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_idx" ON "intervu"."profiles" ("username");

CREATE TABLE IF NOT EXISTS "intervu"."tailored_resumes" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED,
    job_analysis_id text GENERATED ALWAYS AS (doc->>'job_analysis_id') STORED
);
CREATE INDEX IF NOT EXISTS "tailored_resumes_user_id_idx" ON "intervu"."tailored_resumes" ("user_id");
CREATE INDEX IF NOT EXISTS "tailored_resumes_created_at_idx" ON "intervu"."tailored_resumes" ("created_at");
CREATE INDEX IF NOT EXISTS "tailored_resumes_job_analysis_id_idx" ON "intervu"."tailored_resumes" ("job_analysis_id");

CREATE TABLE IF NOT EXISTS "intervu"."job_analyses" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
CREATE INDEX IF NOT EXISTS "job_analyses_user_id_idx" ON "intervu"."job_analyses" ("user_id");
CREATE INDEX IF NOT EXISTS "job_analyses_created_at_idx" ON "intervu"."job_analyses" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."interview_prep_cache" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    cache_key   text GENERATED ALWAYS AS (doc->>'cache_key') STORED,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    expires_at  text GENERATED ALWAYS AS (doc->>'expires_at') STORED
);
CREATE INDEX IF NOT EXISTS "interview_prep_cache_cache_key_idx" ON "intervu"."interview_prep_cache" ("cache_key");
CREATE INDEX IF NOT EXISTS "interview_prep_cache_user_id_idx" ON "intervu"."interview_prep_cache" ("user_id");
CREATE INDEX IF NOT EXISTS "interview_prep_cache_expires_at_idx" ON "intervu"."interview_prep_cache" ("expires_at");

CREATE TABLE IF NOT EXISTS "intervu"."apply_counters" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "intervu"."contact_messages" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    email       text GENERATED ALWAYS AS (doc->>'email') STORED,
    ts          text GENERATED ALWAYS AS (doc->>'ts') STORED
);
CREATE INDEX IF NOT EXISTS "contact_messages_email_idx" ON "intervu"."contact_messages" ("email");
CREATE INDEX IF NOT EXISTS "contact_messages_ts_idx" ON "intervu"."contact_messages" ("ts");

CREATE TABLE IF NOT EXISTS "intervu"."saved_searches" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    uid         text GENERATED ALWAYS AS (split_part(path, '/', 2)) STORED
);
CREATE INDEX IF NOT EXISTS "saved_searches_uid_idx" ON "intervu"."saved_searches" ("uid");

CREATE TABLE IF NOT EXISTS "intervu"."followed_companies" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    uid         text GENERATED ALWAYS AS (split_part(path, '/', 2)) STORED,
    domain      text GENERATED ALWAYS AS (doc->>'domain') STORED
);
CREATE INDEX IF NOT EXISTS "followed_companies_uid_idx" ON "intervu"."followed_companies" ("uid");
CREATE INDEX IF NOT EXISTS "followed_companies_domain_idx" ON "intervu"."followed_companies" ("domain");

CREATE TABLE IF NOT EXISTS "intervu"."email_digest_state" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "intervu"."email_suppressions" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "intervu"."welcome_emails" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    email       text GENERATED ALWAYS AS (doc->>'email') STORED
);
CREATE INDEX IF NOT EXISTS "welcome_emails_email_idx" ON "intervu"."welcome_emails" ("email");

CREATE TABLE IF NOT EXISTS "intervu"."search_events" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    created_at  text GENERATED ALWAYS AS (doc->>'createdAt') STORED,
    expires_at  text GENERATED ALWAYS AS (doc->>'expiresAt') STORED,
    search_id   text GENERATED ALWAYS AS (doc->>'searchId') STORED
);
CREATE INDEX IF NOT EXISTS "search_events_created_at_idx" ON "intervu"."search_events" ("created_at");
CREATE INDEX IF NOT EXISTS "search_events_expires_at_idx" ON "intervu"."search_events" ("expires_at");
CREATE INDEX IF NOT EXISTS "search_events_search_id_idx" ON "intervu"."search_events" ("search_id");

CREATE TABLE IF NOT EXISTS "intervu"."search_opens" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    created_at  text GENERATED ALWAYS AS (doc->>'createdAt') STORED,
    expires_at  text GENERATED ALWAYS AS (doc->>'expiresAt') STORED,
    search_id   text GENERATED ALWAYS AS (doc->>'searchId') STORED,
    job_id      text GENERATED ALWAYS AS (doc->>'jobId') STORED
);
CREATE INDEX IF NOT EXISTS "search_opens_created_at_idx" ON "intervu"."search_opens" ("created_at");
CREATE INDEX IF NOT EXISTS "search_opens_expires_at_idx" ON "intervu"."search_opens" ("expires_at");
CREATE INDEX IF NOT EXISTS "search_opens_search_id_idx" ON "intervu"."search_opens" ("search_id");
CREATE INDEX IF NOT EXISTS "search_opens_job_id_idx" ON "intervu"."search_opens" ("job_id");

CREATE TABLE IF NOT EXISTS "intervu"."app_config" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "intervu"."market_stats_daily" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    date        text GENERATED ALWAYS AS (doc->>'date') STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS "market_stats_daily_date_idx" ON "intervu"."market_stats_daily" ("date");

CREATE TABLE IF NOT EXISTS "intervu"."viewer_sessions" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    uid         text GENERATED ALWAYS AS (doc->>'uid') STORED,
    expires_at_ms bigint GENERATED ALWAYS AS ((doc->>'expiresAt')::bigint) STORED
);
CREATE INDEX IF NOT EXISTS "viewer_sessions_uid_idx" ON "intervu"."viewer_sessions" ("uid");
CREATE INDEX IF NOT EXISTS "viewer_sessions_expires_at_ms_idx" ON "intervu"."viewer_sessions" ("expires_at_ms");

-- Read/write access for the app. Reuses the roles the db-box already has
-- (deploy/db-box/setup.sh) rather than minting another: service_role is the
-- privileged writer, pipeline is the batch role. Default privileges cover
-- tables added by a later regeneration of this file.
GRANT USAGE ON SCHEMA "intervu" TO service_role, pipeline;
GRANT ALL ON ALL TABLES IN SCHEMA "intervu" TO service_role, pipeline;
ALTER DEFAULT PRIVILEGES IN SCHEMA "intervu"
    GRANT ALL ON TABLES TO service_role, pipeline;

COMMIT;
