/**
 * Product tagging for a Supabase auth.users table shared across intervu and
 * subspace — one human can hold an account usable on both products.
 *
 * The tag lives at `app_metadata.apps`, an array of product slugs (e.g.
 * `["subspace", "intervu"]`). A legacy scalar string form is tolerated on
 * read (never written) for forward compatibility with any row seeded before
 * the array form landed.
 *
 * These helpers read `app_metadata` ONLY, never `user_metadata`.
 * `user_metadata` is writable by the signed-in user themselves via
 * `supabase.auth.updateUser()` — trusting it here would let any user grant
 * themselves access to another product just by setting a field on their own
 * account. `app_metadata` is only settable server-side (service role /
 * Admin API), which is what makes it safe to gate access on.
 *
 * Every helper fails closed: missing, null, or malformed input yields `[]` /
 * `false`, never a thrown error and never a default of `true`.
 */

export const APP_INTERVU = 'intervu'

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalizes `app_metadata.apps` into an array of product slugs. Fails
 * closed to `[]` for anything that isn't an array or a legacy scalar
 * string — missing/null/undefined app_metadata, a non-object app_metadata,
 * a non-array/non-string `apps` field, or non-string entries inside an
 * `apps` array are all dropped rather than thrown on.
 */
export function appsFromClaims(appMetadata: unknown): string[] {
    if (!isPlainObject(appMetadata)) return []

    const apps = appMetadata.apps

    if (typeof apps === 'string') return [apps]

    if (Array.isArray(apps)) {
        return apps.filter((entry): entry is string => typeof entry === 'string')
    }

    return []
}

/** Whether `appMetadata` tags the account for `app`. Fails closed to `false`. */
export function hasApp(appMetadata: unknown, app: string): boolean {
    return appsFromClaims(appMetadata).includes(app)
}

/**
 * Resolves the id that a user's existing Firestore documents are keyed
 * under.
 *
 * Every pre-migration Firestore document is keyed by the user's original
 * Firebase UID, not their new Supabase UUID. A migrated user's
 * `app_metadata.firebase_uid` carries that original UID forward, so their
 * data stays reachable forever; a brand-new, Supabase-native user has no
 * such field and resolves to their own Supabase `user.id`. Getting this
 * fallback backwards silently makes a migrated user's existing data
 * disappear from under them.
 */
export function resolveLegacyUid(user: { id: string; app_metadata?: unknown }): string {
    const appMetadata = user.app_metadata
    if (isPlainObject(appMetadata)) {
        const firebaseUid = appMetadata.firebase_uid
        if (typeof firebaseUid === 'string' && firebaseUid.trim().length > 0) {
            return firebaseUid
        }
    }
    return user.id
}
