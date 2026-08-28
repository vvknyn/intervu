/**
 * Re-export shim. The implementation moved to `src/lib/auth/workos-sync.ts`
 * (2026-08-27) because runtime auth code (signup, sign-in, hosted-flow
 * callback) now needs `ensureOrganization`/`ensureMembership` too, not just
 * these migration scripts — see that module's doc comment. Kept here so the
 * 4 existing script consumers (`migrate-firebase-to-workos.ts`,
 * `clean-test-identities.ts`, `migrate-supabase-to-workos.ts`,
 * `audit-workos-users.ts`) need no import-path edits.
 */
export * from "../src/lib/auth/workos-sync.ts";
