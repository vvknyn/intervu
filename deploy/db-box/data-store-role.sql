-- Role for DATA_PG_URL: the web app's connection to the sealed account-data
-- store (src/lib/db/docstore/pg-docstore.ts), live once DATA_STORE=postgres.
--
-- Run manually on the DB box as a superuser AFTER intervu-schema.sql, with
-- the password set interactively and never committed:
--
--   CREATE ROLE velai_data LOGIN PASSWORD '<set interactively>';
--   \i data-store-role.sql
--
-- It can read and write rows in the account-data tables and nothing else:
-- no DDL, no other schema. What it reads is ciphertext without
-- DATA_ENCRYPTION_KEY, which lives only in the web box's env file (and
-- Vivek's own off-box copy), never on this box.
--
-- Idempotent: safe to re-run after a schema regeneration adds a table.

BEGIN;

GRANT USAGE ON SCHEMA "intervu" TO velai_data;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'agent_clients', 'agent_codes', 'agent_credentials', 'agent_record_budgets',
        'applications', 'profiles', 'tailored_resumes', 'resume_history', 'job_analyses',
        'interview_prep_cache', 'apply_counters', 'contact_messages', 'stories', 'sources',
        'favorite_questions', 'interview_questions', 'feedback', 'connect_waitlist',
        'founding_waitlist', 'saved_searches', 'followed_companies', 'email_digest_state',
        'email_suppressions', 'welcome_emails', 'search_events', 'search_opens', 'app_config',
        'market_stats_daily', 'viewer_sessions', 'job_views', 'follow_funnel_events',
        'credit_grants', 'waitlist', 'legacy_docs'
    ] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "intervu".%I TO velai_data', t);
    END LOOP;
END $$;

COMMIT;
