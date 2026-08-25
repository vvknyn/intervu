/**
 * Supabase Auth → WorkOS user mapping.
 *
 * The sibling of `firebase-to-workos.ts`, and deliberately shaped the same way:
 * pure functions, no network, no SDK handles, so the parts that are easy to get
 * silently wrong are the parts under test.
 *
 * Passwords are simpler here than on the Firebase side. Supabase stores plain
 * bcrypt (`$2a$10$…`), which WorkOS accepts as `bcrypt` verbatim — no
 * re-encoding, and therefore none of the alphabet hazard that made the Firebase
 * hashes fail. The value is passed through untouched precisely because touching
 * it is what breaks it.
 */

import { APP_SUBSPACE, mergeApps } from "@/lib/auth/workos-apps";

/** The subset of an `auth.users` row this mapping reads. */
export interface SupabaseUserRow {
    /** uuid — becomes `external_id`, so subspace's rows stay attached. */
    id: string;
    email?: string | null;
    encrypted_password?: string | null;
    email_confirmed_at?: Date | string | null;
    /** Provider-dependent: `full_name`/`name` for Google, `username` for email. */
    raw_user_meta_data?: Record<string, unknown> | null;
    banned_until?: Date | string | null;
    deleted_at?: Date | string | null;
}

export interface WorkosUserPayload {
    email: string;
    email_verified: boolean;
    first_name?: string;
    last_name?: string;
    external_id: string;
    metadata: Record<string, string>;
    password_hash?: string;
    password_hash_type?: "bcrypt";
}

/**
 * bcrypt hashes start `$2a$`, `$2b$` or `$2y$`.
 *
 * Checked rather than assumed: Supabase can hold a hash written by an older
 * GoTrue or an import, and shipping a non-bcrypt string under
 * `password_hash_type: "bcrypt"` would be accepted at import and then reject
 * the user's password at sign-in — a silent lockout, the same failure mode the
 * Firebase side produced.
 */
export function isBcryptHash(value: string | undefined | null): boolean {
    return /^\$2[aby]\$\d{2}\$.{53}$/.test(value ?? "");
}

/**
 * A display name out of Supabase's provider-dependent metadata.
 *
 * Google users carry `full_name`/`name`; email users usually carry only
 * `username`. Preference order goes most-human-first, and `username` is used
 * only as a last resort because it is a handle, not a name.
 */
export function displayNameFrom(meta: Record<string, unknown> | null | undefined): string | undefined {
    for (const key of ["full_name", "name", "username"]) {
        const value = meta?.[key];
        if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ");
    }
    return undefined;
}

function splitName(displayName?: string): { first?: string; last?: string } {
    if (!displayName) return {};
    const cut = displayName.indexOf(" ");
    if (cut === -1) return { first: displayName };
    return { first: displayName.slice(0, cut), last: displayName.slice(cut + 1) };
}

/**
 * Map one Supabase user to a WorkOS create-user payload.
 *
 * Returns `null` for a row that must not become a WorkOS identity — no email,
 * soft-deleted, or banned. Callers report these rather than dropping them
 * silently: a banned account arriving as a working login would undo a
 * moderation decision.
 *
 * `existingApps` carries whatever the user already has when the email is
 * already present in WorkOS, so a person with accounts in both products keeps
 * both tags instead of being overwritten by whichever migration ran last.
 */
export function toWorkosUserPayload(
    row: SupabaseUserRow,
    existingApps?: string,
): WorkosUserPayload | null {
    if (!row.email?.trim()) return null;
    if (row.deleted_at || row.banned_until) return null;

    const displayName = displayNameFrom(row.raw_user_meta_data);
    const { first, last } = splitName(displayName);
    const usable = isBcryptHash(row.encrypted_password);

    const metadata: Record<string, string> = {
        apps: mergeApps(existingApps, APP_SUBSPACE),
        supabase_uid: row.id,
    };

    return {
        email: row.email.trim().toLowerCase(),
        email_verified: Boolean(row.email_confirmed_at),
        ...(first ? { first_name: first } : {}),
        ...(last ? { last_name: last } : {}),
        external_id: row.id,
        metadata,
        ...(usable
            ? { password_hash: row.encrypted_password as string, password_hash_type: "bcrypt" as const }
            : {}),
    };
}
