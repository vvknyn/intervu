"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { revalidatePath } from "next/cache";
import { validate, updateApplicationSchema, createManualPursuitSchema } from "@/lib/validation";
import {
    buildManualPursuitSnapshot,
    type JobSnapshot,
    type Pursuit as PursuitType,
    type PursuitStage,
} from "@/lib/pursuits/types";
import { upsertPursuitCore } from "@/lib/pursuits/upsert-core";
import { isNewAppliedTransition, assertUnderDailyApplyCap } from "@/lib/pursuits/apply-cap";
import type { PublicJob } from "@/lib/jobs/types";

// `Pursuit`/`PursuitStage` (src/lib/pursuits/types.ts) are the single source
// of truth for this collection's shape. Kept as a local alias for this
// module's internal use only — NOT exported. A "use server" module may only
// export async functions; a `export type {...}` re-export here survives
// Turbopack's server-action codegen as a broken runtime binding (importers
// must pull the type from @/lib/pursuits/types directly).
type Application = PursuitType;

export interface CreateApplicationData {
    company_name: string;
    position: string;
    job_url?: string;
    applied_at?: string;
    status: PursuitStage;
    resume_version_id?: string;
    cover_letter?: string;
    note?: string;
}

export interface UpdateApplicationData {
    company_name?: string;
    position?: string;
    job_url?: string;
    applied_at?: string;
    status?: PursuitStage;
    resume_version_id?: string;
    cover_letter?: string;
    interview_date?: string;
    note?: string;
}

export async function getApplications() {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        const db = getAdminDb();
        const snapshot = await db
            .collection("applications")
            .where("user_id", "==", user.uid)
            .orderBy("created_at", "desc")
            .get();

        const applications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Application[];

        // Fetch resume version names for applications that have resume_version_id
        const resumeVersionIds = applications
            .map(app => app.resume_version_id)
            .filter((id): id is string => !!id);

        if (resumeVersionIds.length > 0) {
            const uniqueIds = [...new Set(resumeVersionIds)];
            const versionMap: Record<string, string> = {};

            // Firestore 'in' queries support up to 30 values at a time
            for (let i = 0; i < uniqueIds.length; i += 30) {
                const batch = uniqueIds.slice(i, i + 30);
                const resumeSnap = await db
                    .collection("tailored_resumes")
                    .where("__name__", "in", batch)
                    .get();
                resumeSnap.docs.forEach(doc => {
                    const data = doc.data();
                    versionMap[doc.id] = data.version_name || "";
                });
            }

            applications.forEach(app => {
                if (app.resume_version_id && versionMap[app.resume_version_id] !== undefined) {
                    app.resume_version = { version_name: versionMap[app.resume_version_id] };
                } else {
                    app.resume_version = null;
                }
            });
        } else {
            applications.forEach(app => {
                app.resume_version = null;
            });
        }

        return { data: applications };
    } catch (error) {
        console.error("Error fetching applications:", error);
        return { error: error instanceof Error ? error.message : "Failed to fetch applications" };
    }
}

export async function createApplication(application: CreateApplicationData) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        // A fresh create has no prior stage, so this is always a NEW applied
        // transition when the caller is creating one directly (free-plan cap).
        if (isNewAppliedTransition(application.status, undefined)) {
            await assertUnderDailyApplyCap(user.uid);
        }

        const db = getAdminDb();
        const now = new Date().toISOString();
        const docData = {
            ...application,
            user_id: user.uid,
            created_at: now,
            updated_at: now,
        };

        const docRef = await db.collection("applications").add(docData);
        const data = { id: docRef.id, ...docData };

        revalidatePath('/yours');
        return { data };
    } catch (error) {
        console.error("Error creating application:", error);
        return { error: error instanceof Error ? error.message : "Failed to create application" };
    }
}

