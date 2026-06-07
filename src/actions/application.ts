"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { revalidatePath } from "next/cache";
import { validate, updateApplicationSchema } from "@/lib/validation";

export type ApplicationStatus = 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn';

export interface Application {
    id: string;
    company_name: string;
    position: string;
    job_url?: string;
    applied_at?: string;
    status: ApplicationStatus;
    resume_version_id?: string;
    cover_letter?: string;
    user_id: string;
    created_at: string;
    updated_at: string;
    resume_version?: {
        version_name: string;
    } | null;
}

export interface CreateApplicationData {
    company_name: string;
    position: string;
    job_url?: string;
    applied_at?: string;
    status: ApplicationStatus;
    resume_version_id?: string;
    cover_letter?: string;
}

export interface UpdateApplicationData {
    company_name?: string;
    position?: string;
    job_url?: string;
    applied_at?: string;
    status?: ApplicationStatus;
    resume_version_id?: string;
    cover_letter?: string;
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
    } catch (error: any) {
        console.error("Error fetching applications:", error);
        return { error: error.message || "Failed to fetch applications" };
    }
}

export async function createApplication(application: CreateApplicationData) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
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

        revalidatePath('/applications');
        return { data };
    } catch (error: any) {
        console.error("Error creating application:", error);
        return { error: error.message || "Failed to create application" };
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

        revalidatePath('/applications');
        return { data };
    } catch (error: any) {
        console.error("Error updating application:", error);
        return { error: error.message || "Failed to update application" };
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

        revalidatePath('/applications');
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting application:", error);
        return { error: error.message || "Failed to delete application" };
    }
}
