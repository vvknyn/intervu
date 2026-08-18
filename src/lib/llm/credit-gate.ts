/**
 * Server-only module (imports firebase-admin); never import from a client
 * component. Exposed to the UI only via thin "use server" action wrappers.
 *
 * Per-user credit gate for the SHARED (app-funded) default model.
 *
 * Policy (2026-06, BYOK entry point removed 2026-08-08):
 *  - BETA (2026-08-18): `BETA_UNLIMITED_CREDITS` (./credit-copy.ts) is on, so
 *    nobody is charged. Everything below still applies the moment it is off —
 *    the ledger is untouched, not deleted, and the same constant drives
 *    /pricing's copy so the page can never advertise the wrong story.
 *  - vvk / admins: unlimited use of the shared key (no charge).
 *  - Legacy BYOK users (own OpenRouter/Groq key stored before 2026-08-08) or
 *    explicit key overrides: never charged — they pay their own provider.
 *    There is no more UI to add a new one (see profile.ts's
 *    getUserLLMConfig doc comment).
 *  - Everyone else on the shared key: 1 credit per generation, with a small
 *    free monthly grant. Out of credits → blocked with a clear "buy credits"
 *    message (Stripe purchase is a fast-follow).
 *
 * Metering is "per generation" (one user-facing AI action). Callers resolve the
 * provider config ONCE and call `chargeIfSharedKey(config)` once, above any
 * internal retry loop, so retries never double-charge.
 *
 * FAIL-OPEN: any internal error (Firestore down, etc.) ALLOWS the generation.
 * The only hard block is an explicit out-of-credits balance. A billing bug must
 * never lock users out of the product.
 *
 * Balance model (2026-08-17, credits-earned split): a user's spendable total
 * is TWO pools that must never be conflated —
 *  - `credits` / `credits_period`: the perishable monthly ALLOWANCE. Resets
 *    to `MONTHLY_FREE_CREDITS` the moment the stored period no longer
 *    matches the current one. Nothing here is ever carried forward.
 *  - `credits_earned`: the permanent EARNED balance (referral rewards, the
 *    welcome grant, future purchases). Never touched by the period-rollover
 *    branch, so it survives month boundaries untouched.
 * A spend drains the allowance first, then the earned balance — the
 * allowance expires at month-end regardless of use, so spending the
 * perishable pool before the permanent one is strictly better for the user
 * (standard use-it-or-lose-it ordering). Blocked only when BOTH are zero.
 */
import { BETA_UNLIMITED_CREDITS } from "@/lib/llm/credit-copy";
import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";

/** Free generations granted per calendar month to non-admin shared-key users.
 *  Exported so `/pricing`'s copy reads the same number this gate enforces —
 *  a hand-typed figure there would silently drift from this one. */
export const MONTHLY_FREE_CREDITS = 40;

/** Credits spent per metered AI generation. Every exposed action costs the
 *  same one credit — `resolveSpend` is the only place this is subtracted,
 *  and `/pricing`'s "1 credit per AI action" copy reads this constant rather
 *  than re-typing the number. The noun itself comes from `CREDIT_UNIT`
 *  (./credit-copy.ts), shared with the sidebar balance. */
export const CREDITS_PER_ACTION = 1;

/** One-time permanent credits granted on a user's first sign-in. The only
 *  place this amount is written — `grantWelcomeCredits` reads it, nothing
 *  else should re-type "20". */
export const WELCOME_CREDITS = 20;

/** Prefix on the thrown message so the UI can recognize the out-of-credits block. */
export const OUT_OF_CREDITS = "OUT_OF_CREDITS";

/**
 * Prefix on the thrown message so the UI can recognize the "must sign in" block.
 * The shared, app-funded key is never given to anonymous callers — sign-in is
 * required so usage is metered to an account (or exempted for admins / BYOK).
 */
export const AUTH_REQUIRED = "AUTH_REQUIRED";

/** User-facing copy for the two hard blocks, pulled out so it has one source
 *  of truth and is unit-testable without the Firebase-dependent functions
 *  that throw it. Neither message points at a self-service API-key UI —
 *  that entry point was removed 2026-08-08 (see profile.ts). */
export const AUTH_REQUIRED_MESSAGE = "Sign in to use Intervu's built-in AI.";
export const OUT_OF_CREDITS_MESSAGE =
    "You're out of AI credits — this month's free credits and any earned credits are both used up. More free credits arrive next month, or buy credits (coming soon).";

/** Admin emails get unlimited shared-key use. vvk is the default; override via env. */
function adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS || "vivek.nar87@gmail.com")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/** Current "YYYY-MM" period key used for the monthly free-credit refill.
 *  Exported so the admin metrics read the SAME period key the charge path
 *  writes — a second copy of this format would silently count nothing. */
