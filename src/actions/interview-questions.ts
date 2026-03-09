"use server";

import { createClient } from "@/lib/supabase/server";
import { generateGenericJSON } from "@/actions/generate-context";
import { revalidatePath } from "next/cache";

export interface InterviewQuestion {
    id: string;
    question: string;
    answer: string;
    tags: string[];
    application_id?: string;
    created_at: string;
}

export async function addInterviewQuestion(input: {
    question: string;
    applicationId?: string;
}) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return { error: "User not authenticated" };
        }

        if (!input.question.trim()) {
            return { error: "Question cannot be empty" };
        }

        // 1. Generate Answer & Tags using LLM
        const prompt = `
      You are an expert interview coach. A candidate was asked the following interview question:
      "${input.question}"

      Please provide:
      1. A high-quality, professional answer to this question. If it's behavioral, use the STAR method. If technical, explain clearly.
      2. A list of 3-5 relevant tags (e.g., "Behavioral", "Leadership", "React", "System Design").

      Return ONLY valid JSON in this format:
      {
        "answer": "The generated answer...",
        "tags": ["tag1", "tag2", "tag3"]
      }
    `;

        const generated = await generateGenericJSON(prompt);

        if (!generated || !generated.answer) {
            return { error: "Failed to generate answer" };
        }

        // 2. Save to Database
        const { data, error } = await supabase
            .from("interview_questions")
            .insert({
                user_id: user.id,
                application_id: input.applicationId || null,
                question: input.question,
                answer: generated.answer,
                tags: generated.tags || [],
            })
            .select()
            .single();

        if (error) {
            console.error("Error saving question:", error);
            return { error: "Failed to save question" };
        }

        revalidatePath("/applications");
        revalidatePath(`/applications?id=${input.applicationId}`); // Revalidate specific app page if applicable

        return { data };
    } catch (error: any) {
        console.error("Error in addInterviewQuestion:", error);
        return { error: error.message || "An unexpected error occurred" };
    }
}

export async function getInterviewQuestions(applicationId?: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "User not authenticated" };
    }

    let query = supabase
        .from("interview_questions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

    if (applicationId) {
        query = query.eq("application_id", applicationId);
    }

    const { data, error } = await query;

    if (error) {
        console.error("Error fetching questions:", error);
        return { error: "Failed to fetch questions" };
    }

    return { data: data as InterviewQuestion[] };
}

export async function deleteInterviewQuestion(id: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "User not authenticated" };
    }

    const { error } = await supabase
        .from('interview_questions')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

    if (error) {
        console.error("Error deleting question:", error);
        return { error: error.message };
    }

    revalidatePath('/applications');
    return { success: true };
}
