import type { PublicJob } from "@/lib/jobs/types";
import { buildJobSnapshot, hasReachedStage, type Pursuit, type PursuitStage } from "./types";

export const OPTIMISTIC_PURSUIT_ID_PREFIX = "optimistic-";

export function isOptimisticPursuitId(id: string): boolean {
    return id.startsWith(OPTIMISTIC_PURSUIT_ID_PREFIX);
}

/** Client-only overlay row merged into `pursuitsByJobId` until server confirms. */
export function buildOptimisticPursuit(job: PublicJob, stage: PursuitStage = "interested"): Pursuit {
    const now = new Date().toISOString();
    return {
        id: `${OPTIMISTIC_PURSUIT_ID_PREFIX}${job.id}`,
        user_id: "optimistic",
        company_name: job.company ?? "",
        position: job.title,
        job_url: job.apply_url || undefined,
        status: stage,
        job_id: job.id,
        job_snapshot: buildJobSnapshot(job),
        created_at: now,
        updated_at: now,
    };
}

/** Server row satisfies the optimistic overlay for this job (same or further stage). */
export function isOptimisticConfirmedByServer(optimistic: Pursuit, server: Pursuit | undefined): boolean {
    if (!server || server.job_id !== optimistic.job_id) return false;
    return hasReachedStage(server, optimistic.status);
}

/** Drop overlay entries once authoritative pursuits catch up — keeps UI stable through refetch gaps. */
export function pruneConfirmedOptimisticPursuits(
    overlay: Map<string, Pursuit>,
    serverByJobId: Map<string, Pursuit>,
): Map<string, Pursuit> {
    if (overlay.size === 0) return overlay;
    let changed = false;
    const next = new Map(overlay);
    for (const [jobId, optimistic] of overlay) {
        if (isOptimisticConfirmedByServer(optimistic, serverByJobId.get(jobId))) {
            next.delete(jobId);
            changed = true;
        }
    }
    return changed ? next : overlay;
}
