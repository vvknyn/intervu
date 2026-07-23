"use client";

/**
 * Guest pursuits — client-only localStorage store for signed-out "Go after
 * this job" writes (spec §3 "Guests", §7 "Guest→auth merge"). No auth wall:
 * pressing "Go after" while signed out writes here immediately, same
 * pattern as the guest resume draft (`ResumeBuilder.tsx`'s
 * `interview-os-resume-data` key), merged into the server record at sign-in
 * via `syncGuestPursuitsToServer` (`use-pursuits.ts`).
 */

import type { Pursuit, PursuitStage } from "./types";
import { mergeGuestPursuit, buildJobSnapshot, buildManualPursuitSnapshot } from "./types";
import type { PublicJob } from "@/lib/jobs/types";

const STORAGE_KEY = "intervu.pursuits.guest";

// In-tab change notification. Guest pursuits can be written from any
// mounted component (JobDetail's "Go after"), and other mounted components
// (TopBar's "Yours" link visibility, an open /yours tab) need to react
// without a shared server round-trip — same shape as `use-pursuits.ts`'s own
// listener set for the signed-in cache.
const listeners = new Set<() => void>();

export function subscribeGuestPursuits(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(): void {
    listeners.forEach((cb) => cb());
}

function read(): Pursuit[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Pursuit[]) : [];
    } catch {
        return [];
    }
}

function write(list: Pursuit[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        /* quota exceeded / private mode — the pursuit stays interested-only
           in memory for this tab; non-critical. */
    }
    notify();
}

function newGuestId(jobId: string): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `guest-${jobId}-${Date.now()}`;
}

export function listGuestPursuits(): Pursuit[] {
    return read();
}

export function hasAnyGuestPursuits(): boolean {
    return read().length > 0;
}

/**
 * Add (or upgrade) the guest pursuit for `job`. Re-adding the same job_id
 * merges through `mergeGuestPursuit` — the same "keep the more advanced
 * stage" rule the server upsert uses — so a repeat "Go after" click can
 * never downgrade an already-advanced guest pursuit.
 */
export function addGuestPursuit(job: PublicJob, status: PursuitStage = "interested"): Pursuit {
    const list = read();
    const i = list.findIndex((p) => p.job_id === job.id);
    const now = new Date().toISOString();
    const incoming: Pursuit = {
        id: i === -1 ? newGuestId(job.id) : list[i].id,
        user_id: "guest",
        company_name: job.company ?? "",
        position: job.title,
        job_url: job.apply_url || undefined,
        status,
        job_id: job.id,
        job_snapshot: buildJobSnapshot(job),
        created_at: i === -1 ? now : list[i].created_at,
        updated_at: now,
    };
    const merged = i === -1 ? incoming : mergeGuestPursuit(list[i], incoming);
    const next = i === -1 ? [...list, merged] : list.map((p, idx) => (idx === i ? merged : p));
    write(next);
    return merged;
}

/**
 * Guest counterpart to `createManualPursuit` (actions/application.ts) — the
 * search seed line (spec §3 "outside interviews"). Always adds a new
 * pursuit: unlike `addGuestPursuit` there is no job_id to find-or-create by,
 * so a repeat seed submission is a distinct pursuit by design.
 */
export function addManualGuestPursuit(company: string, position: string): Pursuit {
    const now = new Date().toISOString();
    const pursuit: Pursuit = {
        id: newGuestId("manual"),
        user_id: "guest",
        company_name: company,
        position,
        status: "interviewing",
        job_id: null,
        job_snapshot: buildManualPursuitSnapshot(company, position),
        created_at: now,
        updated_at: now,
    };
    write([...read(), pursuit]);
    return pursuit;
}

/** Patch an existing guest pursuit by id (e.g. setting an interview date). */
export function updateGuestPursuit(id: string, patch: Partial<Pursuit>): Pursuit | null {
    const list = read();
    const i = list.findIndex((p) => p.id === id);
    if (i === -1) return null;
    const updated: Pursuit = { ...list[i], ...patch, updated_at: new Date().toISOString() };
    write(list.map((p, idx) => (idx === i ? updated : p)));
    return updated;
}

export function removeGuestPursuit(id: string): void {
    write(read().filter((p) => p.id !== id));
}

export function clearGuestPursuits(): void {
    write([]);
}
