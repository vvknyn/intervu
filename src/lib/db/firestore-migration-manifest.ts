/**
 * The single source of truth for the Firestore -> Postgres migration: which
 * collections move, what each becomes in the `intervu` schema, and which
 * fields earn an index.
 *
 * Both halves of the migration read this one list — `scripts/pg-generate-
 * schema.mts` emits the DDL from it and `scripts/firestore-export.mts` walks
 * it to dump the data — so a table's columns cannot drift from what the
 * exporter actually writes into them.
 *
 * SHAPE. Every table is the same: `path` (the full Firestore document path)
 * as the primary key, `doc` as the whole document, and zero or more
 * generated columns derived FROM `doc`. The document is the single source of
 * truth and every indexed column is computed from it, so a column can never
 * disagree with the row it came from. Nothing is dropped in translation:
 * fields nobody queries are still present in `doc` and still queryable, just
 * without an index.
 *
 * `path`, not `id`, is the key: Firestore document ids are unique only
 * within their own collection, so `users/<a>/savedSearches/x` and
 * `users/<b>/savedSearches/x` are different documents with the same id. The
 * path is globally unique, and it doubles as provenance — every row says
 * exactly where it came from.
 *
 * TIMESTAMPS. A census of live data (2026-08-17) found no Firestore
 * `Timestamp` values anywhere; dates are stored two ways and only two ways:
 * epoch milliseconds as a number (the `agent_*` collections and
 * `viewer_sessions`) and ISO-8601 UTC strings (everything else). That is why
 * there is no `timestamptz` column type here. Casting text to `timestamptz`
 * is STABLE, not IMMUTABLE — it reads the TimeZone setting — so Postgres
 * rejects it inside a generated column. `::bigint` is immutable, and
 * ISO-8601-with-Z strings already sort lexicographically in chronological
 * order, so they index correctly as plain text.
 */

/** Postgres schema the migration owns. Kept out of `public`, which the
 *  supabase-exit tables occupy, so the two migrations never collide. */
export const INTERVU_SCHEMA = "intervu";

export type IndexedFieldType =
  /** JSON string, indexed as text. ISO-8601 UTC sorts chronologically. */
  | "text"
  /** JSON number holding epoch milliseconds. */
  | "epoch_ms";

export interface IndexedField {
  /** Key inside the document. */
  field: string;
  type: IndexedFieldType;
  /** Column name; defaults to `field` lowercased. Firestore mixes
   *  camelCase and snake_case across collections and this preserves the
   *  distinction rather than silently normalizing one into the other. */
  column?: string;
  unique?: boolean;
}

export interface CollectionSpec {
  /** Firestore collection id. For a subcollection this is the leaf id. */
  collection: string;
  /** Table name inside `INTERVU_SCHEMA`. */
  table: string;
  /** Set for `<parent>/<uid>/<collection>` subcollections. The uid lives in
   *  the PATH, not in the document, so it becomes a generated column read
   *  back out of the path rather than something the exporter injects.
   *  Both consumers are parent-agnostic — the exporter walks a collection
   *  GROUP and the DDL reads `split_part(path,'/',2)` — so the parent name
   *  here is documentation of provenance, not a switch. */
  subcollectionOf?: "users" | "profiles";
  indexed: readonly IndexedField[];
}

/**
 * Every collection that exists in Firestore today, plus the ones this
 * codebase writes to but which hold nothing yet.
 *
 * The empty ones are NOT optional: `email_digest_state`, `welcome_emails`,
 * `email_suppressions`, `savedSearches` and `followedCompanies` are all
 * written by live code paths (the digest cursor, the welcome-email claim,
 * the unsubscribe flow, the two save actions). Leaving them out would mean
 * a cutover that works until the first person saves a search.
 */
