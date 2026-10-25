import { useState } from "react";

/**
 * Whether the rows of a result set should play their entrance.
 *
 * `key` identifies the set (JobsContent's `resultSearchKey`, which changes only
 * when a new first page lands). The first set the page shows is the baseline:
 * it was either server-rendered or the result of a cold load/back navigation,
 * and the product loads into a task, so it never animates. Every later key is
 * a new set. Re-rendering with the same key, or appending pages (no key
 * change), keeps `changes` and so never replays it.
 */
export interface ResultSetTrack {
    key: string | null;
    /** How many times the key moved from one set to another. */
    changes: number;
}

export function nextResultSetTrack(track: ResultSetTrack, key: string | null): ResultSetTrack {
    if (key === track.key) return track;
    return { key, changes: track.key !== null && key !== null ? track.changes + 1 : track.changes };
}

export function useResultSetEnter(key: string | null): { key: string | null; animate: boolean } {
    const [track, setTrack] = useState<ResultSetTrack>({ key, changes: 0 });
    const next = nextResultSetTrack(track, key);
    // Derived state: adjust during render, before paint (React docs, "storing information from previous renders").
    if (next !== track) setTrack(next);
    return { key: next.key, animate: next.changes > 0 };
}
