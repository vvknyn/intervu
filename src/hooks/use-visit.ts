"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
    TODAY_SESSION_GAP_MS,
    readTodaySeen,
    readTodayVisit,
    resolveTodaySince,
    writeTodayVisit,
} from "@/lib/jobs/for-you/today";

/** This sitting's visit baseline and the roles this device had listed before it, read once per sitting. */
type VisitMemo = { at: number; visit: ReturnType<typeof resolveTodaySince>; seenBefore: ReadonlySet<string> | null };
let visitMemo: VisitMemo | null = null;

const subscribeNever = () => () => {};

/** Read once per sitting: a return after a break of TODAY_SESSION_GAP_MS is a new sitting. */
function visitSnapshot(): VisitMemo {
    const nowMs = Date.now();
    if (!visitMemo || nowMs - visitMemo.at >= TODAY_SESSION_GAP_MS) {
        visitMemo = { at: nowMs, visit: resolveTodaySince(readTodayVisit(), nowMs), seenBefore: readTodaySeen() };
    }
    return visitMemo;
}

/**
 * When this device last opened the jobs board (`resolveTodaySince`), read once per sitting and recorded for the
 * next visit. Client-only: the server render has no device store, so it reports nothing until hydrated.
 */
export function useVisit(): { hydrated: boolean; sinceMs: number | null; nowMs: number; seenBefore: ReadonlySet<string> | null } {
    const memo = useSyncExternalStore(subscribeNever, visitSnapshot, () => null);
    useEffect(() => {
        if (memo) writeTodayVisit(memo.visit.next);
    }, [memo]);
    return { hydrated: memo != null, sinceMs: memo?.visit.sinceMs ?? null, nowMs: memo?.at ?? 0, seenBefore: memo?.seenBefore ?? null };
}
