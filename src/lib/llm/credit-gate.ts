/**
 * Server-only module (imports firebase-admin); never import from a client
 * component. Exposed to the UI only via thin "use server" action wrappers.
 *
 * Auth gate for the SHARED (app-funded) default model.
 *
 * Policy (2026-08-27 — everything free, yield is user data; billing removed
 * whole, see the strip-ai-billing changeset):
 *  - Signed out: hard block (`AUTH_REQUIRED`). Sign-in is an abuse control on
 *    the app-funded key, not a credit policy — there is no metering below it
 *    any more.
 *  - Everyone signed in gets unlimited use of the shared key.
 *  - `isAdminUser`/`adminEmails` also gate the separate `/admin` panel and
 *    are unrelated to the AI gate — kept in this file because both call
 *    sites already import from here and moving them is not part of this
 *    change.
 */
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Prefix on the thrown message so the UI can recognize the "must sign in" block.
 * The shared, app-funded key is never given to anonymous callers — sign-in is
 * required so usage is attributable to an account.
 */
export const AUTH_REQUIRED = "AUTH_REQUIRED";

/** User-facing copy for the hard block, pulled out so it has one source of
 *  truth and is unit-testable without the Firebase-dependent functions that
 *  throw it. */
export const AUTH_REQUIRED_MESSAGE = "Sign in to use Velai's built-in AI.";

/** Admin emails get unlimited shared-key use. vvk is the default; override via env. */
function adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS || "vivek.nar87@gmail.com")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/** Is this user an admin (email allowlist OR profiles.is_admin)? */
export async function isAdminUser(user: { uid: string; email?: string }): Promise<boolean> {
    if (user.email && adminEmails().includes(user.email.toLowerCase())) return true;
    try {
        const snap = await getAdminDb().collection("profiles").doc(user.uid).get();
        return snap.exists && snap.data()?.is_admin === true;
    } catch {
        return false;
    }
}
