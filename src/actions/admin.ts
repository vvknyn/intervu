"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { isAdminUser } from "@/lib/llm/credit-gate";

export async function getAppConfig() {
    try {
        const db = getAdminDb();
        const doc = await db.collection("app_config").doc("main").get();

        if (!doc.exists) {
            console.error("[Admin] app_config/main document not found");
            return { data: null, error: "App config not found" };
        }

        return { data: doc.data() as { show_donation: boolean; donation_url: string; updated_at?: string } };
    } catch (error: any) {
        console.error("[Admin] Failed to fetch app config:", error);
        return { data: null, error: error.message };
    }
}

export async function updateAppConfig(updates: {
    show_donation?: boolean;
    donation_url?: string;
}) {
    if (!(await isCurrentUserAdmin())) return { error: "Forbidden" };
    try {
        const db = getAdminDb();
        await db.collection("app_config").doc("main").update({
            ...updates,
            updated_at: new Date().toISOString(),
        });

        return { success: true };
    } catch (error: any) {
        console.error("[Admin] Failed to update app config:", error);
        return { error: error.message };
    }
}

export async function isCurrentUserAdmin(): Promise<boolean> {
    const user = await getServerUser();
    if (!user) return false;
    // Admin = email allowlist (vvk) OR profiles.is_admin. Shared with the
    // credit gate so "admin" means the same thing everywhere.
    return isAdminUser(user);
}
