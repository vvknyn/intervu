-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/db/firestore-migration-manifest.ts
-- Regenerate: npx tsx scripts/pg-generate-schema.ts
--
-- Firestore -> Postgres, phase 1 (COPY, never move). Applying this file
-- creates empty tables and touches nothing that already exists; it contains
-- no DROP and no DELETE. Firebase Auth is unaffected — uid remains the key
-- and continues to come from Firebase.
--
-- Every table is: path (Firestore document path) as the primary key, sealed
-- (the whole document, AES-256-GCM), doc (only the lookup fields that may
-- stay readable, src/lib/db/docstore/layout.ts) as jsonb, and generated
-- columns derived from doc.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "intervu";

CREATE TABLE IF NOT EXISTS "intervu"."agent_clients" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    created_at_ms bigint GENERATED ALWAYS AS ((doc->>'createdAt')::bigint) STORED
);
ALTER TABLE "intervu"."agent_clients" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "agent_clients_created_at_ms_idx" ON "intervu"."agent_clients" ("created_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."agent_codes" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    uid         text GENERATED ALWAYS AS (doc->>'uid') STORED,
    client_id   text GENERATED ALWAYS AS (doc->>'clientId') STORED,
    expires_at_ms bigint GENERATED ALWAYS AS ((doc->>'expiresAt')::bigint) STORED
);
ALTER TABLE "intervu"."agent_codes" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "agent_codes_uid_idx" ON "intervu"."agent_codes" ("uid");
CREATE INDEX IF NOT EXISTS "agent_codes_client_id_idx" ON "intervu"."agent_codes" ("client_id");
CREATE INDEX IF NOT EXISTS "agent_codes_expires_at_ms_idx" ON "intervu"."agent_codes" ("expires_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."agent_credentials" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    token_hash  text GENERATED ALWAYS AS (doc->>'tokenHash') STORED,
    uid         text GENERATED ALWAYS AS (doc->>'uid') STORED,
    client_id   text GENERATED ALWAYS AS (doc->>'clientId') STORED,
    expires_at_ms bigint GENERATED ALWAYS AS ((doc->>'expiresAt')::bigint) STORED,
    revoked_at_ms bigint GENERATED ALWAYS AS ((doc->>'revokedAt')::bigint) STORED
);
ALTER TABLE "intervu"."agent_credentials" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "agent_credentials_token_hash_idx" ON "intervu"."agent_credentials" ("token_hash");
CREATE INDEX IF NOT EXISTS "agent_credentials_uid_idx" ON "intervu"."agent_credentials" ("uid");
CREATE INDEX IF NOT EXISTS "agent_credentials_client_id_idx" ON "intervu"."agent_credentials" ("client_id");
CREATE INDEX IF NOT EXISTS "agent_credentials_expires_at_ms_idx" ON "intervu"."agent_credentials" ("expires_at_ms");
CREATE INDEX IF NOT EXISTS "agent_credentials_revoked_at_ms_idx" ON "intervu"."agent_credentials" ("revoked_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."agent_record_budgets" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text
);
ALTER TABLE "intervu"."agent_record_budgets" ADD COLUMN IF NOT EXISTS sealed text;

CREATE TABLE IF NOT EXISTS "intervu"."applications" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    status      text GENERATED ALWAYS AS (doc->>'status') STORED,
    updated_at  text GENERATED ALWAYS AS (doc->>'updated_at') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED,
    job_id      text GENERATED ALWAYS AS (doc->>'job_id') STORED
);
ALTER TABLE "intervu"."applications" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "applications_user_id_idx" ON "intervu"."applications" ("user_id");
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "intervu"."applications" ("status");
CREATE INDEX IF NOT EXISTS "applications_updated_at_idx" ON "intervu"."applications" ("updated_at");
CREATE INDEX IF NOT EXISTS "applications_created_at_idx" ON "intervu"."applications" ("created_at");
CREATE INDEX IF NOT EXISTS "applications_job_id_idx" ON "intervu"."applications" ("job_id");

