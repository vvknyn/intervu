/**
 * Persisted per-credential daily budget on job RECORDS returned across
 * every corpus-reading tool (search_jobs, get_job — see tools.ts), keyed by
 * the ACTUAL number of records a call is about to hand back, never the
 * requested page size. This is the harvesting guardrail `rate-limit.ts`
 * can't provide on its own: that limiter bounds CALLS per hour, and
 * 300 calls/hr x RESULT_CAP(20)/call is ~144,000 records/day, sustained
 * indefinitely — a viable slow-exfiltration path against a multi-million-
 * row corpus. See `AGENT.DAILY_RECORD_BUDGET`'s doc comment for the number.
 *
 * MUST be persisted (via the same `AgentStore` credentials/OAuth clients
 * already use — store.ts), never in-memory: this app redeploys often, and
 * an in-memory daily counter resets to zero on every deploy, which an
 * attacker harvesting over days/weeks can simply wait out.
 *
 * `decideRecordBudget` is the pure decision (unit-testable without a
 * store); `consumeRecordBudget` is the thin I/O wrapper that reads/writes
 * the one persisted doc per credential.
 */
import type { AgentStore } from "./store";
import { AGENT } from "./config";
import { logAgentLimit, truncateCredential } from "./log";

export interface RecordBudgetState {
    used: number;
    windowStart: number;
}

export interface RecordBudgetDecision extends RecordBudgetState {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

/**
 * Pure: given the last persisted state and the current time, decides
 * whether another record may be consumed. A window older than
 * `AGENT.RECORD_BUDGET_WINDOW_MS` (including a brand-new credential, whose
 * `windowStart` defaults to 0 — `now - 0` is always past the window) rolls
 * over to a fresh window with `used` reset to 0, so no separate "first ever
 * call" branch is needed.
 */
export function decideRecordBudget(
    state: RecordBudgetState,
    now: number,
    cap: number = AGENT.DAILY_RECORD_BUDGET,
): RecordBudgetDecision {
    const expired = now - state.windowStart >= AGENT.RECORD_BUDGET_WINDOW_MS;
    const used = expired ? 0 : state.used;
    const windowStart = expired ? now : state.windowStart;
    return {
        used,
        windowStart,
        allowed: used < cap,
        remaining: Math.max(0, cap - used),
        resetAt: windowStart + AGENT.RECORD_BUDGET_WINDOW_MS,
    };
}

/** The one MCP-facing message for an exhausted daily record budget — read
 *  by an agent, not a human, so it names the cap, how much of it is already
 *  spent, and the exact reset time rather than reading as a bare 429. */
export function recordBudgetExceededMessage(
    spent: number,
    resetAt: number,
    cap: number = AGENT.DAILY_RECORD_BUDGET,
): string {
    return (
        `Daily corpus budget reached: this credential has already returned ${spent} of ${cap} job records ` +
        `allowed in a rolling 24h window. Resets at ${new Date(resetAt).toISOString()}. This protects the ` +
        "job corpus from bulk harvesting — a normal search/browse session stays well under it."
    );
}

/**
 * Reads the credential's persisted usage, decides, and — only when
 * `count > 0` and still under budget — writes the incremented usage back.
 * `count <= 0` is always allowed and never touches the store: a call that
 * exposes zero records (e.g. a zero-hit search) has nothing to meter and
 * must never be blocked by an already-exhausted budget for that reason.
 */
export async function consumeRecordBudget(
    store: AgentStore,
    credentialId: string,
    count: number,
    now: number = Date.now(),
): Promise<{ ok: true; remaining: number } | { ok: false; error: string; resetAt: number }> {
    if (count <= 0) return { ok: true, remaining: AGENT.DAILY_RECORD_BUDGET };

    const doc = await store.get(AGENT.collections.recordBudgets, credentialId);
    const state: RecordBudgetState = {
        used: typeof doc?.used === "number" ? doc.used : 0,
        windowStart: typeof doc?.windowStart === "number" ? doc.windowStart : 0,
    };
    const decision = decideRecordBudget(state, now);
    if (!decision.allowed) {
        logAgentLimit("agent-record-budget", "EXHAUSTED", {
            credential: truncateCredential(credentialId),
            spent: decision.used,
            cap: AGENT.DAILY_RECORD_BUDGET,
            resetAt: new Date(decision.resetAt).toISOString(),
        });
        return {
            ok: false,
            error: recordBudgetExceededMessage(decision.used, decision.resetAt),
            resetAt: decision.resetAt,
        };
    }

    const used = decision.used + count;
    await store.set(AGENT.collections.recordBudgets, credentialId, { used, windowStart: decision.windowStart });
    return { ok: true, remaining: Math.max(0, AGENT.DAILY_RECORD_BUDGET - used) };
}