export function currentPeriod(): string {
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
 * Enforce the cost policy for a single user-facing AI generation, given the
 * resolved provider config. This is the SINGLE chokepoint every server action
 * that can hit the shared, app-funded key must call.
 *
 *  - BYOK / explicit override / no shared key configured → no-op (they pay).
 *  - Shared key + NO authenticated user → HARD BLOCK (`AUTH_REQUIRED: …`). The
 *    shared key is never spent for anonymous traffic.
 *  - Shared key + admin → allowed, uncharged.
 *  - Shared key + non-admin user → charge one credit; `OUT_OF_CREDITS: …` when
 *    the monthly free balance is exhausted.
 *
 * FAIL-OPEN applies ONLY to credit-counting infrastructure errors (Firestore
 * down, etc.) — those allow the generation so a billing bug can't lock users
 * out. AUTH_REQUIRED and OUT_OF_CREDITS are deliberate hard blocks and always
 * propagate.
 */
export async function chargeIfSharedKey(config: { apiKey?: string | null }): Promise<void> {
    const shared = sharedKey();
    if (!shared || !config?.apiKey || config.apiKey !== shared) return; // BYOK / override / unconfigured

    // Resolving the user is part of the auth decision, not credit infra: a failure
    // here means we cannot prove an account, so we must NOT spend the shared key.
    let user: { uid: string; email?: string } | null;
    try {
        user = await getServerUser();
    } catch {
        user = null;
    }
    if (!user) {
        throw new Error(`${AUTH_REQUIRED}: ${AUTH_REQUIRED_MESSAGE}`);
    }

    try {
        // Beta short-circuits ahead of the admin lookup: nothing is metered,
        // so there is no reason to spend a Firestore read deciding who is
        // exempt. Sign-in is still required above — that gate exists so the
        // app-funded key is never spent on anonymous traffic, which is an
        // abuse control, not a credit policy.
        if (BETA_UNLIMITED_CREDITS) return;
        if (await isAdminUser(user)) return; // vvk / admins: unlimited
        await consumeCredit(user.uid);
    } catch (e) {
        // Hard blocks always propagate; only credit-counting infra errors fail open.
        if (e instanceof Error && (e.message.startsWith(OUT_OF_CREDITS) || e.message.startsWith(AUTH_REQUIRED))) throw e;
        console.error("[credits] gate failing open:", e instanceof Error ? e.message : e);
    }
}

/**
 * Resolve the current monthly allowance from stored profile fields, applying
 * the reset-on-new-period rule. Single source of truth for that rule — both
 * the spend path (`consumeCredit`) and the read-only path (`getCreditState`)
 * call this instead of each repeating the period-match check. Pure and
 * parameterized on `period` (not `currentPeriod()` internally) so a month
 * rollover is directly testable without mocking the clock.
 */
export function resolveAllowance(stored: { credits?: number; credits_period?: string }, period: string): number {
    return stored.credits_period === period && typeof stored.credits === "number"
        ? stored.credits
        : MONTHLY_FREE_CREDITS; // new month (or never set) → refill
}

/** Default a possibly-unset earned balance to 0. Single source of truth for
 *  that normalization — every reader of `credits_earned` goes through this. */
function resolveEarned(stored: { credits_earned?: number }): number {
    return typeof stored.credits_earned === "number" ? stored.credits_earned : 0;
}

export type SpendDecision = { blocked: true } | { blocked: false; allowance: number; earned: number };

/**
 * The spend-order decision, pure: given the two pools, decide whether a
 * charge is possible and, if so, which pool it drains. Allowance drains
 * first — it expires at month-end regardless of use, so spending the
 * perishable pool before the permanent one is strictly better for the user
 * (standard use-it-or-lose-it ordering). Blocked only when both are zero.
 */
export function resolveSpend(allowance: number, earned: number): SpendDecision {
    if (allowance <= 0 && earned <= 0) return { blocked: true };
    return allowance > 0
        ? { blocked: false, allowance: allowance - CREDITS_PER_ACTION, earned }
        : { blocked: false, allowance, earned: earned - CREDITS_PER_ACTION };
}

/** Atomically decrement a user's balance (allowance refills at each new
 *  month; earned never does — see `resolveAllowance`/`resolveSpend`). */
async function consumeCredit(uid: string): Promise<void> {
    const db = getAdminDb();
    const ref = db.collection("profiles").doc(uid);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {}) as {
            credits?: number;
            credits_period?: string;
            credits_earned?: number;
        };
        const period = currentPeriod();
        const spend = resolveSpend(resolveAllowance(data, period), resolveEarned(data));
        if (spend.blocked) {
            throw new Error(`${OUT_OF_CREDITS}: ${OUT_OF_CREDITS_MESSAGE}`);
        }
        tx.set(
            ref,
            {
                credits: spend.allowance,
                credits_period: period,
                credits_earned: spend.earned,
                credits_updated_at: new Date().toISOString(),
            },
            { merge: true },
        );
    });
}

