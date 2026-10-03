"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ApplicationDraft } from "@/lib/applications/draft";
import { saveResumeVersionForPursuit } from "@/lib/pursuits/resume-version";
import { keepGuestAppliedResume, readAppliedResume, removeAppliedResume } from "@/lib/pursuits/applied-resume";
import type { AppliedResume, ResumeVersionSnapshot } from "@/lib/pursuits/types";

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

/** The résumé a role kept when it was marked Applied, with its text, for
 *  Download: the tracker list sends only its date (`getApplications`). */
export async function fetchAppliedResumeAction(pursuitId: string): Promise<{ data?: AppliedResume; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (typeof pursuitId !== "string" || !pursuitId) return { error: "Pursuit not found" };
    return readAppliedResume(user.uid, pursuitId);
}

/** Removes that copy from the role; the résumé itself stays. */
export async function removeAppliedResumeAction(pursuitId: string): Promise<{ error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (typeof pursuitId !== "string" || !pursuitId) return { error: "Pursuit not found" };
    return removeAppliedResume(user.uid, pursuitId);
}

/** Sign-in carries a guest role's copy onto the account's role. */
export async function keepGuestAppliedResumeAction(pursuitId: string, copy: AppliedResume): Promise<{ error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (typeof pursuitId !== "string" || !pursuitId) return { error: "Pursuit not found" };
    return keepGuestAppliedResume(user.uid, pursuitId, copy);
}
