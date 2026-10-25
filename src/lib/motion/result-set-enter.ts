import { useEffect, useState } from "react";
import { MOTION_DURATION_MS, MOTION_STAGGER_MS } from "@/lib/motion/interaction-contract";

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

/** Last staggered row (8th, 7 steps in) finishing its enter; after this the class comes off. */
export const RESULT_SET_ENTER_WINDOW_MS = MOTION_STAGGER_MS * 7 + MOTION_DURATION_MS.enter;

/**
 * The entrance plays only inside the window after a NEW set key: `settled` is
 * the `changes` count whose window has closed. A same-key re-render, a dismiss,
 * a cluster expand or an append leaves `changes` alone, so they stay off.
 */
export function isEntering(changes: number, settled: number): boolean {
    return changes > 0 && settled !== changes;
}

export function useResultSetEnter(key: string | null): boolean {
    const [track, setTrack] = useState<ResultSetTrack>({ key, changes: 0 });
    const [settled, setSettled] = useState(0);
    const next = nextResultSetTrack(track, key);
    // Derived state: adjust during render, before paint (React docs, "storing information from previous renders").
    if (next !== track) setTrack(next);
    const { changes } = next;
    useEffect(() => {
        if (changes === 0) return;
        const t = setTimeout(() => setSettled(changes), RESULT_SET_ENTER_WINDOW_MS);
        return () => clearTimeout(t);
    }, [changes]);
    return isEntering(changes, settled);
}
