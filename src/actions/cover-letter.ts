"use server";

import { ProviderFactory } from "@/lib/llm/providers";
import { fetchUrlContent } from "@/actions/fetch-url";

const DEFAULT_MODEL = "qwen/qwen3-vl-235b-a22b-thinking";

export async function generateCoverLetter(resumeContent: string, jobUrlOrDescription: string, length: "short" | "standard" | "long" = "standard") {
    try {
        // 1. Fetch Job Content if it's a URL
        let jobContext = jobUrlOrDescription;
        if (jobUrlOrDescription.startsWith('http')) {
            const { data, error } = await fetchUrlContent(jobUrlOrDescription);
            if (error) {
                console.warn("Could not fetch job URL, using string as is:", error);
            } else if (data) {
                jobContext = data;
            }
        }

        // 2. Get API Config
        const apiKey = process.env.OPENROUTER_API_KEY || "";
        if (!apiKey) {
            return { error: "Missing OPENROUTER_API_KEY environment variable." };
        }

        const provider = ProviderFactory.getProvider("openrouter", apiKey, DEFAULT_MODEL);

        // 3. Generate Cover Letter
        const prompt = `
            You are an expert career coach and professional writer.

            TASK: Write a customized, compelling cover letter for the following candidate and job.

            CANDIDATE RESUME:
            ${resumeContent.substring(0, 15000)}

            JOB DESCRIPTION:
            ${jobContext.substring(0, 10000)}

            GUIDELINES:
            1. **Tone**: Extremely human, conversational, and authentic. Avoid "AI-sounding" phrases like "I am writing to express my enthusiastic interest" or "seamlessly align". Instead, write like a real person speaking to another person. Be confident but humble.
            2. **Structure**:
               - Hook the reader immediately with a genuine connection to the company or mission.
               - Middle paragraph: Tell 1-2 short, specific stories from the resume that prove ability to do *this* job. Don't just list skills.
               - Closing: Brief, professional, and call to action.
            3. **Formatting**: Standard business letter format. Start directly with "Date" and "Dear Hiring Team" (or specific name if found).
            4. **Length**: ${length === "short" ? "Strict limit of approximately 150 words. Ultra-concise and punchy." : length === "long" ? "Approximately 350-400 words. Comprehensive with multiple stories woven in." : "Strict limit of approximately 250 words. Keep it punchy and respectful of the recruiter's time."}

            Output ONLY the cover letter text.
        `;

        const response = await provider.generate({
            system: "You are a professional resume writer who writes in a very human, non-robotic tone. You prioritize brevity and impact.",
            prompt: prompt
        });

        if (response.error) {
            return { error: response.error };
        }

        return { data: response.text };

    } catch (e: any) {
        console.error("Cover Letter Generation Error:", e);
        return { error: e.message || "Failed to generate cover letter" };
    }
}
