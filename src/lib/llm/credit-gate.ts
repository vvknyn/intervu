/**
 * Server-only module (imports firebase-admin); never import from a client
 * component. Exposed to the UI only via thin "use server" action wrappers.
 *
 * Per-user credit gate for the SHARED (app-funded) default model.
 *
 * Policy (2026-06):
 *  - vvk / admins: unlimited use of the shared key (no charge).
 *  - BYOK users (own OpenRouter/Groq key) or explicit key overrides: never
 *    charged — they pay their own provider.
 *  - Everyone else on the shared key: 1 credit per generation, with a small
 *    free monthly grant. Out of credits → blocked with a clear "add your own
 *    key or buy credits" message (Stripe purchase is a fast-follow).
 *
 * Metering is "per generation" (one user-facing AI action). Callers resolve the
 * provider config ONCE and call `chargeIfSharedKey(config)` once, above any
 * internal retry loop, so retries never double-charge.
 *
 * FAIL-OPEN: any internal error (Firestore down, etc.) ALLOWS the generation.
 * The only hard block is an explicit out-of-credits balance. A billing bug must
 * never lock users out of the product.
 */
import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";

/** Free generations granted per calendar month to non-admin shared-key users. */
const MONTHLY_FREE_CREDITS = 10;

/** Prefix on the thrown message so the UI can recognize the out-of-credits block. */
export const OUT_OF_CREDITS = "OUT_OF_CREDITS";

/** Admin emails get unlimited shared-key use. vvk is the default; override via env. */
function adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS || "vivek.nar87@gmail.com")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/** Current "YYYY-MM" period key used for the monthly free-credit refill. */
function currentPeriod(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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

/** The shared, app-funded key. A resolved config using this key is "on us". */
function sharedKey(): string {
    return process.env.OPENROUTER_API_KEY || "";
}

/**
 * Charge one credit iff the resolved config is using the SHARED key and the
 * caller is a non-admin user. No-op for admins, BYOK/override keys, anonymous
 * callers, or when no shared key is configured. Throws `OUT_OF_CREDITS: …` when
 * the user's balance is exhausted; fails open on any other error.
 */
export async function chargeIfSharedKey(config: { apiKey?: string | null }): Promise<void> {
    try {
        const shared = sharedKey();
        if (!shared || !config?.apiKey || config.apiKey !== shared) return; // BYOK / override / unconfigured
        const user = await getServerUser();
        if (!user) return; // no account to meter — allow
        if (await isAdminUser(user)) return; // vvk / admins: unlimited
        await consumeCredit(user.uid);
    } catch (e) {
        if (e instanceof Error && e.message.startsWith(OUT_OF_CREDITS)) throw e;
        console.error("[credits] gate failing open:", e instanceof Error ? e.message : e);
    }
}

/** Atomically decrement a user's balance (refilling at each new month). */
async function consumeCredit(uid: string): Promise<void> {
    const db = getAdminDb();
    const ref = db.collection("profiles").doc(uid);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {}) as {
            credits?: number;
            credits_period?: string;
        };
        const period = currentPeriod();
        let credits =
            data.credits_period === period && typeof data.credits === "number"
                ? data.credits
                : MONTHLY_FREE_CREDITS; // new month (or never set) → refill
        if (credits <= 0) {
            throw new Error(
                `${OUT_OF_CREDITS}: You've used your free AI credits for this month. ` +
                    `Add your own API key in Settings to keep going, or buy credits (coming soon).`,
            );
        }
        tx.set(
            ref,
            { credits: credits - 1, credits_period: period, credits_updated_at: new Date().toISOString() },
            { merge: true },
        );
    });
}

/** Read-only credit state for the current user, for UI display. */
export async function getCreditState(): Promise<{
    isAdmin: boolean;
    credits: number;
    monthlyFree: number;
}> {
    const fallback = { isAdmin: false, credits: MONTHLY_FREE_CREDITS, monthlyFree: MONTHLY_FREE_CREDITS };
    try {
        const user = await getServerUser();
        if (!user) return fallback;
        if (await isAdminUser(user)) return { isAdmin: true, credits: Infinity, monthlyFree: MONTHLY_FREE_CREDITS };
        const snap = await getAdminDb().collection("profiles").doc(user.uid).get();
        const data = (snap.exists ? snap.data() : {}) as { credits?: number; credits_period?: string };
        const credits =
            data.credits_period === currentPeriod() && typeof data.credits === "number"
                ? data.credits
                : MONTHLY_FREE_CREDITS;
        return { isAdmin: false, credits, monthlyFree: MONTHLY_FREE_CREDITS };
    } catch {
        return fallback;
    }
}