export async function updateApplication(id: string, updates: UpdateApplicationData) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        // Validate/normalize the client-supplied payload (rejects unknown keys,
        // bad statuses, malformed URLs, oversize fields) before it touches the DB.
        const parsed = validate(updateApplicationSchema, updates);
        if (!parsed.ok) return { error: parsed.error };

        const db = getAdminDb();
        const docRef = db.collection("applications").doc(id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Application not found" };
        }

        // Free-plan daily apply cap: only consume a slot when this update is
        // itself the transition into "applied" (idempotent re-marks of an
        // already-applied-or-further pursuit are free — see isNewAppliedTransition).
        if (parsed.data.status && isNewAppliedTransition(parsed.data.status, doc.data()?.status as PursuitStage | undefined)) {
            await assertUnderDailyApplyCap(user.uid);
        }

        // The Admin SDK rejects `undefined` field values (ignoreUndefinedProperties
        // is off), and the schema normalizes cleared optionals to undefined — strip
        // them so update() only carries fields the client actually supplied.
        const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(parsed.data)) {
            if (v !== undefined) updateData[k] = v;
        }

        await docRef.update(updateData);

        const updated = await docRef.get();
        const data = { id: updated.id, ...updated.data() };

        revalidatePath('/yours');
        return { data };
    } catch (error) {
        console.error("Error updating application:", error);
        return { error: error instanceof Error ? error.message : "Failed to update application" };
    }
}

/**
 * The find-or-create-by-job_id chokepoint every "this job is now (at least)
 * this far along" write funnels through — `goAfterJobAction` (stage
 * "interested") and `markJobAppliedAction` (stage "applied", see
 * actions/jobs.ts) both call this instead of writing the collection
 * directly, so there is exactly one place that decides "does a pursuit for
 * this job already exist, and if so does this write actually advance it."
 *
 * Reuses `mergeGuestPursuit` for that decision — the same "keep the more
 * advanced stage" rule the guest→auth merge uses — so a re-click (or a
 * stale mark-applied firing after the user already tailored/interviewed)
 * can never regress an already-advanced pursuit.
 */
export async function upsertPursuitForJob(
    job: JobSnapshot & { job_id: string },
    stage: PursuitStage,
): Promise<{ data?: Application; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    return upsertPursuitCore(user.uid, job, stage);
}

/** "Go after this job" (spec §3) — the single verb on every job page.
 *  Always stage "interested"; `upsertPursuitForJob` handles a job the user
 *  already progressed further on (never downgrades). */
export async function goAfterJobAction(job: PublicJob): Promise<{ data?: Application; error?: string }> {
    return upsertPursuitForJob(
        {
            job_id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description,
            apply_url: job.apply_url,
        },
        "interested",
    );
}

/**
 * The tracker's "Track a role" sheet (/yours): creates a pursuit straight
 * from typed company/role — no job card, no job_id. Unlike
 * `upsertPursuitForJob` there is nothing to find-or-create by, so this
 * always creates (same company + role twice is two distinct pursuits, per
 * spec §7).
 *
 * `status` is passed by that sheet (its select defaults to "applied"), and
 * `syncGuestPursuitsToServer` (use-pursuits.ts) passes it too, so a guest's
 * manual pursuit carries through at whatever stage they'd already advanced
 * it to before signing in. The "interviewing" default below is what a caller
 * that names no stage at all gets — the stage a hand-entered role most often
 * means.
 */
export async function createManualPursuit(
    input: { company: string; position: string; status?: PursuitStage; job_url?: string; note?: string },
): Promise<{ data?: Application; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const parsed = validate(createManualPursuitSchema, input);
        if (!parsed.ok) return { error: parsed.error };

        const db = getAdminDb();
        const now = new Date().toISOString();
        const snapshot = buildManualPursuitSnapshot(parsed.data.company, parsed.data.position);
        const docData: Record<string, unknown> = {
            user_id: user.uid,
            company_name: snapshot.company ?? "",
            position: snapshot.title,
            status: parsed.data.status ?? "interviewing",
            job_id: null,
            job_snapshot: snapshot,
            created_at: now,
            updated_at: now,
        };
        if (parsed.data.job_url) docData.job_url = parsed.data.job_url;
        if (parsed.data.note) docData.note = parsed.data.note;

        const docRef = await db.collection("applications").add(docData);
        revalidatePath("/yours");
        return { data: { id: docRef.id, ...docData } as Application };
    } catch (error) {
        console.error("Error creating manual pursuit:", error);
        return { error: error instanceof Error ? error.message : "Failed to create pursuit" };
    }
}

export async function deleteApplication(id: string) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        const db = getAdminDb();
        const docRef = db.collection("applications").doc(id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Application not found" };
        }

        await docRef.delete();

        revalidatePath('/yours');
        return { success: true };
    } catch (error) {
        console.error("Error deleting application:", error);
        return { error: error instanceof Error ? error.message : "Failed to delete application" };
    }
}
