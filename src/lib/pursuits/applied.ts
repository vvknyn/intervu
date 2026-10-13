/**
 * The roles a person has already applied to, recognised in any list.
 *
 * Before 2026-10-13 a For-you pack and the Search list never consulted the
 * tracker at all, and Today matched by job id only — but the corpus re-lists
 * the same opening under a new id (re-synced, cross-posted), so applied roles
 * "kept coming back", with nothing on the row saying so (review). A role is
 * applied-to when its id has a pursuit at Applied or later, or when it is the
 * same opening as one (`sameRoleKey`: company, title, place), or — for a
 * pursuit saved by hand with no place — the same company and title.
 *
 * Pure and isomorphic.
 */
import { decodeText, locationText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { stageRank, type JobSnapshot, type Pursuit, type PursuitStage } from "./types";

/** A tracker row as any reader holds it: a full `Pursuit`, or the summary the daily picks read (`ApplicationSummary`). */
export interface TrackedLike {
    job_id?: string | null;
    status: PursuitStage;
    position?: string;
    company_name?: string;
    title?: string;
    company?: string | null;
    job_snapshot?: JobSnapshot | null;
}

const norm = (s: string | null | undefined) => decodeText(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function openingKey(company: string | null | undefined, title: string | null | undefined, place: string | null | undefined): string {
    return `${norm(company)}\0${norm(title)}\0${norm(place)}`;
}

function roleKey(company: string | null | undefined, title: string | null | undefined): string {
    return `${norm(company)}\0${norm(title)}`;
}

export interface TrackedIndex<T extends TrackedLike = Pursuit> {
    byId: ReadonlyMap<string, T>;
    byOpening: ReadonlyMap<string, T>;
    /** Company + title, for rows that name no place (saved by hand, or a summary without one). */
    byRole: ReadonlyMap<string, T>;
}

/** Index tracker rows (those at `minStage` or later) for `trackedPursuitFor`. */
export function trackedIndex<T extends TrackedLike = Pursuit>(pursuits: readonly T[], minStage: PursuitStage = "applied"): TrackedIndex<T> {
    const byId = new Map<string, T>();
    const byOpening = new Map<string, T>();
    const byRole = new Map<string, T>();
    for (const p of pursuits) {
        if (stageRank(p.status) < stageRank(minStage)) continue;
        if (p.job_id) byId.set(p.job_id, p);
        const title = p.job_snapshot?.title ?? p.position ?? p.title;
        const company = p.job_snapshot?.company ?? p.company_name ?? p.company;
        if (!norm(title) || !norm(company)) continue;
        const place = p.job_snapshot?.location ?? null;
        if (norm(place)) byOpening.set(openingKey(company, title, place), p);
        else byRole.set(roleKey(company, title), p);
    }
    return { byId, byOpening, byRole };
}

/** The pursuit that says this job (or the same opening) is already tracked at the index's stage, if any. */
export function trackedPursuitFor<T extends TrackedLike>(job: PublicJob, index: TrackedIndex<T>): T | undefined {
    return (
        index.byId.get(job.id) ??
        index.byOpening.get(openingKey(job.company, job.title, locationText(job))) ??
        index.byOpening.get(openingKey(job.company, job.title, job.location)) ??
        index.byRole.get(roleKey(job.company, job.title))
    );
}

export const EMPTY_TRACKED_INDEX: TrackedIndex = trackedIndex<Pursuit>([]);