CREATE TABLE IF NOT EXISTS "intervu"."profiles" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    username    text GENERATED ALWAYS AS (doc->>'username') STORED
);
ALTER TABLE "intervu"."profiles" ADD COLUMN IF NOT EXISTS sealed text;
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_idx" ON "intervu"."profiles" ("username");

CREATE TABLE IF NOT EXISTS "intervu"."tailored_resumes" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED,
    job_analysis_id text GENERATED ALWAYS AS (doc->>'job_analysis_id') STORED
);
ALTER TABLE "intervu"."tailored_resumes" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "tailored_resumes_user_id_idx" ON "intervu"."tailored_resumes" ("user_id");
CREATE INDEX IF NOT EXISTS "tailored_resumes_created_at_idx" ON "intervu"."tailored_resumes" ("created_at");
CREATE INDEX IF NOT EXISTS "tailored_resumes_job_analysis_id_idx" ON "intervu"."tailored_resumes" ("job_analysis_id");

CREATE TABLE IF NOT EXISTS "intervu"."resume_history" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    uid         text GENERATED ALWAYS AS (split_part(path, '/', 2)) STORED,
    saved_at    text GENERATED ALWAYS AS (doc->>'saved_at') STORED
);
ALTER TABLE "intervu"."resume_history" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "resume_history_uid_idx" ON "intervu"."resume_history" ("uid");
CREATE INDEX IF NOT EXISTS "resume_history_saved_at_idx" ON "intervu"."resume_history" ("saved_at");

CREATE TABLE IF NOT EXISTS "intervu"."job_analyses" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."job_analyses" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "job_analyses_user_id_idx" ON "intervu"."job_analyses" ("user_id");
CREATE INDEX IF NOT EXISTS "job_analyses_created_at_idx" ON "intervu"."job_analyses" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."interview_prep_cache" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    cache_key   text GENERATED ALWAYS AS (doc->>'cache_key') STORED,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    expires_at  text GENERATED ALWAYS AS (doc->>'expires_at') STORED
);
ALTER TABLE "intervu"."interview_prep_cache" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "interview_prep_cache_cache_key_idx" ON "intervu"."interview_prep_cache" ("cache_key");
CREATE INDEX IF NOT EXISTS "interview_prep_cache_user_id_idx" ON "intervu"."interview_prep_cache" ("user_id");
CREATE INDEX IF NOT EXISTS "interview_prep_cache_expires_at_idx" ON "intervu"."interview_prep_cache" ("expires_at");

CREATE TABLE IF NOT EXISTS "intervu"."apply_counters" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text
);
ALTER TABLE "intervu"."apply_counters" ADD COLUMN IF NOT EXISTS sealed text;

CREATE TABLE IF NOT EXISTS "intervu"."contact_messages" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    email       text GENERATED ALWAYS AS (doc->>'email') STORED,
    ts          text GENERATED ALWAYS AS (doc->>'ts') STORED
);
ALTER TABLE "intervu"."contact_messages" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "contact_messages_email_idx" ON "intervu"."contact_messages" ("email");
CREATE INDEX IF NOT EXISTS "contact_messages_ts_idx" ON "intervu"."contact_messages" ("ts");

