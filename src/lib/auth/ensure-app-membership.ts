/**
 * Tags a Supabase auth user with a product slug in `app_metadata.apps`, the
 * shared array intervu and subspace both gate on (see app-tag.ts). There are
 * exactly two places a person can ever become an intervu user — password
 * signup (actions/auth.ts's `signUp`) and the Google OAuth callback
 * (app/auth/callback/route.ts) — and BOTH call this same helper. A database
 * trigger can't do this: an INSERT on `auth.users` carries no signal about
 * which product the person was signing into.
 *
 * APPENDS, never overwrites — a subspace user signing into intervu for the
 * first time must come out of this as `["subspace","intervu"]`, not
 * `["intervu"]`. Idempotent by construction: the write only happens when the
 * slug isn't already present, so a second call for an already-tagged user
 * makes no request at all.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { appsFromClaims } from "@/lib/auth/app-tag";

export interface EnsureAppMembershipResult {
    /** True only when this call actually wrote the tag — false when it was
     *  already present (no-op) — so callers can key one-time-per-app side
     *  effects (e.g. a welcome email) off "was this the first time", not
     *  "did this run". */
    added: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pure decision: given a user's current `app_metadata`, does `app` need to
 * be appended, and what would the metadata look like afterward? Exported so
 * the append-not-overwrite rule is directly unit-testable without a
 * Supabase client at all.
 */
export function computeAppMembershipUpdate(
    appMetadata: unknown,
    app: string,
): { appMetadata: Record<string, unknown>; added: boolean } {
    const base = isRecord(appMetadata) ? appMetadata : {};
    const currentApps = appsFromClaims(base);
    if (currentApps.includes(app)) {
        return { appMetadata: base, added: false };
    }
    return { appMetadata: { ...base, apps: [...currentApps, app] }, added: true };
}

/** The slice of the Supabase admin auth API this helper needs — narrow
 *  enough that a test can hand-build a fake without a real SupabaseClient. */
export interface AdminAuthClient {
    auth: {
        admin: {
            getUserById(id: string): Promise<{
                data: { user: { app_metadata: unknown } | null };
                error: { message: string } | null;
            }>;
            updateUserById(
                id: string,
                attrs: { app_metadata: Record<string, unknown> },
            ): Promise<{ error: { message: string } | null }>;
        };
    };
}

/**
 * @param adminClient injection seam for tests only — production call sites
 * never pass it, so it always resolves the real service-role client.
 */
export async function ensureAppMembership(
    userId: string,
    app: string,
    adminClient?: AdminAuthClient,
): Promise<EnsureAppMembershipResult> {
    const admin: AdminAuthClient = adminClient ?? (await createAdminClient());

    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) {
        throw new Error(
            `ensureAppMembership: could not load user ${userId}: ${error?.message ?? "not found"}`,
        );
    }

    const { appMetadata, added } = computeAppMembershipUpdate(data.user.app_metadata, app);
    if (!added) {
        return { added: false };
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: appMetadata,
    });
    if (updateError) {
        throw new Error(
            `ensureAppMembership: failed to tag user ${userId} with "${app}": ${updateError.message}`,
        );
    }
    return { added: true };
}
