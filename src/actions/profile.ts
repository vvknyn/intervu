"use server";

import { getServerUser } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";

export async function fetchProfile() {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();

        if (!doc.exists) {
            return { data: null };
        }

        const docData = doc.data();

        return {
            data: {
                resume_text: docData?.resume_text ?? null,
                is_admin: docData?.is_admin ?? false,
            },
        };
    } catch (e: any) {
        return { error: e.message };
    }
}

export async function updateResume(resumeText: string) {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        console.log("[Profile] Updating resume for:", user.uid);

        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            resume_text: resumeText,
        });

        return { success: true };
    } catch (e: any) {
        console.error("[Profile] Update Error:", e);
        return { error: e.message };
    }
}
