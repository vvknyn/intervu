/**
 * Server-side session lookup, backed by Supabase Auth (GoTrue). Firebase's
 * role as the identity provider ends here — `firebase-admin` (getAdminDb)
 * still owns every byte of application DATA in Firestore; this file no
 * longer touches Firebase Auth at all.
 *
 * getServerUser()'s return shape is byte-identical to the Firebase-era
 * version it replaces (`{ uid, email, displayName, customClaims }`) on
 * purpose: it has 34 call sites across server actions, routes, and pages,
 * none of which should have to change for this migration.
 *
 * Field mapping (see the migration report for the full audit):
 *  - uid: `resolveLegacyUid(user)` (lib/auth/app-tag.ts) — THE highest-stakes
 *    line here. Every pre-migration Firestore document is keyed by a user's
 *    original Firebase UID, carried forward on migrated accounts as
 *    `app_metadata.firebase_uid`. Getting this fallback backwards silently
 *    disappears a migrated user's résumés/applications.
 *  - email: `user.email`, unchanged shape.
 *  - displayName: Google sign-in lands the name at `user_metadata.full_name`
 *    (Supabase's own field for it) or `user_metadata.name` (some OAuth
 *    providers / manually-set metadata use this instead) — audited across
 *    all 34 call sites, NONE of which read this field today, so this is a
 *    best-effort mapping with no live consumer to get wrong.
 *  - customClaims: audited the same way — nothing reads it. Firebase custom
 *    claims and Supabase `app_metadata` play the same conceptual role
 *    (admin/server-settable, baked into the session, never user-editable),
 *    so `app_metadata` is the least-surprising stand-in if this is ever
 *    consumed later.
 */

import { createClient } from "@/lib/supabase/server";
import { resolveLegacyUid } from "@/lib/auth/app-tag";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export interface ServerUser {
    uid: string;
    email?: string;
    displayName?: string;
    customClaims?: Record<string, any>;
}

/**
 * Pure decision: maps a Supabase auth user (or the absence of one) onto the
 * byte-identical `ServerUser` shape the Firebase-era `getServerUser` used to
 * return. Exported so the field mapping — especially `uid`'s
 * migrated-vs-new-user branch — is directly unit-testable without a
 * Supabase client, cookies, or a network call.
 */
export function mapSupabaseUserToServerUser(user: SupabaseUser | null | undefined): ServerUser | null {
    if (!user) return null;

    const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
        (typeof userMetadata.full_name === "string" && userMetadata.full_name) ||
        (typeof userMetadata.name === "string" && userMetadata.name) ||
        undefined;

    return {
        uid: resolveLegacyUid(user),
        email: user.email,
        displayName,
        customClaims: user.app_metadata as Record<string, any> | undefined,
    };
}

/**
 * Get the current authenticated user from the Supabase session (server-side).
 * Returns null if not authenticated. Never throws — any failure to reach or
 * parse a session is treated the same as "no session".
 */
export async function getServerUser(): Promise<ServerUser | null> {
    try {
        const supabase = await createClient();
        const { data, error } = await supabase.auth.getUser();
        if (error) return null;
        return mapSupabaseUserToServerUser(data.user);
    } catch {
        // Session expired, malformed, or the auth backend is unreachable.
        return null;
    }
}
