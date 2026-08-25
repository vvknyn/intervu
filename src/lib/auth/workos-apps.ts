/**
 * Which product a WorkOS identity belongs to.
 *
 * One WorkOS environment now serves two products, so "is this an intervu user?"
 * has to be answerable. Two mechanisms carry that, deliberately:
 *
 *   1. **Organization membership** is the authority. WorkOS filters users
 *      server-side by `?organization_id=`, so membership is queryable rather
 *      than merely descriptive, and it is what per-product auth policy would
 *      hang off later.
 *   2. **`metadata.apps`** is the readable mirror. It rides on the user record
 *      itself, so a single fetch — or a glance at the dashboard — answers the
 *      question without a second call.
 *
 * `apps` reuses the name the Supabase `app_metadata.apps` array already used
 * for exactly this, so the vocabulary does not fork across the migration.
 *
 * The list is plural because one person can be both. A single email is a single
 * WorkOS identity, so anyone with accounts in both products arrives as one user
 * belonging to both — and a migration that overwrote the tag instead of merging
 * it would silently evict them from the product it ran second.
 */

export const APP_INTERVU = "intervu";
export const APP_SUBSPACE = "subspace";

/** Parse the stored tag back into a set. Tolerates spacing and empty values. */
export function parseApps(value: string | undefined | null): string[] {
    return (value ?? "")
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Add an app to whatever a user already carries.
 *
 * Additive on purpose — see the note above about the second migration evicting
 * a dual-product user. Sorted so the stored value is stable and two runs in
 * either order produce the same string.
 */
export function mergeApps(existing: string | undefined | null, adding: string): string {
    return [...new Set([...parseApps(existing), adding.trim().toLowerCase()])].sort().join(",");
}

/** Does this user belong to the given product? */
export function hasApp(existing: string | undefined | null, app: string): boolean {
    return parseApps(existing).includes(app.trim().toLowerCase());
}

/** What a migration wants to write, before it is reconciled with what exists. */
export interface DesiredUser {
    email: string;
    email_verified?: boolean;
    first_name?: string;
    last_name?: string;
    external_id: string;
    metadata: Record<string, string>;
    password_hash?: string;
    password_hash_type?: string;
}

/** The parts of an existing WorkOS user that constrain an update. */
export interface ExistingUser {
    externalId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    metadata?: Record<string, string> | null;
}

/**
 * The update body for a user who is already in WorkOS.
 *
 * Guards the one thing a second migration can destroy. A single email is a
 * single WorkOS identity, so a person with accounts in BOTH products is one
 * user — and the migration that runs second must not overwrite what the first
 * one established:
 *
 *   * **`external_id` is never overwritten** once set. It is the key every
 *     Firestore document hangs off, so replacing a Firebase uid with a Supabase
 *     uuid would orphan that person's entire account while the login kept
 *     working. It is only sent when the existing user has none, which is the
 *     repair case for a row imported before the field was populated. The other
 *     system's id still travels, in `metadata`.
 *   * **`apps` merges** rather than replaces, so the user keeps both products.
 *   * **A name already present is not blanked** by a source that lacks one.
 *
 * Email is deliberately absent: it is the match key, so sending it back can
 * only ever be a no-op or a mistake.
 */
export function buildUpdatePayload(
    existing: ExistingUser,
    desired: DesiredUser,
): Record<string, unknown> {
    const metadata = { ...desired.metadata };
    metadata.apps = [...new Set([...parseApps(existing.metadata?.apps), ...parseApps(desired.metadata.apps)])]
        .sort()
        .join(",");

    const update: Record<string, unknown> = {
        metadata: { ...existing.metadata, ...metadata },
    };

    if (!existing.externalId) update.external_id = desired.external_id;
    if (desired.email_verified) update.email_verified = true;
    if (desired.first_name && !existing.firstName) update.first_name = desired.first_name;
    if (desired.last_name && !existing.lastName) update.last_name = desired.last_name;

    return update;
}
