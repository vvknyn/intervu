/**
 * Views recorded on this page since the viewed-jobs list was read.
 *
 * `useViewed` reads `job_views` once per session (the shared
 * `createServerListCache`), and `recordJobViewAction` is fire-and-forget, so
 * a job opened after that read never reaches the cached list: Recently
 * viewed on the packs hub and /yours/history would only catch up on the next
 * page load. Each open is noted here as well, and `mergeSessionViews` folds
 * the notes over the server rows, so a just-opened job leads the list at
 * once.
 *
 * Deliberately NOT part of `viewedIds` (the SERP hide-viewed filter and row
 * dimming): a row opened in a pack's list must not vanish from that list
 * mid-session. `openJob` marks its own SERP opens there already.
 *
 * Pure fold + a tiny module store (no DOM, no React) — the fold is
 * unit-tested directly.
 */

import type { JobSnapshot } from "@/lib/pursuits/types";
import { orderJobViewsLatestFirst, type JobView } from "@/lib/views/types";

export interface SessionView {
    job_id: string;
    /** When it was opened on this page (ISO). */
    viewed_at: string;
    job_snapshot: JobSnapshot;
}

/**
 * Server rows with this page's opens folded over them, newest first. A job
 * the server already has keeps its identity and `first_viewed_at`, takes the
 * newer `last_viewed_at` and snapshot, and counts this page's open once (the
 * write it stands in for is still in flight). A job the server does not have
 * yet becomes a row of its own.
 */
export function mergeSessionViews(server: JobView[], session: SessionView[]): JobView[] {
    if (session.length === 0) return server;
    const byJob = new Map(server.map((v) => [v.job_id, v]));
    for (const s of session) {
        const existing = byJob.get(s.job_id);
        if (!existing) {
            byJob.set(s.job_id, {
                id: `session_${s.job_id}`,
                user_id: "",
                job_id: s.job_id,
                first_viewed_at: s.viewed_at,
                last_viewed_at: s.viewed_at,
                view_count: 1,
                job_snapshot: s.job_snapshot,
            });
        } else if (Date.parse(s.viewed_at) > Date.parse(existing.last_viewed_at)) {
            byJob.set(s.job_id, {
                ...existing,
                last_viewed_at: s.viewed_at,
                view_count: existing.view_count + 1,
                job_snapshot: s.job_snapshot,
            });
        }
    }
    return orderJobViewsLatestFirst([...byJob.values()]);
}

const EMPTY: SessionView[] = [];
let sessionViews: SessionView[] = EMPTY;
const listeners = new Set<() => void>();

/**
 * Note an open. Returns true the first time a job is noted on this page —
 * the caller's cue to send the server write, which is idempotent per job but
 * would otherwise bump `view_count` on every re-click.
 */
export function noteSessionView(jobId: string, snapshot: JobSnapshot, now: Date = new Date()): boolean {
    const id = jobId.trim();
    if (!id) return false;
    const first = !sessionViews.some((v) => v.job_id === id);
    sessionViews = [
        { job_id: id, viewed_at: now.toISOString(), job_snapshot: snapshot },
        ...sessionViews.filter((v) => v.job_id !== id),
    ];
    listeners.forEach((cb) => cb());
    return first;
}

export function subscribeSessionViews(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

export function getSessionViewsSnapshot(): SessionView[] {
    return sessionViews;
}

export function getSessionViewsServerSnapshot(): SessionView[] {
    return EMPTY;
}

/** Test seam — the store is module state. */
export function resetSessionViewsForTest(): void {
    sessionViews = EMPTY;
}
