"use server";

/**
 * job_views — "jobs this signed-in user has opened" (viewed-jobs history,
 * distinct from `recordJobOpenedAction` in actions/jobs.ts: that's per-open
 * search-position telemetry, an analytics log with no per-user identity or
 * cap; this is an idempotent per-user-per-job row the SERP filter and the
 * /yours/history page both read back).
 *
 * Doc id `${uid}_${jobId}` makes the write idempotent by construction — a
 * re-open of the same job updates the existing row instead of growing a log,
 * so no chunking/pagination is ever needed on the write side.
 */

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { validate, recordJobViewSchema } from "@/lib/validation";
import type { JobSnapshot } from "@/lib/pursuits/types";
import { stripUndefinedDeep } from "@/lib/pursuits/upsert-core";
import { orderJobViewsLatestFirst, type JobView } from "@/lib/views/types";

/** Fire-and-forget from `openJob` (jobs/page.tsx) — signed-out visitors
 *  silently record nothing (there's no guest-store equivalent for views:
 *  unlike pursuits, a view has no user-facing "did this save" affordance to
 *  preserve across sign-in, so there's nothing worth merging later). */
export async function recordJobViewAction(
    jobId: string,
    snapshotInput: JobSnapshot,
): Promise<{ recorded: boolean }> {
    const user = await getServerUser();
    if (!user) return { recorded: false };

    const parsed = validate(recordJobViewSchema, { job_id: jobId, ...snapshotInput });
    if (!parsed.ok) return { recorded: false };

    const snapshot: JobSnapshot = {
        title: parsed.data.title,
        company: parsed.data.company,
        location: parsed.data.location,
        description: parsed.data.description,
        apply_url: parsed.data.apply_url,
    };

    try {
        const db = getAdminDb();
        const now = new Date().toISOString();
        const id = `${user.uid}_${parsed.data.job_id}`;
        const ref = db.collection("job_views").doc(id);
        // Existing/create branch mirrors `upsertPursuitCore` (pursuits/upsert-core.ts):
        // an update only touches `last_viewed_at`/`view_count`/`job_snapshot`, so
        // `first_viewed_at` is stamped once at create and never overwritten by a
        // later view.
        const existing = await ref.get();
        if (existing.exists) {
            await ref.update(
                stripUndefinedDeep({
                    last_viewed_at: now,
                    view_count: FieldValue.increment(1),
                    job_snapshot: snapshot,
                }),
            );
        } else {
            await ref.set(
                stripUndefinedDeep({
                    user_id: user.uid,
                    job_id: parsed.data.job_id,
                    first_viewed_at: now,
                    last_viewed_at: now,
                    view_count: 1,
                    job_snapshot: snapshot,
                }),
            );
        }
        return { recorded: true };
    } catch (error) {
        console.error("Error recording job view:", error);
        return { recorded: false };
    }
}

/** Mirrors `getApplications` (actions/application.ts): `user_id == uid`
 *  only, no `orderBy` (avoids a composite index) — sort+cap happens in JS via
 *  `orderJobViewsLatestFirst`, the one chokepoint client code shares too. */
export async function getJobViewsAction(): Promise<{ data?: JobView[]; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };

    try {
        const db = getAdminDb();
        const snap = await db.collection("job_views").where("user_id", "==", user.uid).get();
        const views = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as JobView[];
        return { data: orderJobViewsLatestFirst(views) };
    } catch (error) {
        console.error("Error fetching job views:", error);
        return { error: error instanceof Error ? error.message : "Failed to load history" };
    }
}