export const MIGRATION_MANIFEST: readonly CollectionSpec[] = [
  // --- agent / MCP pairing ------------------------------------------------
  {
    collection: "agent_clients",
    table: "agent_clients",
    indexed: [{ field: "createdAt", type: "epoch_ms", column: "created_at_ms" }],
  },
  {
    collection: "agent_codes",
    table: "agent_codes",
    indexed: [
      { field: "uid", type: "text" },
      { field: "clientId", type: "text", column: "client_id" },
      { field: "expiresAt", type: "epoch_ms", column: "expires_at_ms" },
    ],
  },
  {
    collection: "agent_credentials",
    table: "agent_credentials",
    indexed: [
      // The bearer-token lookup (`lib/agent/tokens.ts`) — the hottest read
      // in the agent path, and the one that must not table-scan.
      { field: "tokenHash", type: "text", column: "token_hash" },
      { field: "uid", type: "text" },
      { field: "clientId", type: "text", column: "client_id" },
      { field: "expiresAt", type: "epoch_ms", column: "expires_at_ms" },
      { field: "revokedAt", type: "epoch_ms", column: "revoked_at_ms" },
    ],
  },
  { collection: "agent_record_budgets", table: "agent_record_budgets", indexed: [] },

  // --- user data ----------------------------------------------------------
  {
    collection: "applications",
    table: "applications",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "status", type: "text" },
      { field: "updated_at", type: "text" },
      { field: "created_at", type: "text" },
      { field: "job_id", type: "text" },
    ],
  },
  {
    collection: "profiles",
    table: "profiles",
    indexed: [{ field: "username", type: "text", unique: true }],
  },
  {
    collection: "tailored_resumes",
    table: "tailored_resumes",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "created_at", type: "text" },
      { field: "job_analysis_id", type: "text" },
    ],
  },
  {
    // profiles/<uid>/resume_history/<id> — every saved snapshot in the
    // resume editor's version history. Added 2026-08-18: the feature landed
    // one day after this manifest's data census, so a cutover run before
    // this line would have silently left every saved version behind.
    collection: "resume_history",
    table: "resume_history",
    subcollectionOf: "profiles",
    indexed: [{ field: "saved_at", type: "text" }],
  },
  {
    collection: "job_analyses",
    table: "job_analyses",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },
  {
    collection: "interview_prep_cache",
    table: "interview_prep_cache",
    indexed: [
      { field: "cache_key", type: "text" },
      { field: "user_id", type: "text" },
      { field: "expires_at", type: "text" },
    ],
  },
  { collection: "apply_counters", table: "apply_counters", indexed: [] },
  {
    collection: "contact_messages",
    table: "contact_messages",
    indexed: [
      { field: "email", type: "text" },
      { field: "ts", type: "text" },
    ],
  },

  // --- user-authored content ----------------------------------------------
  // All six were written by live code and absent from this manifest until
  // 2026-08-18. `stories` and `sources` are deleted by user_id when an
  // account is closed (actions/account.ts), which is the clearest proof they
  // are user-owned data a cutover cannot drop.
  {
    collection: "stories",
    table: "stories",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },
  {
    collection: "sources",
    table: "sources",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },
  {
    collection: "favorite_questions",
    table: "favorite_questions",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },
  {
    collection: "interview_questions",
    table: "interview_questions",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "application_id", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },
  {
    collection: "feedback",
    table: "feedback",
    indexed: [
      { field: "user_id", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },
  {
    // Doc id is the email, so `path` already carries it; the field is
    // indexed anyway because lookups are by address, not by path.
    collection: "connect_waitlist",
    table: "connect_waitlist",
    indexed: [
      { field: "email", type: "text" },
      { field: "client", type: "text" },
      { field: "created_at", type: "text" },
    ],
  },

  // --- saved intent (empty today, written by live code) -------------------
  {
    collection: "savedSearches",
    table: "saved_searches",
    subcollectionOf: "users",
    indexed: [],
  },
  {
    collection: "followedCompanies",
    table: "followed_companies",
    subcollectionOf: "users",
    indexed: [{ field: "domain", type: "text" }],
  },

  // --- email (empty today, written by live code) --------------------------
  { collection: "email_digest_state", table: "email_digest_state", indexed: [] },
  { collection: "email_suppressions", table: "email_suppressions", indexed: [] },
  {
    collection: "welcome_emails",
    table: "welcome_emails",
    indexed: [{ field: "email", type: "text" }],
  },

  // --- analytics ----------------------------------------------------------
  {
    collection: "search_events",
    table: "search_events",
    indexed: [
      { field: "createdAt", type: "text", column: "created_at" },
      { field: "expiresAt", type: "text", column: "expires_at" },
      { field: "searchId", type: "text", column: "search_id" },
    ],
  },
  {
    collection: "search_opens",
    table: "search_opens",
    indexed: [
      { field: "createdAt", type: "text", column: "created_at" },
      { field: "expiresAt", type: "text", column: "expires_at" },
      { field: "searchId", type: "text", column: "search_id" },
      { field: "jobId", type: "text", column: "job_id" },
    ],
  },

  // --- ops ----------------------------------------------------------------
  { collection: "app_config", table: "app_config", indexed: [] },
  {
    collection: "market_stats_daily",
    table: "market_stats_daily",
    indexed: [{ field: "date", type: "text", unique: true }],
  },
  {
    collection: "viewer_sessions",
    table: "viewer_sessions",
    indexed: [
      { field: "uid", type: "text" },
      { field: "expiresAt", type: "epoch_ms", column: "expires_at_ms" },
    ],
  },
];

/**
 * Collection names that appear in `db.collection(...)` calls but are
 * deliberately NOT migrated, each with the reason. The guard in
 * `tests/unit/firestore-migration-manifest.test.ts` derives the required set
 * from the source rather than from a remembered list, so a new collection is
 * a test failure until it is either migrated or listed here on purpose.
 *
 * This list is the only sanctioned way to omit something. It exists because
 * the previous guard enumerated the five names someone thought to add, and
 * seven collections written by live code sat outside the manifest for weeks
 * without failing anything.
 */
export const NON_MIGRATED_COLLECTIONS: Readonly<Record<string, string>> = {
  /** A path segment, not a collection of documents. Only its subcollections
   *  (`savedSearches`, `followedCompanies`) hold data, and both are
   *  migrated in their own right with `subcollectionOf: "users"`. */
  users: "parent path segment; its subcollections are migrated separately",
};

export function columnNameFor(field: IndexedField): string {
  return field.column ?? field.field.toLowerCase();
}

/**
 * The SQL expression a generated column is computed from. Pure so the DDL
 * generator has no branching of its own, and so the immutability rule above
 * is enforced in exactly one place.
 */
export function generatedExpressionFor(field: IndexedField): string {
  const extract = `doc->>'${field.field}'`;
  return field.type === "epoch_ms" ? `(${extract})::bigint` : extract;
}
