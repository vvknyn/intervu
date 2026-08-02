/**
 * Free-plan daily apply cap (product decision 2026-08-02, launch as
 * free-only): a signed-in user may transition at most `DAILY_APPLY_CAP`
 * pursuits into "applied" per UTC calendar day.
 *
 * Every write path that can set a pursuit's `status` to "applied"
 * (`upsertPursuitForJob` / `createApplication` / `updateApplication` in
 * actions/application.ts, `createApplicationDraft` in actions/applications.ts)
 * calls `isNewAppliedTransition` first and, when it's true, `assertUnderDailyApplyCap`
 * before writing — matched on "does this write set status to applied", not on
 * which function/caller it is, so a future apply-transition surface is
 * covered by calling these helpers rather than by name.
 *
 * Counter storage: a dedicated `apply_counters` collection, one doc per
 * `<uid>_<YYYY-MM-DD>` (UTC day), rather than reading it back from the
 * pursuit records themselves. `upsertPursuitForJob`'s applied transition
 * never stamps `applied_at` (only the manual create paths do — see
 * lib/pursuits/types.ts's `Pursuit.applied_at`, optional and set
 * inconsistently), so the existing pursuit data cannot reliably answer "how
 * many applied today". A dedicated atomic counter, keyed by direct doc id
 * (no query, so no new Firestore composite index), can. This is also kept
 * separate from the `profiles.credits` counter `lib/llm/credit-gate.ts`
 * already meters (LLM spend is a different concern than daily apply volume;
 * piggybacking a second counter onto that doc would conflate the two).
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { stageRank, type PursuitStage } from "@/lib/pursuits/types";

export const DAILY_APPLY_CAP = 20;

/** The friendly, user-facing message for a cap hit. Composed from
 *  `DAILY_APPLY_CAP` so the copy can never drift from the enforced number. */
export function applyCapMessage(cap: number = DAILY_APPLY_CAP): string {
    return `You've hit today's ${cap}-application cap — resets at midnight UTC.`;
}

/** UTC calendar-day key (e.g. "2026-08-02"). Clock is injectable so this
 *  stays pure and testable across a UTC-midnight boundary. */
export function utcDayKey(nowMs: number = Date.now()): string {
    return new Date(nowMs).toISOString().slice(0, 10);
}

/** Pure cap decision: is `count` existing applied-transitions today still
 *  under `cap`? Separated from the Firestore transaction below so "under
 *  cap" / "at cap" are unit-testable without mocking Firestore. */
export function hasCapRoom(count: number, cap: number = DAILY_APPLY_CAP): boolean {
    return count < cap;
}

/**
 * Whether writing `nextStatus` onto a pursuit whose status was
 * `previousStatus` before this write (`undefined` for a brand-new pursuit)
 * is a genuinely NEW transition into "applied" that should consume a cap
 * slot. Re-marking an already-applied (or further along, e.g.
 * "interviewing") pursuit applied again must not double-count — the
 * idempotency rule. Reuses `stageRank`, the same ordering
 * `mergeGuestPursuit` uses for "more advanced", so this can never disagree
 * with the upsert chokepoint about what counts as "already there".
 */
export function isNewAppliedTransition(nextStatus: PursuitStage, previousStatus?: PursuitStage): boolean {
    if (nextStatus !== "applied") return false;
    if (!previousStatus) return true;
    return stageRank(previousStatus) < stageRank("applied");
}

/**
 * Atomically check-and-increment today's applied count for `uid`. Throws a
 * friendly `Error` (never a raw Firestore/transaction error — callers'
 * existing try/catch turns it into their normal `{ error }` return shape)
 * when the cap is already reached; otherwise increments and returns.
 *
 * Callers must only call this when `isNewAppliedTransition(...)` is true —
 * it does not itself know the pursuit's previous stage.
 */
export async function assertUnderDailyApplyCap(uid: string, nowMs: number = Date.now()): Promise<void> {
    const db = getAdminDb();
    const ref = db.collection("apply_counters").doc(`${uid}_${utcDayKey(nowMs)}`);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = (snap.exists ? (snap.data()?.count as number) : 0) || 0;
        if (!hasCapRoom(count)) {
            throw new Error(applyCapMessage());
        }
        tx.set(ref, { count: count + 1, updated_at: new Date(nowMs).toISOString() }, { merge: true });
    });
}
