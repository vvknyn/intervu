/**
 * D6 — per-credential DAILY company-read budget for get_company,
 * get_company_timeline, and search_companies. Same pure-decision/thin-I/O
 * split as `record-budget.ts`, but deliberately NOT sharing code with it:
 * this budget resets at UTC midnight (a calendar-day boundary), while
 * `record-budget.ts` uses a rolling 24h window from first use — a real
 * semantic difference the contract calls for, not an accident.
 *
 * Persisted to identity PG (`intervu.company_read_budgets`, see
 * `deploy/supabase/identity-schema.sql`) via `getIntervuPg()` — the live
 * identity store, not the generated Firestore mirror in `deploy/db-box`.
 * Fails OPEN when `getIntervuPg()` is null (`INTERVU_PG_URL` unset): the
 * same fail-soft-on-missing-env posture every other optional-PG dependency
 * in this codebase takes (see `pg/pool.ts`'s doc comments) — D6 is a
 * cost-control guardrail, not an auth boundary, so an unconfigured store
 * degrades to "unbudgeted" rather than locking every company tool call.
 */
import { AGENT } from "./config";
import type { Queryable } from "../pg/pool";

export interface CompanyReadBudgetState {
    used: number;
    /** Epoch ms of the UTC calendar day `used` is counted against. */
    windowStart: number;
}

export interface CompanyReadBudgetDecision extends CompanyReadBudgetState {
    allowed: boolean;
    remaining: number;
    /** Epoch ms of the next UTC midnight — always `windowStart` + one day. */
    resetAt: number;
}

const DAY_MS = 86_400_000;

function utcDayStartMs(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Pure decision: given the persisted state and the current time, decide
 * whether one more company read is allowed. A stored window that isn't
 * TODAY (in UTC) — including a brand-new credential's `windowStart: 0` — is
 * treated as already expired and rolls over to a fresh 0-used window, never
 * denied.
 */
export function decideCompanyReadBudget(
    state: CompanyReadBudgetState,
    now: number,
    cap: number = AGENT.DAILY_COMPANY_READ_BUDGET,
): CompanyReadBudgetDecision {
    const todayStart = utcDayStartMs(now);
    const expired = state.windowStart !== todayStart;
    const used = expired ? 0 : state.used;
    const windowStart = expired ? todayStart : state.windowStart;
    return {
        used,
        windowStart,
        allowed: used < cap,
        remaining: Math.max(0, cap - used),
        resetAt: windowStart + DAY_MS,
    };
}

/** Names the amount already spent, the cap, and the exact UTC reset time —
 *  actionable for an agent, same spirit as `recordBudgetExceededMessage`. */
export function companyReadBudgetExceededMessage(
    spent: number,
    resetAt: number,
    cap: number = AGENT.DAILY_COMPANY_READ_BUDGET,
): string {
    return (
        `Daily company-read budget reached: this credential has already used ${spent} of ${cap} ` +
        `company reads allowed today (UTC). Resets at ${new Date(resetAt).toISOString()}.`
    );
}

interface CompanyReadBudgetRow {
    used: number;
    window_start: string;
}

async function readState(pg: Queryable, credentialId: string): Promise<CompanyReadBudgetState> {
    const { rows } = await pg.query<CompanyReadBudgetRow>(
        `SELECT used, window_start FROM intervu.company_read_budgets WHERE credential_id = $1`,
        [credentialId],
    );
    const row = rows[0];
    return row ? { used: row.used, windowStart: Date.parse(row.window_start) } : { used: 0, windowStart: 0 };
}

async function writeState(pg: Queryable, credentialId: string, state: CompanyReadBudgetState): Promise<void> {
    await pg.query(
        `INSERT INTO intervu.company_read_budgets (credential_id, used, window_start, updated_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), now())
         ON CONFLICT (credential_id)
         DO UPDATE SET used = EXCLUDED.used, window_start = EXCLUDED.window_start, updated_at = now()`,
        [credentialId, state.used, state.windowStart],
    );
}

/**
 * Consumes one company read for `credentialId` if the daily budget allows
 * it. `pg: null` (identity PG unconfigured) fails open — see this module's
 * doc comment.
 */
export async function consumeCompanyReadBudget(
    pg: Queryable | null,
    credentialId: string,
    now: number = Date.now(),
): Promise<{ ok: true; remaining: number } | { ok: false; error: string }> {
    if (!pg) return { ok: true, remaining: AGENT.DAILY_COMPANY_READ_BUDGET };

    const state = await readState(pg, credentialId);
    const decision = decideCompanyReadBudget(state, now);
    if (!decision.allowed) {
        return { ok: false, error: companyReadBudgetExceededMessage(decision.used, decision.resetAt) };
    }
    const used = decision.used + 1;
    await writeState(pg, credentialId, { used, windowStart: decision.windowStart });
    return { ok: true, remaining: Math.max(0, AGENT.DAILY_COMPANY_READ_BUDGET - used) };
}
