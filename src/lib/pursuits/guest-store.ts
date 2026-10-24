"use client";

/**
 * Guest pursuits — client-only localStorage store for signed-out "Go after
 * this job" writes (spec §3 "Guests", §7 "Guest→auth merge"). No auth wall:
 * pressing "Go after" while signed out writes here immediately, same
 * pattern as the guest resume draft (`ResumeBuilder.tsx`'s
 * `interview-os-resume-data` key), merged into the server record at sign-in
 * via `syncGuestPursuitsToServer` (`use-pursuits.ts`).
 */

import type { AppliedResume, Pursuit, PursuitStage } from "./types";
import { mergeGuestPursuit, buildJobSnapshot, buildManualPursuitSnapshot } from "./types";
import { appliedResumeFor, attachesResumeOnApply, resumeTextOnFile } from "./resume-on-apply";
import type { PublicJob } from "@/lib/jobs/types";
import { readLocalAiResume } from "@/lib/local-ai/resume-storage";

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

/** A guest's role marked Applied keeps a copy of the résumé on this device
 *  (`./resume-on-apply.ts`); it never leaves the device until sign-in carries
 *  the role into the account. */
function deviceResumeOnApply(
    previous: Pick<Pursuit, "status" | "applied_resume" | "resume_versions"> | null,
    next: PursuitStage | undefined,
    nowIso: string,
): AppliedResume | undefined {
    if (!attachesResumeOnApply(previous, next)) return undefined;
    const stored = readLocalAiResume();
    return appliedResumeFor(previous, next, stored ? resumeTextOnFile({ resume_data: stored.data }) : null, nowIso);
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
 * tracker's "Track a role" sheet (/yours), the one manual-pursuit entry
 * point. Always adds a new pursuit: unlike `addGuestPursuit` there is no
 * job_id to find-or-create by, so a repeat submission is a distinct pursuit
 * by design.
 */
export function addManualGuestPursuit(
    company: string,
    position: string,
    extras?: { status?: PursuitStage; job_url?: string; note?: string },
): Pursuit {
    const now = new Date().toISOString();
    const status = extras?.status ?? "interviewing";
    const pursuit: Pursuit = {
        id: newGuestId("manual"),
        user_id: "guest",
        company_name: company,
        position,
        status,
        job_id: null,
        job_snapshot: buildManualPursuitSnapshot(company, position),
        job_url: extras?.job_url,
        note: extras?.note,
        applied_resume: deviceResumeOnApply(null, status, now),
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
    const now = new Date().toISOString();
    const appliedResume = deviceResumeOnApply(list[i], patch.status, now);
    const updated: Pursuit = { ...list[i], ...patch, ...(appliedResume ? { applied_resume: appliedResume } : {}), updated_at: now };
    write(list.map((p, idx) => (idx === i ? updated : p)));
    return updated;
}

/** Removes the résumé copy a role kept when it was marked Applied. */
export function removeGuestAppliedResume(id: string): Pursuit | null {
    return updateGuestPursuit(id, { applied_resume: undefined });
}

/** Removing the résumé from this device removes the copies its roles kept. */
export function removeGuestAppliedResumes(): void {
    const list = read();
    if (!list.some((p) => p.applied_resume)) return;
    write(
        list.map((p) => {
            if (!p.applied_resume) return p;
            const rest = { ...p };
            delete rest.applied_resume;
            return rest;
        }),
    );
}

export function removeGuestPursuit(id: string): void {
    write(read().filter((p) => p.id !== id));
}

export function clearGuestPursuits(): void {
    write([]);
}

/** Removes exactly the rows named: the ones the account confirmed. Any other row (unconfirmed, or added meanwhile) stays. */
export function removeGuestPursuits(ids: ReadonlySet<string>): void {
    write(read().filter((p) => !ids.has(p.id)));
}
