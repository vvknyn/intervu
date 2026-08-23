/**
 * The ONLY place in the codebase that enumerates Supabase auth users.
 *
 * Two independent hazards make this file necessary rather than optional:
 *
 *  - intervu and subspace now SHARE one Supabase `auth.users` table
 *    (app-tag.ts). `supabase.auth.admin.listUsers()` returns every user of
 *    BOTH products — ported naively, an intervu-only surface (the admin
 *    dashboard, the daily digest) would see and mail subspace's accounts
 *    too. Every enumeration here is filtered by the caller's own app slug
 *    via `hasApp`, taken as a parameter rather than hardcoded, so this
 *    module has no idea "intervu" exists as a special case. An untagged or
 *    malformed row is EXCLUDED, never included by default — fail closed,
 *    because excluding someone from a digest is a bug and mailing another
 *    product's users is an incident.
 *
 *  - Supabase's admin pagination is `{page, perPage}` with a server-side
 *    max, unlike Firebase Admin Auth's `pageToken` walk it replaces. That
 *    difference is hidden inside `listAppUsers`; callers never paginate by
 *    hand.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { hasApp, resolveLegacyUid } from "@/lib/auth/app-tag";
import type { User as SupabaseUser } from "@supabase/supabase-js";

/** One directory entry — the fields intervu's admin/email surfaces need,
 *  independent of whether the account came from Firebase (migrated) or was
 *  born on Supabase. */
export interface DirectoryUser {
    /** The Supabase `auth.users.id` — the row's actual primary key. */
    id: string;
    /** The id this user's pre-migration Firestore documents are keyed
     *  under. See `resolveLegacyUid` for why this can differ from `id`. */
    legacyUid: string;
    email: string | undefined;
    emailVerified: boolean;
    displayName: string | undefined;
    createdAt: string;
    lastSignInAt: string | undefined;
    /** Every auth provider linked to the account (e.g. `["email"]`,
     *  `["email","google"]`) — GoTrue's own `app_metadata.providers`, not
     *  re-derived from `identities`. */
    providers: string[];
}

/** The slice of the Supabase admin API this module needs. Narrow enough
 *  that a test can hand-build a fake without a real SupabaseClient — same
 *  seam pattern as ensure-app-membership.ts's `AdminAuthClient`. */
export interface DirectoryAdminClient {
    auth: {
        admin: {
            listUsers(params: { page: number; perPage: number }): Promise<{
                data: { users: SupabaseUser[]; nextPage?: number | null };
                error: { message: string } | null;
            }>;
            getUserById(id: string): Promise<{
                data: { user: SupabaseUser | null };
                error: { message: string } | null;
            }>;
        };
    };
}

/** Users per page requested from GoTrue's admin listing — the single source
 *  of truth every enumeration in this module shares. */
const PAGE_SIZE = 1000;

function toDirectoryUser(user: SupabaseUser): DirectoryUser {
    const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
        (typeof userMetadata.full_name === "string" && userMetadata.full_name) ||
        (typeof userMetadata.name === "string" && userMetadata.name) ||
        undefined;
    return {
        id: user.id,
        legacyUid: resolveLegacyUid(user),
        email: user.email,
        emailVerified: Boolean(user.email_confirmed_at),
        displayName,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
        providers: user.app_metadata?.providers ?? [],
    };
}

/**
 * Walks every page of the shared `auth.users` table, yielding only the
 * accounts tagged for `app` — see the module doc for why that filter is
 * non-negotiable. Pagination is fully hidden: callers just iterate.
 */
export async function* listAppUsers(
    app: string,
    adminClient?: DirectoryAdminClient,
): AsyncIterable<DirectoryUser> {
    const admin: DirectoryAdminClient = adminClient ?? (await createAdminClient());
    let page = 1;
    for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        if (error) {
            throw new Error(`listAppUsers: failed to list users (page ${page}): ${error.message}`);
        }
        for (const user of data.users) {
            if (hasApp(user.app_metadata, app)) yield toDirectoryUser(user);
        }
        if (!data.nextPage || data.users.length === 0) return;
        page = data.nextPage;
    }
}

/**
 * One user tagged for `app`, or null when the id doesn't exist OR exists
 * but isn't tagged for `app` — a caller must treat those identically (fail
 * closed: an untagged account is invisible here exactly like a nonexistent
 * one).
 *
 * `userId` is resolved two ways: first as the row's own Supabase id (the
 * fast, indexed path — true for every Supabase-native account, since
 * `resolveLegacyUid` returns `user.id` when there's no `firebase_uid`).
 * When that misses, `userId` may instead be a legacy Firebase uid carried
 * forward on a migrated account (`app_metadata.firebase_uid`), which is not
 * the row's primary key and therefore can't be looked up directly — GoTrue
 * has no index on `app_metadata`, so the only correct fallback is scanning
 * this app's own directory (already filtered, already bounded to one
 * product) for the matching `legacyUid`.
 */
export async function getAppUser(
    userId: string,
    app: string,
    adminClient?: DirectoryAdminClient,
): Promise<DirectoryUser | null> {
    const admin: DirectoryAdminClient = adminClient ?? (await createAdminClient());

    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (!error && data.user && hasApp(data.user.app_metadata, app)) {
        return toDirectoryUser(data.user);
    }

    for await (const candidate of listAppUsers(app, admin)) {
        if (candidate.legacyUid === userId) return candidate;
    }
    return null;
}
