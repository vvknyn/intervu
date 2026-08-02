"use server";

import { getAdminDb } from "@/lib/firebase/admin";
import { validate, contactMessageSchema, isHoneypotTripped } from "@/lib/validation";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

export async function submitContactMessage({
    name,
    email,
    message,
    honeypot,
    path,
}: {
    name?: string;
    email: string;
    message: string;
    honeypot: string;
    path: string;
}) {
    if (isHoneypotTripped(honeypot)) {
        // Bot fill — accept-and-drop silently so it doesn't retry with a
        // different pattern. Never hits Firestore, never surfaces an error.
        return { success: true };
    }

    const parsed = validate(contactMessageSchema, { name, email, message });
    if (!parsed.ok) return { error: parsed.error };

    const db = getAdminDb();

    try {
        const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
        const recentSnapshot = await db
            .collection("contact_messages")
            .where("email", "==", parsed.data.email)
            .where("ts", ">=", since)
            .get();

        if (recentSnapshot.size >= RATE_LIMIT_MAX) {
            return { error: "Too many messages from this email in the last hour. Try again later." };
        }
    } catch (error) {
        // Best-effort only (e.g. missing composite index) — never block a
        // legitimate submission because the rate-limit check itself failed.
        console.error("[Contact] Rate limit check error:", error);
    }

    try {
        await db.collection("contact_messages").add({
            email: parsed.data.email,
            message: parsed.data.message,
            name: parsed.data.name ?? null,
            ts: new Date().toISOString(),
            path,
        });

        return { success: true };
    } catch (error) {
        console.error("[Contact] Submit error:", error);
        return { error: "Failed to send your message. Please try again." };
    }
}
