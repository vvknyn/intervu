"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

type FeedbackType = "bug" | "feedback" | "other";

export interface FeedbackItem {
    id: string;
    user_id: string;
    type: FeedbackType;
    message: string;
    path: string | null;
    user_agent: string | null;
    created_at: string;
    user_email?: string;
}

export async function submitFeedback({
    type,
    message,
    path,
}: {
    type: FeedbackType;
    message: string;
    path: string;
}) {
    const supabase = await createClient();
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || "unknown";

    // Get current user
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return { error: "You must be logged in to submit feedback." };
    }

    const { error } = await supabase.from("feedback").insert({
        user_id: user.id,
        type,
        message,
        path,
        user_agent: userAgent,
    });

    if (error) {
        console.error("Error submitting feedback:", error);
        return { error: "Failed to submit feedback. Please try again." };
    }

    return { success: true };
}

export async function fetchAllFeedback(): Promise<{ data?: FeedbackItem[]; error?: string }> {
    const supabase = await createClient();

    // Verify caller is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };

    const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

    if (!profile?.is_admin) return { error: "Unauthorized" };

    // Fetch all feedback, newest first
    const { data, error } = await supabase
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("[Feedback] Fetch error:", error);
        return { error: error.message };
    }

    return { data: (data || []) as FeedbackItem[] };
}
