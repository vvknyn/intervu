import { loaded, readWithRetry, settleEnvelope, type LoadResult } from "@/lib/load-result";

/**
 * Module-level read cache for a signed-in account list (pursuits, follows,
 * saved searches, viewed jobs): one fetch shared by every mounted consumer,
 * in-flight dedup, and a listener set so a mutation's `invalidate()` makes
 * every consumer re-read. Only a successful read is cached — a failed read
 * resolves `{ ok: false }` and the next `fetch()` (Retry) asks again, where
 * each hook used to cache `[]` for the session.
 */
export interface ServerListCache<T> {
    peek(): T[] | null;
    fetch(): Promise<LoadResult<T[]>>;
    invalidate(): void;
    subscribe(cb: () => void): () => void;
}

export function createServerListCache<T>(
    read: () => Promise<{ data?: T[] | null; error?: string | null }>,
): ServerListCache<T> {
    let cache: T[] | null = null;
    let inflight: Promise<LoadResult<T[]>> | null = null;
    const listeners = new Set<() => void>();

    return {
        peek: () => cache,
        fetch() {
            if (cache) return Promise.resolve(loaded(cache));
            if (!inflight) {
                inflight = readWithRetry(() => settleEnvelope(read()))
                    .then((res) => {
                        if (res.ok) cache = res.data;
                        return res;
                    })
                    .finally(() => {
                        inflight = null;
                    });
            }
            return inflight;
        },
        invalidate() {
            cache = null;
            inflight = null;
            listeners.forEach((cb) => cb());
        },
        subscribe(cb) {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
    };
}
