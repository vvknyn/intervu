/**
 * The one result type for a client read that a list or count renders from.
 * A failed read and an empty read are different facts: a caller that turns
 * a failure into `[]`/`{}`/`0` renders "nothing here" for a request that
 * never answered (Sep 28: a 503 on the For-you action showed
 * "No ranked roles to show right now."). Surfaces branch on `ok` and render
 * `LoadFailedState` (components/ui/load-failed-state.tsx) on failure.
 */
export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function loaded<T>(data: T): LoadResult<T> {
    return { ok: true, data };
}

export function loadFailed(error: unknown): { ok: false; error: string } {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * Settle a server action's `{ data } | { error }` envelope. A throw (503,
 * aborted POST, stale action id), an `error`, or a missing `data` is a
 * failure — never an empty list.
 */
export async function settleEnvelope<T>(
    call: Promise<{ data?: T | null; error?: string | null }>,
): Promise<LoadResult<T>> {
    try {
        const res = await call;
        if (res.error) return loadFailed(res.error);
        if (res.data == null) return loadFailed("response carried no data");
        return loaded(res.data);
    } catch (e) {
        return loadFailed(e);
    }
}

/** The automatic retry waits RETRY_BASE_MS plus up to RETRY_JITTER_MS. */
export const RETRY_BASE_MS = 2000;
export const RETRY_JITTER_MS = 2000;

/** Jittered delay so clients that failed together do not retry together. */
export function retryDelayMs(random: () => number = Math.random): number {
    return RETRY_BASE_MS + Math.floor(random() * RETRY_JITTER_MS);
}

/**
 * One automatic retry after a jittered delay, then the failure goes to the
 * caller (which renders Retry). Idempotent reads ONLY — never a write.
 */
export async function readWithRetry<T>(
    read: () => Promise<LoadResult<T>>,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<LoadResult<T>> {
    const first = await read();
    if (first.ok) return first;
    await sleep(retryDelayMs());
    return read();
}