CREATE TABLE IF NOT EXISTS "intervu"."stories" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."stories" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "stories_user_id_idx" ON "intervu"."stories" ("user_id");
CREATE INDEX IF NOT EXISTS "stories_created_at_idx" ON "intervu"."stories" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."sources" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."sources" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "sources_user_id_idx" ON "intervu"."sources" ("user_id");
CREATE INDEX IF NOT EXISTS "sources_created_at_idx" ON "intervu"."sources" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."favorite_questions" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."favorite_questions" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "favorite_questions_user_id_idx" ON "intervu"."favorite_questions" ("user_id");
CREATE INDEX IF NOT EXISTS "favorite_questions_created_at_idx" ON "intervu"."favorite_questions" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."interview_questions" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    application_id text GENERATED ALWAYS AS (doc->>'application_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."interview_questions" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "interview_questions_user_id_idx" ON "intervu"."interview_questions" ("user_id");
CREATE INDEX IF NOT EXISTS "interview_questions_application_id_idx" ON "intervu"."interview_questions" ("application_id");
CREATE INDEX IF NOT EXISTS "interview_questions_created_at_idx" ON "intervu"."interview_questions" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."feedback" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."feedback" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "feedback_user_id_idx" ON "intervu"."feedback" ("user_id");
CREATE INDEX IF NOT EXISTS "feedback_created_at_idx" ON "intervu"."feedback" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."connect_waitlist" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    email       text GENERATED ALWAYS AS (doc->>'email') STORED,
    client      text GENERATED ALWAYS AS (doc->>'client') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."connect_waitlist" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "connect_waitlist_email_idx" ON "intervu"."connect_waitlist" ("email");
CREATE INDEX IF NOT EXISTS "connect_waitlist_client_idx" ON "intervu"."connect_waitlist" ("client");
CREATE INDEX IF NOT EXISTS "connect_waitlist_created_at_idx" ON "intervu"."connect_waitlist" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."founding_waitlist" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    email       text GENERATED ALWAYS AS (doc->>'email') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'created_at') STORED
);
ALTER TABLE "intervu"."founding_waitlist" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "founding_waitlist_email_idx" ON "intervu"."founding_waitlist" ("email");
CREATE INDEX IF NOT EXISTS "founding_waitlist_created_at_idx" ON "intervu"."founding_waitlist" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."saved_searches" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    uid         text GENERATED ALWAYS AS (split_part(path, '/', 2)) STORED
);
ALTER TABLE "intervu"."saved_searches" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "saved_searches_uid_idx" ON "intervu"."saved_searches" ("uid");

CREATE TABLE IF NOT EXISTS "intervu"."followed_companies" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    uid         text GENERATED ALWAYS AS (split_part(path, '/', 2)) STORED,
    domain      text GENERATED ALWAYS AS (doc->>'domain') STORED
);
ALTER TABLE "intervu"."followed_companies" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "followed_companies_uid_idx" ON "intervu"."followed_companies" ("uid");
CREATE INDEX IF NOT EXISTS "followed_companies_domain_idx" ON "intervu"."followed_companies" ("domain");

CREATE TABLE IF NOT EXISTS "intervu"."email_digest_state" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text
);
ALTER TABLE "intervu"."email_digest_state" ADD COLUMN IF NOT EXISTS sealed text;

CREATE TABLE IF NOT EXISTS "intervu"."email_suppressions" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text
);
ALTER TABLE "intervu"."email_suppressions" ADD COLUMN IF NOT EXISTS sealed text;

CREATE TABLE IF NOT EXISTS "intervu"."welcome_emails" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    email       text GENERATED ALWAYS AS (doc->>'email') STORED
);
ALTER TABLE "intervu"."welcome_emails" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "welcome_emails_email_idx" ON "intervu"."welcome_emails" ("email");

CREATE TABLE IF NOT EXISTS "intervu"."search_events" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    created_at  text GENERATED ALWAYS AS (doc->>'createdAt') STORED,
    expires_at  text GENERATED ALWAYS AS (doc->>'expiresAt') STORED,
    search_id   text GENERATED ALWAYS AS (doc->>'searchId') STORED
);
ALTER TABLE "intervu"."search_events" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "search_events_created_at_idx" ON "intervu"."search_events" ("created_at");
CREATE INDEX IF NOT EXISTS "search_events_expires_at_idx" ON "intervu"."search_events" ("expires_at");
CREATE INDEX IF NOT EXISTS "search_events_search_id_idx" ON "intervu"."search_events" ("search_id");

CREATE TABLE IF NOT EXISTS "intervu"."search_opens" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    created_at  text GENERATED ALWAYS AS (doc->>'createdAt') STORED,
    expires_at  text GENERATED ALWAYS AS (doc->>'expiresAt') STORED,
    search_id   text GENERATED ALWAYS AS (doc->>'searchId') STORED,
    job_id      text GENERATED ALWAYS AS (doc->>'jobId') STORED
);
ALTER TABLE "intervu"."search_opens" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "search_opens_created_at_idx" ON "intervu"."search_opens" ("created_at");
CREATE INDEX IF NOT EXISTS "search_opens_expires_at_idx" ON "intervu"."search_opens" ("expires_at");
CREATE INDEX IF NOT EXISTS "search_opens_search_id_idx" ON "intervu"."search_opens" ("search_id");
CREATE INDEX IF NOT EXISTS "search_opens_job_id_idx" ON "intervu"."search_opens" ("job_id");