export type CreditState = { isAdmin: boolean; allowance: number; earned: number; total: number; monthlyFree: number };

/** Fallback credit state for signed-out users and infra errors. Deliberately
 *  reports `earned: 0` rather than guessing — fabricating an earned balance
 *  the user may not have is worse than showing zero (the allowance side
 *  falls back to the full monthly grant, which was already this module's
 *  pre-existing fail-open behavior and is unchanged here). */
export const FALLBACK_CREDIT_STATE: CreditState = {
    isAdmin: false,
    allowance: MONTHLY_FREE_CREDITS,
    earned: 0,
    total: MONTHLY_FREE_CREDITS,
    monthlyFree: MONTHLY_FREE_CREDITS,
};

/** Read-only credit state for the current user, for UI display. */
export async function getCreditState(): Promise<CreditState> {
    try {
        const user = await getServerUser();
        if (!user) return FALLBACK_CREDIT_STATE;
        if (await isAdminUser(user)) {
            return { isAdmin: true, allowance: Infinity, earned: 0, total: Infinity, monthlyFree: MONTHLY_FREE_CREDITS };
        }
        const snap = await getAdminDb().collection("profiles").doc(user.uid).get();
        const data = (snap.exists ? snap.data() : {}) as {
            credits?: number;
            credits_period?: string;
            credits_earned?: number;
        };
        const allowance = resolveAllowance(data, currentPeriod());
        const earned = resolveEarned(data);
        return { isAdmin: false, allowance, earned, total: allowance + earned, monthlyFree: MONTHLY_FREE_CREDITS };
    } catch {
        return FALLBACK_CREDIT_STATE;
    }
}

export type GrantDecision = { write: false } | { write: true; earned: number };

/**
 * The grant decision, pure: given whether this idempotency key has already
 * been recorded and the current earned balance, decide the new balance (or
 * that nothing should be written). A key seen before is a no-op — additive
 * only under a key that hasn't been used.
 */
export function resolveGrant(alreadyGranted: boolean, currentEarned: number, amount: number): GrantDecision {
    if (alreadyGranted) return { write: false };
    return { write: true, earned: currentEarned + amount };
}

const GRANTS_COLLECTION = "credit_grants";

/**
 * Additively credit a user's permanent earned balance. Idempotent on
 * `idempotencyKey`: a grant whose key has already been recorded is a no-op,
 * so a user signing in repeatedly (or a retried request) can never farm the
 * same reward twice. Different keys are independent and additive.
 *
 * Transactional: the grant record and the earned-balance increment are
 * written in the same Firestore transaction, so a crash between "checked
 * the key" and "credited the balance" cannot happen — the key is either
 * fully applied or not applied at all. Errors propagate (no fail-open here):
 * unlike spending, a silently-dropped grant would be a lying fallback for
 * whatever paid it (a referral reward, a purchase).
 */
export async function grantCredits(uid: string, amount: number, reason: string, idempotencyKey: string): Promise<void> {
    const db = getAdminDb();
    const profileRef = db.collection("profiles").doc(uid);
    const grantRef = db.collection(GRANTS_COLLECTION).doc(idempotencyKey);
    await db.runTransaction(async (tx) => {
        const grantSnap = await tx.get(grantRef);
        const profileSnap = await tx.get(profileRef);
        const data = (profileSnap.exists ? profileSnap.data() : {}) as { credits_earned?: number };
        const decision = resolveGrant(grantSnap.exists, resolveEarned(data), amount);
        if (!decision.write) return; // already granted under this key
        tx.set(profileRef, { credits_earned: decision.earned, credits_updated_at: new Date().toISOString() }, { merge: true });
        tx.set(grantRef, { uid, amount, reason, granted_at: new Date().toISOString() });
    });
}

/**
 * The first-sign-in welcome bonus. Credited via `grantCredits`'s own
 * idempotency (key = `welcome:<uid>`) rather than a second "is this a new
 * user" check — safe to call on every sign-in; a no-op after the first.
 */
export async function grantWelcomeCredits(uid: string): Promise<void> {
    await grantCredits(uid, WELCOME_CREDITS, "welcome", `welcome:${uid}`);
}
