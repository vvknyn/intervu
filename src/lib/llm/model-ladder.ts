/**
 * Try a cheaper model first, fall back to one that always answers.
 *
 * Résumé parsing is the reason this exists. It is one of the heaviest prompts
 * in the app (8K characters of someone's CV) and it runs on the shared,
 * app-funded OpenRouter key, so every upload spent real money on
 * `deepseek/deepseek-v4-flash` — a paid model — even though the task is
 * structured extraction that free models handle well. `fetchJSON` retried the
 * SAME model on failure, which is not a ladder: a rate-limited model is still
 * rate-limited a second later.
 *
 * Since 2026-08-23 it is no longer résumé-only: with bring-your-own-key gone,
 * the app funds every generation, so every generation walks the rungs. Callers
 * do not opt in — the one surviving chokepoint, `fetchJSON`,
 * passes `FREE_LADDER` by default.
 *
 * One property matters more than the saving:
 *
 * **The last rung must be paid.** Free models are rate-limited and come and
 * go; a ladder made only of them converts "cheap" into "sometimes the
 * feature doesn't work". The paid tail is what keeps this a cost
 * optimisation rather than a reliability regression.
 *
 * This module is deliberately I/O-free so it can be tested without a provider,
 * a network or firebase-admin: `resolveModelLadder` is the policy, `runLadder`
 * is the walk, and the caller supplies the attempt.
 */

/** One step of the ladder: which model, and how long to wait on it. */
export interface LadderRung {
    model: string;
    timeoutMs: number;
    /** False for every free rung; true for the paid tail. Callers log it. */
    isFallback: boolean;
}

/**
 * Free rungs get less patience than the paid tail. Someone is watching a
 * spinner on their own résumé, and the ladder's worst case is the sum of its
 * rungs — at a flat 60s a three-rung walk could hold a user for three minutes.
 *
 * **This number has to be measured, not guessed.** It was 30s against a first
 * draft of the ladder whose lead model turned out to take 46.3s on a real
 * résumé (see `FREE_LADDER`): the timeout would have killed a
 * working answer mid-flight, so every upload would have paid for the fallback
 * AND eaten 30s of dead wait first — strictly worse than not having a ladder.
 * The shipped rungs measure 15.0s and 17.0s, so 30s is ~1.8x the slowest,
 * enough headroom for a bad day without letting a stalled rung own the request.
 *
 * Re-measure this whenever the ladder changes. In practice free rungs fail
 * instantly (429 / withdrawn slug) and this budget is never spent.
 */
export const FREE_RUNG_TIMEOUT_MS = 30_000;

/** The existing single-model timeout, kept for the rung that has to answer. */
export const PAID_RUNG_TIMEOUT_MS = 60_000;

/**
 * Build the ordered rungs for one generation.
 *
 * The ladder is skipped entirely — a single rung, the config's own model —
 * whenever it cannot be honoured:
 *
 * - **No ladder requested.** Kept as the module's honest zero case: given no
 *   rungs there is nothing to walk. In the app both chokepoints now always
 *   pass `FREE_LADDER`, so this branch is reached only by a direct caller.
 * - **Not OpenRouter.** Another provider has an entirely different
 *   model namespace (not `vendor/model:free`); handing them these slugs would 404 every rung and
 *   turn a working generation into a failure. Their own key, their own model.
 * - **An explicit model override.** If a caller named a model, honour it.
 *
 * The config's own model is always appended as the final rung when the ladder
 * does not already end with it, so the walk can never end on a free model.
 */
export function resolveModelLadder(
    config: { provider: string; model: string },
    ladder?: readonly string[],
    hasExplicitModelOverride = false,
): LadderRung[] {
    const paidTail: LadderRung = {
        model: config.model,
        timeoutMs: PAID_RUNG_TIMEOUT_MS,
        isFallback: true,
    };

    if (!ladder?.length) return [paidTail];
    if (config.provider !== "openrouter") return [paidTail];
    if (hasExplicitModelOverride) return [paidTail];

    const free = ladder
        .filter((model) => model !== config.model)
        .map((model) => ({ model, timeoutMs: FREE_RUNG_TIMEOUT_MS, isFallback: false }));

    return [...free, paidTail];
}

/**
 * Walk the rungs in order and return the first success.
 *
 * Every failure advances — including the "daily limit" and rate-limit errors
 * `fetchJSON` treats as terminal for a single model. On a ladder those are the
 * exact conditions the next rung exists for; only running out of rungs is
 * terminal. The last error is what propagates, since it came from the rung
 * that was supposed to work.
 */
export async function runLadder<T>(
    rungs: readonly LadderRung[],
    attempt: (rung: LadderRung) => Promise<T>,
    onRungFailed?: (rung: LadderRung, error: unknown) => void,
): Promise<T> {
    if (!rungs.length) throw new Error("runLadder called with no rungs");

    let lastError: unknown;
    for (const rung of rungs) {
        try {
            return await attempt(rung);
        } catch (e) {
            lastError = e;
            onRungFailed?.(rung, e);
        }
    }
    throw lastError;
}
