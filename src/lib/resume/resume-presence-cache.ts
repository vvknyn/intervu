/**
 * One shared read of "is a résumé on file" per account: every subscriber on a
 * page (the list, the header's and the tab bar's Connect label) asks, and one
 * server round trip answers them all. A read in flight is shared; an answer is
 * kept for `ttlMs`, so a subscriber that mounts a moment later does not ask
 * again. A failed read is not kept: the next ask tries again. Server actions
 * run one at a time, so each duplicate also delayed the ones queued behind it.
 */
export interface ResumePresenceCache {
    /** The kept answer for `uid`, or `null` when none is fresh. */
    peek(uid: string): boolean | null;
    /** An answer the server already gave (the page's first render), kept like a read. */
    seed(uid: string, hasResume: boolean): void;
    read(uid: string): Promise<boolean>;
}

export const RESUME_PRESENCE_TTL_MS = 10_000;

export function createResumePresenceCache(
    fetchPresence: () => Promise<boolean>,
    now: () => number = Date.now,
    ttlMs = RESUME_PRESENCE_TTL_MS,
): ResumePresenceCache {
    const answers = new Map<string, { hasResume: boolean; at: number }>();
    const inflight = new Map<string, Promise<boolean>>();

    const peek = (uid: string): boolean | null => {
        const kept = answers.get(uid);
        return kept && now() - kept.at < ttlMs ? kept.hasResume : null;
    };
    const seed = (uid: string, hasResume: boolean) => {
        answers.set(uid, { hasResume, at: now() });
    };
    return {
        peek,
        seed,
        read(uid) {
            const kept = peek(uid);
            if (kept !== null) return Promise.resolve(kept);
            let pending = inflight.get(uid);
            if (!pending) {
                pending = fetchPresence()
                    .then((hasResume) => {
                        seed(uid, hasResume);
                        return hasResume;
                    })
                    .finally(() => inflight.delete(uid));
                inflight.set(uid, pending);
            }
            return pending;
        },
    };
}
