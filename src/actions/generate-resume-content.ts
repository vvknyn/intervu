"use server";

import { ProviderFactory } from "@/lib/llm/providers";
import { ProviderConfig } from "@/lib/llm/types";
import { chargeIfSharedKey } from "@/lib/llm/credit-gate";
import { resolveLLMConfig } from "@/lib/llm/resolve-config";

const getConfig = async (override?: Partial<ProviderConfig>) => {
    const config = await resolveLLMConfig(override);
    await chargeIfSharedKey({ apiKey: config.apiKey });
    return config;
};

// Generate professional summary
export async function generateSummary(params: {
    role: string;
    yearsExperience: number;
    keySkills: string[];
    configOverride?: Partial<ProviderConfig>;
}): Promise<{ summary?: string; error?: string }> {
    try {
        const config = await getConfig(params.configOverride);
        const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

        const prompt = `
            Write a professional resume summary for someone with this background:
            - Target Role: ${params.role}
            - Years of Experience: ${params.yearsExperience}
            - Key Skills: ${params.keySkills.join(', ')}

            WRITE IN A POLISHED, PROFESSIONAL FAANG STYLE:

            1. LENGTH: Write 3-4 complete sentences

            2. TONE: Confident, precise, and technical - like a senior engineer at Google or Meta
               - Direct and assertive, not hedging
               - Focus on scope, scale, and measurable impact
               - Technical credibility with business awareness

            3. AVOID:
               - Clichés: "Results-driven", "Passionate", "Dynamic", "Motivated"
               - Buzzwords: "proven track record", "leveraging", "synergies", "innovative solutions"
               - Vague claims without specifics
               - Overly casual language

            4. STRUCTURE:
               - Sentence 1: Core identity + years of experience + technical focus area
               - Sentence 2: Scope and scale of work (systems built, users served, team size)
               - Sentence 3: Specific technical strengths or notable achievements
               - Sentence 4: What you're looking for (optional)

            EXCELLENT EXAMPLES (FAANG-STYLE):

            "Senior software engineer with 7 years of experience building high-throughput distributed systems. At Meta, I architected the real-time analytics pipeline processing 2M events/second and led a team of 5 engineers on the ads delivery infrastructure. Deep expertise in Java, Kafka, and large-scale data systems. Seeking a staff-level role focused on platform infrastructure."

            "Full-stack engineer with 5 years specializing in consumer-facing products at scale. Most recently at Stripe, I owned the merchant dashboard serving 500K businesses and led the React migration that improved page load times by 60%. Strong background in TypeScript, GraphQL, and building products that balance technical excellence with user experience."

            "Engineering manager with 8 years of experience, including 3 years leading teams at Amazon. Built and scaled a 12-person team responsible for the order fulfillment platform handling $50M in daily transactions. Track record of shipping complex projects on time while developing senior engineers through mentorship and technical leadership."

            BAD EXAMPLES (DO NOT WRITE LIKE THIS):

            "Results-driven software engineer with a proven track record of delivering innovative solutions."
            "Passionate technologist who leverages cutting-edge tools to drive business outcomes."
            "Highly motivated team player seeking to utilize my skills in a dynamic environment."

            Return ONLY the summary text. No labels, quotes, or formatting.
        `;

        const response = await provider.generate({ prompt });

        if (response.error) {
            return { error: response.error };
        }

        return { summary: response.text?.trim() || "" };
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Generate Summary Error:", error);
        return { error: error.message || "Failed to generate summary" };
    }
}

