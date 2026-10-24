"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { hasPaidAccess } from "@/lib/billing/access";

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
        const paid = await hasPaidAccess(user.uid);

        return {
            data: {
                resume_text: paid ? (docData?.resume_text ?? null) : null,
                is_admin: docData?.is_admin ?? false,
            },
        };
    } catch (e: any) {
        return { error: e.message };
    }
}
