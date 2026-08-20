-- Apply manually as postgres on the DB box — see
-- deploy/db-box/load-firestore-export.sh for the lane. Requires PG13+
-- (gen_random_uuid). NEVER applied by CI or app code.

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
  purpose text NOT NULL CHECK (purpose IN ('verify_email','login')),
  redirect_path text NOT NULL DEFAULT '/',
  request_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_tokens_identity_created_idx ON intervu.auth_tokens (identity_id, created_at DESC);

-- Reserved for the auth-exit project. Nothing in this phase writes it.
CREATE TABLE IF NOT EXISTS intervu.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS intervu.email_follows (
  identity_id uuid NOT NULL REFERENCES intervu.identities(id) ON DELETE CASCADE,
  company_domain text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  PRIMARY KEY (identity_id, company_domain)
);

-- ROLE SETUP — run manually as postgres, password set interactively, never committed:
--   CREATE ROLE intervu_web LOGIN PASSWORD '<set interactively>';
--   GRANT USAGE ON SCHEMA intervu TO intervu_web;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON intervu.identities, intervu.auth_tokens,
--     intervu.sessions, intervu.email_follows TO intervu_web;