CREATE TABLE IF NOT EXISTS "intervu"."app_config" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text
);
ALTER TABLE "intervu"."app_config" ADD COLUMN IF NOT EXISTS sealed text;

CREATE TABLE IF NOT EXISTS "intervu"."market_stats_daily" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    date        text GENERATED ALWAYS AS (doc->>'date') STORED
);
ALTER TABLE "intervu"."market_stats_daily" ADD COLUMN IF NOT EXISTS sealed text;
CREATE UNIQUE INDEX IF NOT EXISTS "market_stats_daily_date_idx" ON "intervu"."market_stats_daily" ("date");

CREATE TABLE IF NOT EXISTS "intervu"."viewer_sessions" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    uid         text GENERATED ALWAYS AS (doc->>'uid') STORED,
    expires_at_ms bigint GENERATED ALWAYS AS ((doc->>'expiresAt')::bigint) STORED
);
ALTER TABLE "intervu"."viewer_sessions" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "viewer_sessions_uid_idx" ON "intervu"."viewer_sessions" ("uid");
CREATE INDEX IF NOT EXISTS "viewer_sessions_expires_at_ms_idx" ON "intervu"."viewer_sessions" ("expires_at_ms");

CREATE TABLE IF NOT EXISTS "intervu"."job_views" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    user_id     text GENERATED ALWAYS AS (doc->>'user_id') STORED
);
ALTER TABLE "intervu"."job_views" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "job_views_user_id_idx" ON "intervu"."job_views" ("user_id");

CREATE TABLE IF NOT EXISTS "intervu"."follow_funnel_events" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    step        text GENERATED ALWAYS AS (doc->>'step') STORED,
    created_at  text GENERATED ALWAYS AS (doc->>'createdAt') STORED
);
ALTER TABLE "intervu"."follow_funnel_events" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "follow_funnel_events_step_idx" ON "intervu"."follow_funnel_events" ("step");
CREATE INDEX IF NOT EXISTS "follow_funnel_events_created_at_idx" ON "intervu"."follow_funnel_events" ("created_at");

CREATE TABLE IF NOT EXISTS "intervu"."credit_grants" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    granted_at  text GENERATED ALWAYS AS (doc->>'granted_at') STORED
);
ALTER TABLE "intervu"."credit_grants" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "credit_grants_granted_at_idx" ON "intervu"."credit_grants" ("granted_at");

CREATE TABLE IF NOT EXISTS "intervu"."waitlist" (
    path        text PRIMARY KEY,
    doc         jsonb NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now(),
    sealed      text,
    ts          text GENERATED ALWAYS AS (doc->>'ts') STORED
);
ALTER TABLE "intervu"."waitlist" ADD COLUMN IF NOT EXISTS sealed text;
CREATE INDEX IF NOT EXISTS "waitlist_ts_idx" ON "intervu"."waitlist" ("ts");

-- Documents from Firestore collections no code mentions any more, copied so
-- the wipe can't destroy forgotten data. Keyed by a keyed hash of the
-- original path (an id may be an email); never read by the app.
CREATE TABLE IF NOT EXISTS "intervu"."legacy_docs" (
    path        text PRIMARY KEY,
    sealed      text NOT NULL,
    copied_at   timestamptz NOT NULL DEFAULT now()
);

-- Read/write access for the app. Reuses the roles the db-box already has
-- (deploy/db-box/setup.sh) rather than minting another: service_role is the
-- privileged writer, pipeline is the batch role. Default privileges cover
-- tables added by a later regeneration of this file.
GRANT USAGE ON SCHEMA "intervu" TO service_role, pipeline;
GRANT ALL ON ALL TABLES IN SCHEMA "intervu" TO service_role, pipeline;
ALTER DEFAULT PRIVILEGES IN SCHEMA "intervu"
    GRANT ALL ON TABLES TO service_role, pipeline;

COMMIT;
