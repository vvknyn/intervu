import { getAdminDb } from "@/lib/firebase/admin";
import { revalidatePath } from "next/cache";
import { validate, upsertPursuitSchema } from "@/lib/validation";
import { mergeGuestPursuit, type JobSnapshot, type Pursuit, type PursuitStage } from "@/lib/pursuits/types";

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
        const existingSnap = await db
            .collection("applications")
            .where("user_id", "==", uid)
            .where("job_id", "==", parsed.data.job_id)
            .limit(1)
            .get();

        const now = new Date().toISOString();
        const snapshot: JobSnapshot = {
            title: parsed.data.title,
            company: parsed.data.company,
            location: parsed.data.location,
            description: parsed.data.description,
            apply_url: parsed.data.apply_url,
        };

        if (!existingSnap.empty) {
            const doc = existingSnap.docs[0];
            const existing = { id: doc.id, ...doc.data() } as Pursuit;
            const merged = mergeGuestPursuit(existing, {
                ...existing,
                status: parsed.data.stage,
                job_snapshot: snapshot,
            });
            await doc.ref.update({
                status: merged.status,
                job_snapshot: merged.job_snapshot ?? null,
                updated_at: now,
            });
            revalidatePath("/yours");
            return { data: { ...merged, updated_at: now } };
        }

        const docData = {
            user_id: uid,
            company_name: snapshot.company ?? "",
            position: snapshot.title,
            job_url: snapshot.apply_url || undefined,
            status: parsed.data.stage,
            job_id: parsed.data.job_id,
            job_snapshot: snapshot,
            created_at: now,
            updated_at: now,
        };
        // The Admin SDK rejects `undefined` field values.
        const clean = Object.fromEntries(Object.entries(docData).filter(([, v]) => v !== undefined));

        const docRef = await db.collection("applications").add(clean);
        revalidatePath("/yours");
        return { data: { id: docRef.id, ...clean } as Pursuit };
    } catch (error) {
        console.error("Error upserting pursuit:", error);
        return { error: error instanceof Error ? error.message : "Failed to save pursuit" };
    }
}
