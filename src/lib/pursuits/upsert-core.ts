import { getAdminDb } from "@/lib/firebase/admin";
import { revalidatePath } from "next/cache";
import { validate, upsertPursuitSchema } from "@/lib/validation";
import { appliedAtForTransition } from "@/lib/pursuits/applied-at";
import { mergeGuestPursuit, type JobSnapshot, type Pursuit, type PursuitStage } from "@/lib/pursuits/types";

/**
 * Recursively drop `undefined` values from plain objects and arrays — the
 * Admin SDK rejects `undefined` field values at ANY depth, not just the top
 * level (e.g. a nested `job_snapshot.description` is `undefined` when the
 * source listing wasn't hydrated at save time — see `JobSnapshot.description`'s
 * doc comment). Plain objects are recursed into; arrays are mapped; `null`,
 * `Date`, Firestore `Timestamp`/`FieldValue` sentinels, and other class
 * instances pass through unchanged (their prototype isn't `Object.prototype`).
 */
export function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
    }
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            if (v === undefined) continue;
            out[key] = stripUndefinedDeep(v);
        }
        return out as T;
    }
    return value;
}

/**
 * Find the caller's own pursuit for a job_id, or `null` if none exists yet —
 * the ONE place the `user_id == uid AND job_id == jobId` query is written.
 * `upsertPursuitCore` below uses it as its find-half; callers that need to
 * know "does a pursuit already exist for this job" WITHOUT creating one
 * (e.g. the MCP `get_resume_variant` tool, `ToolDeps.findPursuitByJobId` in
 * `lib/agent/tools.ts`) call this directly instead of duplicating the query.
 */
export async function findPursuitByJobId(uid: string, jobId: string): Promise<Pursuit | null> {
    const db = getAdminDb();
    const snap = await db
        .collection("applications")
        .where("user_id", "==", uid)
        .where("job_id", "==", jobId)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Pursuit;
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
 *
 * Cookie-free by design (plain module, not "use server"): callers supply
 * `uid` directly, so bearer-token callers (MCP tools) and cookie-session
 * callers (`upsertPursuitForJob` in actions/application.ts) share this exact
 * logic without either depending on the other's auth mechanism.
 */
export async function upsertPursuitCore(
    uid: string,
    job: JobSnapshot & { job_id: string },
    stage: PursuitStage,
): Promise<{ data?: Pursuit; error?: string }> {
    try {
        const parsed = validate(upsertPursuitSchema, { ...job, stage });
        if (!parsed.ok) return { error: parsed.error };

        const db = getAdminDb();
        const existing = await findPursuitByJobId(uid, parsed.data.job_id);

        const now = new Date().toISOString();
        const snapshot: JobSnapshot = {
            title: parsed.data.title,
            company: parsed.data.company,
            location: parsed.data.location,
            description: parsed.data.description,
            apply_url: parsed.data.apply_url,
        };

        if (existing) {
            const merged = mergeGuestPursuit(existing, {
                ...existing,
                status: parsed.data.stage,
                job_snapshot: snapshot,
            });
            const appliedAt = appliedAtForTransition(existing, merged.status, now);
            await db.collection("applications").doc(existing.id).update(
                stripUndefinedDeep({
                    status: merged.status,
                    job_snapshot: merged.job_snapshot ?? null,
                    updated_at: now,
                    applied_at: appliedAt,
                }),
            );
            revalidatePath("/yours");
            return { data: { ...merged, ...(appliedAt ? { applied_at: appliedAt } : {}), updated_at: now } };
        }

        const docData = {
            user_id: uid,
            company_name: snapshot.company ?? "",
            position: snapshot.title,
            job_url: snapshot.apply_url || undefined,
            status: parsed.data.stage,
            job_id: parsed.data.job_id,
            job_snapshot: snapshot,
            applied_at: appliedAtForTransition(null, parsed.data.stage, now),
            created_at: now,
            updated_at: now,
        };
        // The Admin SDK rejects `undefined` field values, at any depth.
        const clean = stripUndefinedDeep(docData);

        const docRef = await db.collection("applications").add(clean);
        revalidatePath("/yours");
        return { data: { id: docRef.id, ...clean } as Pursuit };
    } catch (error) {
        console.error("Error upserting pursuit:", error);
        return { error: error instanceof Error ? error.message : "Failed to save pursuit" };
    }
}
