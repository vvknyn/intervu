"use server";

import { analyzeJobRequirements, generateTailoringRecommendations } from "@/actions/tailor-resume";
import { fetchResumeData } from "@/actions/resume";
import { getServerUser } from "@/lib/firebase/auth-session";
import {
    buildFitAssessment,
    type FitAssessment,
    type FitVerdictLabel,
} from "@/lib/jobs/fit-verdict";
import { classifySentinel, sentinelMessage } from "@/lib/llm/sentinels";

export type { FitAssessment, FitVerdictLabel };

export async function assessJobFitAction(input: {
    description: string;
    url?: string | null;
}): Promise<{ data?: FitAssessment; error?: string; needsAuth?: boolean; needsResume?: boolean }> {
    try {
        const user = await getServerUser();
        if (!user) {
            return { needsAuth: true };
        }

        const resumeResult = await fetchResumeData();
        if (resumeResult.error) {
            if (classifySentinel(resumeResult.error) === "auth") {
                return { needsAuth: true };
            }
            return { error: sentinelMessage(resumeResult.error) || resumeResult.error };
        }
        if (!resumeResult.data) {
            return { needsResume: true };
        }

        const analysisResult = await analyzeJobRequirements(
            input.description,
            input.url ?? undefined,
        );
        if (analysisResult.error) {
            if (classifySentinel(analysisResult.error) === "auth") {
                return { needsAuth: true };
            }
            return { error: sentinelMessage(analysisResult.error) || analysisResult.error };
        }
        if (!analysisResult.data) {
            return { error: "Failed to analyze job posting" };
        }

        const recResult = await generateTailoringRecommendations(
            resumeResult.data,
            analysisResult.data,
        );
        if (recResult.error) {
            if (classifySentinel(recResult.error) === "auth") {
                return { needsAuth: true };
            }
            return { error: sentinelMessage(recResult.error) || recResult.error };
        }
        if (!recResult.data) {
            return { error: "Failed to generate fit assessment" };
        }

        return {
            data: buildFitAssessment(recResult.data, analysisResult.data.id),
        };
    } catch (e) {
        if (classifySentinel(e) === "auth") {
            return { needsAuth: true };
        }
        const msg = sentinelMessage(e);
        return { error: msg || "Failed to assess job fit" };
    }
}
