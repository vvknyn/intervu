"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApplicationDraft } from "@/components/applications/ApplicationWizard";
import { assertUnderDailyApplyCap } from "@/lib/pursuits/apply-cap";
import { saveResumeVersionForPursuit } from "@/lib/pursuits/resume-version";
import type { ResumeVersionSnapshot } from "@/lib/pursuits/types";

/**
 * Create a new application draft from the wizard state
 */
export async function createApplicationDraft(draft: ApplicationDraft): Promise<{ data?: { id: string }; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "Must be authenticated to create application" };
        }

        // Validate minimal requirements
        if (!draft.jobAnalysis?.companyName || !draft.jobAnalysis?.positionTitle) {
            return { error: "Company name and position are required" };
        }

        // Brand-new doc, always created with status "applied" below — free-plan
        // daily apply cap (see lib/pursuits/apply-cap.ts).
        await assertUnderDailyApplyCap(user.uid);

        const db = getAdminDb();
        const now = new Date().toISOString();

        const docRef = await db.collection("applications").add({
            user_id: user.uid,
            company_name: draft.jobAnalysis.companyName,
            position: draft.jobAnalysis.positionTitle,
            job_url: draft.jobUrl || null,
            // job_description: draft.jobText || null, // Ensure migration is applied before uncommenting
            status: 'applied',
            created_at: now,
            updated_at: now,
        });

        return { data: { id: docRef.id } };
    } catch (e: any) {
        console.error("Create application draft error:", e);
        return { error: e.message || "Failed to create application draft" };
    }
}

/**
 * Fetch a single application by ID
 */
export async function fetchApplicationById(id: string): Promise<{ data?: any; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();
        const doc = await db.collection("applications").doc(id).get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Application not found" };
        }

        return { data: { id: doc.id, ...doc.data() } };
    } catch (e: any) {
        console.error("Fetch application error:", e);
        return { error: e.message };
    }
}

/**
 * Update an application with the linked resume version
 */
export async function linkResumeVersionToApplication(
    applicationId: string,
    resumeVersionId: string
): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();
        const docRef = db.collection("applications").doc(applicationId);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Application not found" };
        }

        await docRef.update({
            resume_version_id: resumeVersionId,
            updated_at: new Date().toISOString(),
        });

        return {};
    } catch (e: any) {
        console.error("Link resume version error:", e);
        return { error: e.message };
    }
}

/**
 * Cookie-session wrapper around `saveResumeVersionForPursuit`
 * (`@/lib/pursuits/resume-version`) for client components — resolves `uid`
 * from the session cookie and delegates. The MCP tool surface calls the
 * underlying lib function directly with its own bearer-resolved uid.
 */
export async function saveResumeVersionForPursuitAction(
    pursuitId: string,
    input: { content: string; label: string },
): Promise<{ data?: ResumeVersionSnapshot; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    return saveResumeVersionForPursuit(user.uid, pursuitId, input);
}
