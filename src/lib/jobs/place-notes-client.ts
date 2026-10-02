/**
 * The browser's read of `/api/jobs/place-notes`: where a few postings'
 * descriptions say the person must be. Bounded by a deadline so a slow read
 * never holds a list back; `null` on a failed or late read, and the list
 * goes on with what its rows say.
 */
import type { PlaceRestriction } from "./types";

export async function fetchPlaceNotes(ids: string[], deadlineMs: number): Promise<Record<string, PlaceRestriction | null> | null> {
    if (ids.length === 0) return {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
        const res = await fetch("/api/jobs/place-notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { notes?: Record<string, PlaceRestriction | null> };
        return body.notes ?? null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