// Generate experience bullet points
export async function generateExperienceBullets(params: {
    role: string;
    company: string;
    description: string;
    configOverride?: Partial<ProviderConfig>;
}): Promise<{ bullets?: string[]; error?: string }> {
    try {
        const config = await getConfig(params.configOverride);
        const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

        const prompt = `
            Enhance this work experience into polished resume bullet points using the STAR framework:

            Role: ${params.role}
            Company: ${params.company}
            Their notes/existing content: ${params.description}

            === CRITICAL: PRESERVE THE USER'S CONTENT ===

            The user has provided their own description above. Your job is to ENHANCE it, not replace it.

            - KEEP all specific technical details they mentioned (technologies, tools, frameworks, numbers)
            - KEEP their metrics and achievements exactly as stated
            - KEEP the projects and work they described
            - ADD structure using the STAR framework
            - ADD context and flow to make it read better
            - EXPAND brief points into fuller sentences
            - DO NOT invent new projects or achievements they didn't mention
            - DO NOT change their numbers or metrics
            - DO NOT remove technical specifics to make it more "general"

            === FORMAT REQUIREMENTS ===

            1. GENERATE 4-5 BULLET POINTS
            2. EACH BULLET SHOULD BE 35-50 WORDS (verbose and detailed, not short fragments)
            3. Write in a flowing, narrative style - not choppy phrases

            === WRITING STYLE - FAANG/BIG TECH PROFESSIONAL ===

            Write like a senior engineer at Google, Meta, or Amazon would write their resume.

            === AVOID ===

            - Overused words: "Spearheaded", "Leveraged", "Utilized", "Synergy"
            - Vague claims without specifics

            Return ONLY a JSON object:
            { "bullets": ["First detailed bullet point here", "Second detailed bullet point here", ...] }
        `;

        const response = await provider.generate({
            prompt,
            json: true,
            system: "You are a senior tech recruiter who has reviewed thousands of FAANG resumes. CRITICAL: Preserve all technical details, metrics, and specifics the user provided - enhance their content, don't replace it. Write in the polished, precise style of a Google/Meta engineer's resume - confident, technical, impact-focused. Each bullet should be 30-45 words. Return ONLY valid JSON."
        });

        if (response.error) {
            return { error: response.error };
        }

        try {
            const parsed = JSON.parse(response.text || "{}");
            return { bullets: parsed.bullets || [] };
        } catch (parseError) {
            const lines = response.text?.split('\n').filter(line => line.trim().length > 0) || [];
            return { bullets: lines.slice(0, 5) };
        }
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Generate Experience Bullets Error:", error);
        return { error: error.message || "Failed to generate bullet points" };
    }
}

// Improve existing text with AI
export async function improveResumeText(params: {
    text: string;
    section: 'summary' | 'experience' | 'skills';
    configOverride?: Partial<ProviderConfig>;
}): Promise<{ improved?: string; error?: string }> {
    try {
        const config = await getConfig(params.configOverride);
        const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

        const sectionGuidance = {
            summary: `
                - Write 3-4 natural sentences that sound like a real person
                - Start with a concrete fact, not "Results-driven" or "Passionate"
                - Be specific about actual experience and skills
                - Avoid corporate buzzwords and AI-sounding phrases
            `,
            experience: `
                - Each bullet should be 15-30 words, telling a mini-story
                - Vary sentence starters - don't begin every line the same way
                - Include specific details: technologies, team sizes, realistic metrics
                - Avoid "Leveraged", "Spearheaded", "Utilized" and similar overused words
                - Show thinking and context: why did this matter?
            `,
            skills: `
                - Group skills logically by category
                - Be specific (e.g., "PostgreSQL" not just "databases")
                - Include proficiency context where relevant
                - Don't list everything - focus on what's most relevant
            `
        };

        const prompt = `
            Improve this resume ${params.section} section while keeping it sounding HUMAN and NATURAL:

            Original text:
            ${params.text}

            KEY REQUIREMENTS:
            ${sectionGuidance[params.section]}

            AVOID THESE AI RED FLAGS:
            - Generic phrases like "proven track record", "innovative solutions"
            - Buzzwords: "synergy", "leverage", "spearhead", "drive results"
            - Suspiciously round percentages (50%, 100% improvement)
            - Starting every sentence with the same structure
            - Vague claims without specific details

            INSTEAD:
            - Be specific and concrete
            - Use varied sentence structures
            - Include realistic details and metrics
            - Write like a real person describing their work to a colleague
            - Preserve the original meaning and facts, just make them clearer

            Return ONLY the improved text. No labels, explanations, or "Here's the improved version".
        `;

        const response = await provider.generate({ prompt });

        if (response.error) {
            return { error: response.error };
        }

        return { improved: response.text?.trim() || "" };
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Improve Resume Text Error:", error);
        return { error: error.message || "Failed to improve text" };
    }
}
