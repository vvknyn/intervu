/**
 * "Save" in the Velai Chrome extension: put the job on the person's tracker
 * as Saved, without saying they applied. The same stage ("interested") the
 * site's "Go after this job" and the MCP `save_job` write, through the same
 * find-or-create chokepoint, so a role already further along keeps its status
 * and the caller can say so (`status` is the role's status after the call).
 *
 * Takes its reads and writes as `deps` (the shape `lib/agent/tools.ts` uses),
 * so `markJobSavedAction` (actions/jobs.ts) hands it the real ones and
 * tests/unit/extension-save.test.ts hands it stubs.
 */
import { buildJobSnapshot, type JobSnapshot, type PursuitStage } from "@/lib/pursuits/types";
import type { PublicJob } from "@/lib/jobs/types";

/** The longest description a pursuit's snapshot keeps (`upsertPursuitSchema`). */
export const SNAPSHOT_DESCRIPTION_MAX = 20_000;

export interface SaveFromExtensionInput {
    company: string;
    title: string;
    /** The page the person is on; may be empty. */
    applyUrl?: string;
    /** Velai's id for the posting, when Velai has it. */
    jobId?: string;
}

export interface SaveFromExtensionDeps {
    /** Velai's copy of a posting, or null when it has none. */
    jobById(id: string): Promise<PublicJob | null>;
    /** The tracker's find-or-create-by-job-id write (`upsertPursuitForJob`). */
    upsert(job: JobSnapshot & { job_id: string }, stage: PursuitStage): Promise<{ data?: { id: string; status: PursuitStage }; error?: string }>;
    /** The person's tracker row for this posting URL, if any (`findTrackedPosting`); throws when nobody is signed in. */
    findTracked(applyUrl: string): Promise<{ id: string; status: PursuitStage } | null>;
    /** A new tracker row for a posting Velai doesn't have (`createApplication`). */
    create(row: { company_name: string; position: string; job_url?: string; status: PursuitStage }): Promise<{ data?: { id?: string }; error?: string }>;
}

export type SaveFromExtensionResult = { data: { id: string; status: PursuitStage } } | { error: string };

export async function saveJobFromExtension(deps: SaveFromExtensionDeps, input: SaveFromExtensionInput): Promise<SaveFromExtensionResult> {
    try {
        if (input.jobId) {
            // Velai's own copy of the posting, as "Go after this job" saves it,
            // so the saved role keeps its description if the listing later expires.
            const job = await deps.jobById(input.jobId).catch(() => null);
            // The snapshot the MCP `save_job` writes (`buildJobSnapshot`); the page's own words when Velai's copy is gone.
            const snapshot: JobSnapshot = job
                ? buildJobSnapshot(job)
                : { title: input.title, company: input.company, location: null, description: null, apply_url: input.applyUrl || "" };
            const res = await deps.upsert(
                {
                    job_id: input.jobId,
                    ...snapshot,
                    description: snapshot.description ? snapshot.description.slice(0, SNAPSHOT_DESCRIPTION_MAX) : snapshot.description,
                    apply_url: snapshot.apply_url || input.applyUrl || "",
                },
                "interested",
            );
            if (res.error || !res.data) return { error: res.error ?? "Failed to save" };
            return { data: { id: res.data.id, status: res.data.status } };
        }

        // A posting Velai doesn't have: the same URL saved again (a second click, a retry, another tab) finds the row the first one made.
        if (input.applyUrl) {
            const tracked = await deps.findTracked(input.applyUrl);
            if (tracked) return { data: { id: tracked.id, status: tracked.status } };
        }
        const created = await deps.create({
            company_name: input.company,
            position: input.title,
            ...(input.applyUrl ? { job_url: input.applyUrl } : {}),
            status: "interested",
        });
        if (created.error) return { error: created.error };
        return { data: { id: created.data?.id ?? "", status: "interested" } };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to save" };
    }
}
