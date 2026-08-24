"use server";

import { CompanyReconData, MatchData, QuestionsData, ReverseQuestionsData, TechnicalData, CodingChallenge, AnswerCritique, QuestionItem, SystemDesignData } from "@/types";
import { fetchServerCache, saveServerCache } from "@/actions/cache";
import { ProviderFactory } from "@/lib/llm/providers";
import { chargeIfSharedKey, AUTH_REQUIRED, OUT_OF_CREDITS } from "@/lib/llm/credit-gate";
import { resolveLLMConfig } from "@/lib/llm/resolve-config";
import { ProviderConfig } from "@/lib/llm/types";
import { resolveModelLadder, runLadder, type LadderRung } from "@/lib/llm/model-ladder";
import { PrepJobContext, fingerprintJobContext } from "@/lib/prep/job-context";
import { planHasSessionQuestions } from "@/lib/prep/cache-key";
import { resolveCacheLookup } from "@/lib/interview-cache";

function hashQuestionText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function normalizeSystemDesignQuestion(
    raw: QuestionItem | Record<string, unknown>,
    index: number,
    source: "curated" | "ai",
    displayCategory: string,
): QuestionItem {
    const record = raw as Record<string, unknown>;
    const questionText =
        typeof record.question === "string"
            ? record.question
            : String(record.question ?? "");
    const existingId =
        typeof record.id === "string" && record.id.trim().length > 0
            ? record.id.trim()
            : undefined;
    const stableId =
        existingId ?? `sd-${source}-${index}-${hashQuestionText(questionText)}`;

    return {
        ...(raw as QuestionItem),
        id: stableId,
        question: questionText,
        category: displayCategory,
    };
}


const getConfig = (override?: Partial<ProviderConfig>) => resolveLLMConfig(override);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A provider-key fault is always the app's OWN shared key now — there is no
 *  user-supplied key left to fix — so this copy owns the failure rather than
 *  sending the reader to a Settings page that no longer has a key field. */
const SHARED_KEY_FAULT_MESSAGE = "AI is temporarily unavailable — that's on our side, not yours. Please try again shortly.";

const formatError = (e: any) => {
    console.error("Generation Error:", e);
    const msg = e?.message || String(e) || "";

    // Hard blocks from the cost/auth gate must reach the client VERBATIM so it can
    // recognize the prefix (see Section C client handling). Do NOT run them through
    // the prefix-stripping cleanup below, which would eat "AUTH_REQUIRED:" etc.
    if (msg.startsWith(AUTH_REQUIRED) || msg.startsWith(OUT_OF_CREDITS)) {
        return { error: msg };
    }

    const lowerMsg = msg.toLowerCase();

    let errorMessage = "An unexpected error occurred.";

    // Check for specific error patterns
    if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
        errorMessage = "Request timed out. The AI service may be slow. Please try again or switch to a different provider.";
    } else if (lowerMsg.includes("429") || lowerMsg.includes("rate limit") || lowerMsg.includes("too many requests")) {
        errorMessage = "Rate limit exceeded. Please wait a moment and try again, or switch to a different AI provider.";
    } else if (lowerMsg.includes("401") || lowerMsg.includes("unauthorized") || lowerMsg.includes("invalid") && lowerMsg.includes("key")) {
        errorMessage = SHARED_KEY_FAULT_MESSAGE;
    } else if (lowerMsg.includes("quota") || lowerMsg.includes("resource_exhausted")) {
        errorMessage = "The AI service hit its usage limit. Please try again shortly.";
    } else if (lowerMsg.includes("missing api key") || lowerMsg.includes("api key is required") || lowerMsg.includes("missing openrouter_api_key")) {
        errorMessage = SHARED_KEY_FAULT_MESSAGE;
    } else if (lowerMsg.includes("content") && (lowerMsg.includes("blocked") || lowerMsg.includes("safety"))) {
        errorMessage = "Content was blocked by the AI's safety filters. Please try a different query.";
    } else if (lowerMsg.includes("network") || lowerMsg.includes("econnrefused") || lowerMsg.includes("fetch failed")) {
        errorMessage = "Network error. Please check your internet connection and try again.";
    } else if (lowerMsg.includes("not found") || lowerMsg.includes("model_not_found") || lowerMsg.includes("does not exist")) {
        errorMessage = "The selected AI model isn't available right now. Please try again.";
    } else if (msg && msg.length > 0) {
        // Clean up the error message for display
        errorMessage = msg.replace(/^\[?\w+\]?\s*:?\s*/i, ''); // Remove provider prefixes like "[Groq]"
        // Truncate long error messages
        if (errorMessage.length > 200) {
            errorMessage = errorMessage.substring(0, 200) + "...";
        }
    }

    return { error: errorMessage };
};

// Regex to extract JSON from markdown or noisy output
const JSON_REPAIR_REGEX = /\{(?:[^{}]|\{(?:[^{}]|{[^{}]*})*\})*\}/;

const repairJSON = (text: string) => {
    try {
        // First try standard parse
        return JSON.parse(text);
    } catch {
        // Attempt 1: Strip Markdown Code Blocks
        const cleanText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        try {
            return JSON.parse(cleanText);
        } catch {
            // Attempt 2: Extract JSON object syntax using Regex
            const match = text.match(JSON_REPAIR_REGEX);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {
                    return null;
                }
            }
            return null;
        }
    }
};

export const fetchJSON = async (
    prompt: string,
    label: string,
    configOverride?: Partial<ProviderConfig>,
    /**
     * Optional free-first model ladder (see lib/llm/model-ladder.ts). Opt-in:
     * omit it and this behaves exactly as before, on one model. Only résumé
     * parsing passes one today.
     */
    modelLadder?: readonly string[],
) => {
    // Resolved ONCE and reused. `getConfig` hits the auth session, so
    // re-resolving per attempt cost a round-trip per retry — and a ladder needs
    // one stable config whose model it can vary per rung anyway.
    const baseConfig = await getConfig(configOverride);

    // Credit gate — charged ONCE per generation, above the ladder AND the retry
    // loop, and only when this resolves to the shared key (admins are exempt).
    // Throws OUT_OF_CREDITS when the monthly free balance is spent.
    // This ordering is the reason the ladder is walked here rather than by the
    // caller: a caller looping over `generateGenericJSON` would charge one
    // credit per rung, so a single upload could cost three.
    await chargeIfSharedKey(baseConfig);

    // Résumé parse passes a ladder even when configOverride.model is set (an
    // explicit model picks a paid tail, not "skip the free rungs"). Only Groq
    // skips — handled inside resolveModelLadder by provider !== openrouter.
    const rungs = resolveModelLadder(
        baseConfig,
        modelLadder,
        Boolean(configOverride?.model) && !modelLadder?.length,
    );

    // Helper for timeout
    const withTimeout = (promise: Promise<any>, ms: number, label: string) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`[Timeout] ${label} timed out after ${ms}ms`)), ms))
        ]);
    };

    const attemptFetch = async (rung: LadderRung, retryCount: number = 0): Promise<any> => {
        try {
            const config = { ...baseConfig, model: rung.model };
            const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

            console.log(`[DEBUG] Fetching ${label} with ${config.provider}:${config.model}...`);

            // Anchor the model's date reasoning to the real current date. Without this,
            // the model falls back to its training-cutoff notion of "now" — e.g. flagging
            // a recently-started role as "in the future", or under-counting years of
            // experience. This is the single seam every JSON prompt in the app routes
            // through (fetchJSON), so fixing it here covers all callers, not just resume
            // parsing — do not re-inject a date line at individual call sites.
            const todayLine = `Today's date is ${new Date().toISOString().slice(0, 10)}. Use it as "now" for any date reasoning (e.g. years of experience, or whether a role/date is past, current, or future).`;

            // Per-rung timeout (provider handles its own rate limiting). A free
            // rung gets less patience than the paid tail — see model-ladder.ts.
            const response = await withTimeout(
                provider.generate({
                    system: `You are an expert technical interviewer and career coach. Return ONLY valid JSON. ${todayLine}`,
                    prompt: prompt + "\n\nCRITICAL: Return ONLY valid JSON. No markdown formatting.",
                    json: true,
                    timeoutMs: rung.timeoutMs,
                    maxRetries: 1,
                }),
                rung.timeoutMs,
                label
            );

            if (response.error) {
                // Check if it's a daily limit error - don't retry
                if (response.error.includes('daily') || response.error.includes('TPD') || response.error.includes('tomorrow')) {
                    throw new Error(response.error);
                }
                throw new Error(response.error);
            }

            let parsed = repairJSON(response.text || "{}");

            if (!parsed) {
                console.warn(`[DEBUG] JSON parse failed for ${label}, attempting repair...`);
                // Try to extract JSON from the response without making another API call
                const jsonMatch = (response.text || "").match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        parsed = JSON.parse(jsonMatch[0]);
                    } catch {
                        // Fall through to retry
                    }
                }

                // Only re-prompt the SAME model for a malformed-JSON failure,
                // and only on the rung that has to answer. On a free rung the
                // next rung is the better retry — a different model is more
                // likely to produce valid JSON than the one that just didn't.
                if (!parsed && retryCount < 1 && rung.isFallback) {
                    await delay(1000);
                    const retryResponse = await withTimeout(
                        provider.generate({
                            system: `You output invalid JSON last time. Output purely raw JSON key-value pairs. ${todayLine}`,
                            prompt: prompt,
                            json: true,
                            timeoutMs: Math.min(30_000, rung.timeoutMs),
                            maxRetries: 1,
                        }),
                        Math.min(30_000, rung.timeoutMs),
                        `${label} (Correction)`
                    );
                    parsed = repairJSON(retryResponse.text || "{}");
                }
            }

            if (!parsed) throw new Error("Failed to parse JSON response.");
            return parsed;

        } catch (e: any) {
            // Don't retry for daily limits or auth errors
            const errorMsg = e.message?.toLowerCase() || '';
            if (errorMsg.includes('daily') || errorMsg.includes('tpd') ||
                errorMsg.includes('tomorrow') || errorMsg.includes('unauthorized') ||
                errorMsg.includes('invalid') && errorMsg.includes('key')) {
                throw e;
            }

            // Retry once for other transient errors — but only on the rung that
            // has to answer. Waiting 2s to re-ask a rate-limited free model is
            // pure latency; the ladder's next rung is the real retry.
            if (retryCount < 1 && rung.isFallback) {
                console.warn(`[DEBUG] Error fetching ${label}, retrying (${retryCount + 1}/1)...`, e.message);
                await delay(2000); // Wait 2 seconds before retry
                return attemptFetch(rung, retryCount + 1);
            }
            throw e;
        }
    };

    return runLadder(
        rungs,
        (rung) => attemptFetch(rung),
        (rung, error) =>
            console.warn(
                `[DEBUG] ${label}: rung ${rung.model} failed, falling through —`,
                error instanceof Error ? error.message : error,
            ),
    );
};



// Quick health check for API
export async function checkApiHealth(configOverride?: Partial<ProviderConfig>): Promise<{ ok: boolean; error?: string }> {
    try {
        const prompt = "Reply with just: ok";
        // Very short timeout for health check
        const config = await getConfig(configOverride);
        const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

        // Use a race with a short timeout
        const response = await Promise.race([
            provider.generate({ prompt }),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Health check timed out")), 8000))
        ]);

        if (response.error) {
            throw new Error(response.error);
        }
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: formatError(e).error };
    }
}

export async function fetchRecon(company: string, position: string, configOverride?: Partial<ProviderConfig>): Promise<{ data?: CompanyReconData; error?: string }> {
    try {
        // Sanitize company name
        const sanitizedCompany = company.trim().replace(/['"]/g, '');

        if (!sanitizedCompany || sanitizedCompany.length < 2) {
            return { error: "Please enter a valid company name." };
        }

        const prompt = `
You are a business analyst providing company research for interview preparation.

TASK: Analyze the company "${sanitizedCompany}" for someone interviewing for a ${position} role.

INSTRUCTIONS:
1. If you recognize "${sanitizedCompany}" as a real company (tech startup, public company, etc.), provide accurate details.
2. If the company name is ambiguous (e.g., "League" could be League Inc, The League app, etc.), pick the most likely tech/business interpretation.
3. If you cannot identify the company at all, still provide a helpful response with "Unknown" fields and general advice.

REQUIRED JSON OUTPUT (use exactly these keys):
{
  "name": "Official Company Name",
  "ticker": "TICKER or Private",
  "industry": "Primary Industry",
  "description": "A 100-150 word executive summary describing what the company does, their main products/services, and recent news or growth areas relevant to a ${position} candidate.",
  "vibe": "3 culture keywords separated by commas",
  "business_model": "Brief explanation of how they make money",
  "competitors": ["Competitor1", "Competitor2", "Competitor3"]
}

EXAMPLE for company "Stripe":
{
  "name": "Stripe",
  "ticker": "Private",
  "industry": "Financial Technology (Fintech)",
  "description": "Stripe is a leading payment infrastructure company that enables businesses to accept payments online and in-person. Founded in 2010, Stripe provides APIs for payment processing, billing, fraud prevention, and financial services. They power payments for millions of businesses from startups to Fortune 500 companies. Recent focus areas include Stripe Atlas for company incorporation, Stripe Climate for carbon removal, and expansion into banking-as-a-service.",
  "vibe": "Fast-paced, Engineering-driven, Ambitious",
  "business_model": "Transaction fees (2.9% + $0.30 per transaction) and subscription fees for premium features",
  "competitors": ["Square", "PayPal", "Adyen"]
}

Now analyze "${sanitizedCompany}":`;

        const data = await fetchJSON(prompt, "Recon", configOverride);

        // Validate and sanitize the response
        if (!data || typeof data !== 'object') {
            throw new Error("Invalid response format from AI");
        }

        // Ensure required fields exist with fallbacks
        const validatedData: CompanyReconData = {
            name: data.name || sanitizedCompany,
            ticker: data.ticker || "Unknown",
            industry: data.industry || "Technology",
            description: data.description || `${sanitizedCompany} is a company in the technology sector. Research more about them before your interview.`,
            vibe: data.vibe || "Professional, Dynamic, Growing",
            business_model: data.business_model || "Business model not available",
            competitors: Array.isArray(data.competitors) ? data.competitors.slice(0, 5) : []
        };

        return { data: validatedData };
    } catch (e: any) {
        console.error("[fetchRecon] Error:", e);

        // Return a graceful fallback instead of error
        const fallbackData: CompanyReconData = {
            name: company,
            ticker: "Unknown",
            industry: "Technology",
            description: `We couldn't retrieve detailed information about ${company}. This may be a private company or startup. We recommend researching their website and recent news before your interview.`,
            vibe: "Research needed",
            business_model: "Not available",
            competitors: []
        };

        // Only return error for critical failures, otherwise return fallback
        if (e.message?.includes("API key") || e.message?.includes("unauthorized")) {
            return formatError(e);
        }

        return { data: fallbackData };
    }
}

export async function fetchMatch(company: string, position: string, round: string, resume: string, stories: string, sources: string = "", jobContext: string = "", configOverride?: Partial<ProviderConfig>, companies: string[] = [], strategyLength: "brief" | "standard" | "detailed" = "standard"): Promise<{ data?: MatchData; error?: string }> {
    try {
        const fullContext = `RESUME SUMMARY:\n${resume}\n\nADDITIONAL STORIES:\n${stories}\n\nADDITIONAL SOURCES:\n${sources}`;
        const jobContextSection = jobContext ? `\n\nJOB POSTING CONTEXT:\n${jobContext}` : "";

        // Use all provided companies by default
        const selectedCompanies = companies.length > 0 ? companies : [];
        const companiesContext = selectedCompanies.length > 0
            ? `\n\nCOMPANIES TO HIGHLIGHT: ${selectedCompanies.join(", ")}`
            : "";

        const lengthInstructions = strategyLength === "brief"
            ? `2. **Length Goal**: 150-200 words, 2 short paragraphs. Keep it concise like an elevator pitch.`
            : strategyLength === "detailed"
            ? `2. **Length Goal**: 600-800 words, 5+ paragraphs with specific examples. Go deep on projects and impact.`
            : `2. **Length Goal**: 450-600 words (3-4 minutes spoken). THIS MUST BE LONG AND DETAILED.`;

        const structureInstructions = strategyLength === "brief"
            ? `3. **Structure (2 Sections)**:
               - **Paragraph 1**: Quick background and key highlights. (~80-100 words)
               - **Paragraph 2**: Why this role and company. (~80-100 words)`
            : strategyLength === "detailed"
            ? `3. **Structure (5+ Sections)**:
               - **Paragraph 1 (The Foundation)**: Education & early career context. Set the stage detailedly. (~100-120 words)
               - **Paragraph 2 (The Growth)**: Middleware/earlier relevant roles. Don't just list titles—explain *challenges* and *wins*. (~120-150 words)
               - **Paragraph 3 (The Peak)**: Most recent/senior roles. Deep dive into specific projects, leadership, and impact. (~150-180 words)
               - **Paragraph 4 (Key Projects)**: Specific project examples with outcomes. (~100-120 words)
               - **Paragraph 5 (The Alignment)**: Why you are here. Connect your specific skills to [Company]'s mission/product. (~100-120 words)`
            : `3. **Structure (4 Distinct Sections)**:
               - **Paragraph 1 (The Foundation)**: Education & early career context. Set the stage detailedly. (~80-100 words)
               - **Paragraph 2 (The Growth)**: Middleware/earlier relevant roles. Don't just list titles—explain *challenges* and *wins*. (~120-150 words)
               - **Paragraph 3 (The Peak)**: Most recent/senior roles. Deep dive into specific projects, leadership, and impact. (~120-150 words)
               - **Paragraph 4 ( The Alignment)**: Why you are here. Connect your specific "Peak" skills to [Company]'s mission/product. (~80-100 words)`;

        const prompt = `
            Context: Interview at ${company} for the role of '${position}' (Round: ${round}).
            Candidate Context: ${fullContext}
            ${jobContextSection}
            ${companiesContext}

            Task:
            1. Write a COMPREHENSIVE, DETAILED "Tell me about yourself" script.
            ${lengthInstructions}
            ${structureInstructions}
            4. **Style**: Conversational but professional. "Let me walk you through my journey..."
            5. **CRITICAL**: Do NOT summarize. EXPAND on your points.

            CRITICAL RULES:
            - **NO NUMBERS/METRICS**: Do NOT include specific figures, percentages, or KPIs.
            - **FIRST PERSON**: "I started..."
            - **SOURCE OF TRUTH**: Use Candidate Context (Resume) only.
            - **MATCHED ENTITIES**: List the specific companies from the resume that you highlighted in your script. YOU MUST INCLUDE AT LEAST ONE.

            Return JSON:
            {
                "matched_entities": ["Company A", "Company B"],
                "headline": "A punchy 5-8 word headline for ${position}",
                "paragraph_1": "The Foundation (Detailed)",
                "paragraph_2": "The Growth (Detailed)",
                "paragraph_3": "The Peak (Detailed)",
                "paragraph_4": "The Alignment (Detailed)"
            }
        `;
        const data = await fetchJSON(prompt, "Match", configOverride);

        if (data && selectedCompanies.length > 0) {
            data.matched_entities = selectedCompanies;
        } else if (data && data.matched_entities) {
            // Sanitize: Ensure matched_entities is always string[]
            data.matched_entities = data.matched_entities.map((e: any) => {
                if (typeof e === 'string') return e;
                if (typeof e === 'object' && e !== null) {
                    return e.company_name || e.name || e.title || JSON.stringify(e);
                }
                return String(e);
            });
        }

        // Combine paragraphs into reasoning for frontend compatibility
        if (data) {
            const p1 = data.paragraph_1 || "";
            const p2 = data.paragraph_2 || "";
            const p3 = data.paragraph_3 || "";
            const p4 = data.paragraph_4 || "";
            data.reasoning = [p1, p2, p3, p4].filter(Boolean).join("\n\n");
        }

        return { data: data as MatchData };
    } catch (e: any) {
        return formatError(e);
    }
}

export async function extractCompaniesFromResume(resume: string, configOverride?: Partial<ProviderConfig>): Promise<{ data?: string[]; error?: string }> {
    try {
        const prompt = `
            Extract all distinct company names where this candidate has worked (EMPLOYERS ONLY), based on the Resume Summary below.
            
            CRITICAL RULES:
            1. EXCLUDE skills, programming languages, or tools (e.g., "Java", "Python", "AWS", "Azure", "React").
            2. EXCLUDE clients or projects if the candidate wasn't directly employed by them, unless it was a major contract role.
            3. ONLY include organizations where the candidate held a job title.
            
            Resume Summary:
            ${resume}

            Return JSON:
            { "companies": ["Company A", "Company B"] }
        `;
        const data = await fetchJSON(prompt, "ExtractCompanies", configOverride);
        return { data: data?.companies || [] };
    } catch (e: any) {
        console.error("Extract Companies Error:", e);
        return { data: [] };
    }
}


export async function fetchQuestions(
    company: string,
    position: string,
    round: string,
    configOverride?: Partial<ProviderConfig>,
    isRegeneration: boolean = false,
    count: number = 20
): Promise<{ data?: QuestionsData; error?: string }> {
    try {
        // Clamp count to reasonable limits
        const questionCount = Math.min(Math.max(count, 5), 30);

        const uniqueInstruction = isRegeneration
            ? "CRITICAL: Generate a COMPLETELY NEW and UNIQUE set of questions different from standard generic ones. Focus on niche, specific, or challenging aspects of this role/company to ensure variety."
            : "";

        const prompt = `
            Generate ${questionCount} interview questions for the role of ${position} at ${company} (Round: ${round}).
            ${uniqueInstruction}

            Categorize them exactly as follows:
            - **Behavioral**: Cultural fit, soft skills, past experiences (STAR method relevant).
            - **Knowledge**: Technical concepts, definitions, system design, or industry knowledge (Direct answers).
            - **Coding**: Algorithmic or practical coding challenges (if applicable to role).
            - **Case Study**: Hypothetical business or technical scenarios.

            Return JSON:
            {
              "questions": [
                { "id": "1", "category": "Behavioral", "question": "Tell me about a time you..." },
                { "id": "2", "category": "Knowledge", "question": "What is the difference between..." },
                ...
              ]
            }
        `;
        const data = await fetchJSON(prompt, "Questions", configOverride);
        return { data: data as QuestionsData };
    } catch (e: any) {
        return formatError(e);
    }
}

export async function fetchReverse(
    company: string,
    position: string,
    round: string,
    resume: string,
    stories: string,
    sources: string = "",
    configOverride?: Partial<ProviderConfig>,
    count: number = 5
): Promise<{ data?: ReverseQuestionsData; error?: string }> {
    try {
        // Clamp count to reasonable limits
        const questionCount = Math.min(Math.max(count, 3), 15);

        const prompt = `
            Generate ${questionCount} strategic questions for the candidate to ask the interviewer at ${company} (${position}, ${round}).
            Focus on deep insights, not surface level.

            Return JSON: { "reverse_questions": [{ "type": "Category Name", "question": "The question text" }] }
        `;
        const data = await fetchJSON(prompt, "Reverse", configOverride);
        return { data: data as ReverseQuestionsData };
    } catch (e: any) {
        return formatError(e);
    }
}

export async function fetchTechnicalQuestions(
    company: string,
    position: string,
    round: string,
    sources: string = "",
    configOverride?: Partial<ProviderConfig>,
    count: number = 5
): Promise<{ data?: TechnicalData; error?: string }> {
    try {
        // Clamp count to reasonable limits
        const questionCount = Math.min(Math.max(count, 3), 15);

        const prompt = `
            Context: ${company}, ${position}, ${round}. Sources: ${sources}
            Generate ${questionCount} conceptual technical questions (not coding).

            Return JSON:
            {
                "questions": [
                    { "topic": "Topic", "question": "Question text", "context_clue": "Hint" }
                ]
            }
        `;
        const data = await fetchJSON(prompt, "Technical", configOverride);
        return { data: data as TechnicalData };
    } catch (e: any) {
        return formatError(e);
    }
}

export async function explainTechnicalConcept(concept: string): Promise<string> {
    try {
        const prompt = `Explain this technical concept briefly for an interview context: "${concept}"`;
        return await generateGenericText(prompt);
    } catch (e: any) {
        console.error("Explanation Error:", e);
        return "Failed to generate explanation.";
    }
}

export async function fetchCodingChallenge(company: string, position: string, round: string, configOverride?: Partial<ProviderConfig>, challengeIndex?: number): Promise<{ data?: CodingChallenge; error?: string }> {
    try {
        const seniority = detectSeniority(position);
        const difficultyHint = seniority === 'junior' ? 'Easy to Medium' : seniority === 'senior' || seniority === 'staff+' ? 'Medium to Hard' : 'Medium';
        const uniqueHint = challengeIndex !== undefined ? `This is challenge #${challengeIndex + 1}. Make it DIFFERENT from other challenges — vary the topic (arrays, strings, trees, graphs, dynamic programming, hash maps, stacks, linked lists, etc).` : '';

        const prompt = `
            Generate a coding interview problem for a ${seniority} ${position} at ${company}.
            Model this after real coding interview problems from platforms like LeetCode and HackerRank.
            Difficulty: ${difficultyHint}.
            ${uniqueHint}

            Requirements:
            - Clear problem statement with context
            - Multiple examples showing input/output with edge cases
            - Explicit constraints (input size bounds, time/space complexity expectations)
            - Working starter code with function signature and parameter types
            - A brief hint about the optimal approach

            Return JSON:
            {
                "title": "Problem Title (e.g. Two Sum, Valid Parentheses)",
                "description": "Detailed markdown problem description",
                "examples": [{"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]"}, {"input": "nums = [3,2,4], target = 6", "output": "[1,2]"}],
                "constraints": ["1 <= nums.length <= 10^4", "Time: O(n)", "Space: O(n)"],
                "starter_code": "function solution(nums, target) {\\n  // Your code here\\n}",
                "solution_approach": "Brief hint about optimal approach"
            }
        `;
        const data = await fetchJSON(prompt, "Coding", configOverride);
        return { data: data as CodingChallenge };
    } catch (e: any) {
        return formatError(e);
    }
}

export async function generateCodeFeedback(code: string, problem: string): Promise<string> {
    try {
        const prompt = `
            Analyze this code solution for: ${problem}
            Code: ${code}
            Provide feedback on correctness, complexity, and style.
        `;
        return await generateGenericText(prompt);
    } catch (e: any) {
        console.error("Code Feedback Error:", e);
        return "Failed to generate feedback.";
    }
}

export async function generateGenericJSON(
    prompt: string,
    configOverride?: Partial<ProviderConfig>,
    /** Free-first rungs to try before the resolved model. Opt-in — omitting it
     *  is today's behaviour exactly. See lib/llm/model-ladder.ts. */
    modelLadder?: readonly string[],
): Promise<any> {
    try {
        return await fetchJSON(prompt, "Generic JSON", configOverride, modelLadder);
    } catch (e: any) {
        console.error("Generic JSON Error:", e);
        // Propagate the error message so callers can display it to the user
        const msg = e?.message || String(e) || "";
        return { error: formatError(e).error };
    }
}

export async function generateGenericText(prompt: string, configOverride?: Partial<ProviderConfig>): Promise<string> {
    try {
        const config = await getConfig(configOverride);
        await chargeIfSharedKey(config);
        const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

        const response = await provider.generate({
            prompt: prompt
        });

        if (response.error) throw new Error(response.error);
        return response.text || "Error generating text.";
    } catch (e: any) {
        console.error("Generic Text Error:", e);
        return "Error generating text.";
    }
}

export async function analyzeJobPosting(jobText: string, configOverride?: Partial<ProviderConfig>): Promise<{ data?: { company: string; position: string; round: string }; error?: string }> {
    try {
        const prompt = `
            Analyze the following job posting text and extract:
            1. Company Name (if not explicitly stated, infer from context or return "Unknown Company")
            2. Position/Role Title
            3. Interview Round (default to "Behavioral" if not specified, or infer "Technical" if it contains coding/system design keywords)

            Job Text:
            "${jobText.substring(0, 3000)}"

            Return JSON:
            {
                "company": "Company Name",
                "position": "Job Title",
                "round": "Behavioral" | "Technical" | "System Design" | "Managerial"
            }
        `;
        const data = await fetchJSON(prompt, "JobAnalysis", configOverride);
        return { data: data as { company: string; position: string; round: string } };
    } catch (e: any) {
        return formatError(e);
    }
}

/**
 * Detect the role type for specialized questions
 */
type RoleType = 'engineering' | 'product' | 'design' | 'data' | 'other';

function detectRoleType(position: string, round: string): RoleType {
    const combinedText = `${position} ${round}`.toLowerCase();

    // Product Management keywords
    const pmKeywords = ['product manager', 'product lead', 'pm ', ' pm', 'product owner', 'product director', 'apm', 'gpm', 'head of product'];
    if (pmKeywords.some(kw => combinedText.includes(kw))) {
        return 'product';
    }

    // Engineering keywords
    const engineeringKeywords = [
        'engineer', 'developer', 'architect', 'swe', 'sde', 'software',
        'backend', 'frontend', 'fullstack', 'devops', 'sre', 'infrastructure',
        'platform', 'systems', 'technical', 'coding'
    ];
    if (engineeringKeywords.some(kw => combinedText.includes(kw))) {
        return 'engineering';
    }

    // Design keywords
    const designKeywords = ['designer', 'ux', 'ui', 'design lead', 'creative'];
    if (designKeywords.some(kw => combinedText.includes(kw))) {
        return 'design';
    }

    // Data keywords
    const dataKeywords = ['data scientist', 'data analyst', 'ml engineer', 'machine learning', 'analytics'];
    if (dataKeywords.some(kw => combinedText.includes(kw))) {
        return 'data';
    }

    return 'other';
}

/**
 * Detect seniority level from position title
 */
function detectSeniority(position: string): 'junior' | 'mid' | 'senior' | 'staff+' {
    const lower = position.toLowerCase();

    if (lower.includes('staff') || lower.includes('principal') || lower.includes('distinguished')) {
        return 'staff+';
    }
    if (lower.includes('senior') || lower.includes('lead')) {
        return 'senior';
    }
    if (lower.includes('junior') || lower.includes('entry') || lower.includes('associate')) {
        return 'junior';
    }

    return 'mid'; // Default
}

/**
 * Fetch role-specific deep-dive questions
 * Combines curated question bank with AI-generated questions
 * Works for: Engineering (System Design), Product (PM), Design, Data roles
 */
export async function fetchSystemDesignQuestions(
    company: string,
    position: string,
    round: string,
    configOverride?: Partial<ProviderConfig>,
    count: number = 10,
    onlyCurated: boolean = false
): Promise<{ data?: import('@/types').SystemDesignData; error?: string }> {
    try {
        // Clamp count to reasonable limits
        const questionCount = Math.min(Math.max(count, 3), 20);
        // Split between curated (70%) and AI-generated (30%)
        const curatedCount = Math.max(Math.floor(questionCount * 0.7), 2);
        const aiCount = Math.max(questionCount - curatedCount, 1);

        // 1. Detect role type
        const roleType = detectRoleType(position, round);
        const seniority = detectSeniority(position);

        // 2. Get questions based on role type
        let curatedQuestions: any[] = [];
        let questionType = 'Technical';

        if (roleType === 'product') {
            // Use PM question bank
            const { selectPMQuestions, detectPMSeniority } = await import('@/lib/knowledge/pm-questions');
            const pmSeniority = detectPMSeniority(position);

            // Determine PM categories based on round
            let pmCategories: any[] | undefined;
            const roundLower = round.toLowerCase();

            if (roundLower.includes('product sense') || roundLower.includes('product design')) {
                pmCategories = ['product-sense', 'design'];
            } else if (roundLower.includes('execution') || roundLower.includes('technical')) {
                pmCategories = ['execution', 'technical'];
            } else if (roundLower.includes('strategy') || roundLower.includes('case')) {
                pmCategories = ['strategy', 'estimation'];
            } else if (roundLower.includes('behavioral') || roundLower.includes('leadership')) {
                pmCategories = ['behavioral', 'execution'];
            } else {
                // Mix of all for general rounds
                pmCategories = ['product-sense', 'strategy', 'execution', 'estimation'];
            }

            curatedQuestions = selectPMQuestions(pmSeniority, curatedCount, pmCategories);
            questionType = 'Product Management';

        } else if (roleType === 'engineering') {
            // Use System Design question bank
            const { selectQuestions } = await import('@/lib/knowledge/system-design-questions');

            let categories: any[] | undefined;
            const roundLower = round.toLowerCase();

            if (roundLower.includes('system design') || roundLower.includes('architecture')) {
                categories = ['design', 'fundamentals', 'scalability'];
            } else if (roundLower.includes('technical') || roundLower.includes('coding')) {
                categories = ['fundamentals', 'scalability', 'distributed'];
            } else {
                categories = ['design', 'fundamentals', 'scalability'];
            }

            curatedQuestions = selectQuestions(position, seniority, curatedCount, categories);
            questionType = 'System Design';

        } else {
            // For other roles, generate AI questions only
            questionType = roleType === 'design' ? 'Design' : roleType === 'data' ? 'Data & Analytics' : 'General';
        }

        if (onlyCurated) {
            return {
                data: {
                    questions: curatedQuestions,
                    curatedCount: curatedQuestions.length,
                    aiGeneratedCount: 0,
                    roleType: roleType as string
                }
            };
        }

        // 3. Generate additional AI questions tailored to company and role
        let aiQuestions: any[] = [];
        try {
            const aiPrompt = roleType === 'product'
                ? `Generate ${aiCount} Product Management interview questions for a ${position} at ${company} (${round}).

                   Focus on:
                   - Product sense and user empathy
                   - Metrics and data-driven decision making
                   - Strategy relevant to ${company}'s business
                   - Execution and stakeholder management

                   Make questions appropriately challenging for a ${seniority} level candidate.`
                : roleType === 'engineering'
                    ? `Generate ${aiCount} system design/technical interview questions for a ${position} at ${company} (${round}).

                   Focus on:
                   - Architecture relevant to ${company}'s scale
                   - Distributed systems concepts
                   - Trade-offs and practical considerations

                   Make questions appropriately challenging for a ${seniority} level candidate.`
                    : `Generate ${aiCount} interview questions for a ${position} at ${company} (${round}).

                   Focus on role-specific skills and knowledge areas.
                   Make questions appropriately challenging for this level.`;

            const prompt = `${aiPrompt}

                Return JSON:
                {
                    "questions": [
                        {
                            "id": "ai-001",
                            "category": "${questionType}",
                            "difficulty": "${seniority}",
                            "question": "Question text",
                            "topics": ["topic1", "topic2"],
                            "keyPoints": ["Key point 1", "Key point 2"]
                        }
                    ]
                }
            `;

            const aiData = await fetchJSON(prompt, `AI ${questionType} Questions`, configOverride);
            if (aiData?.questions && Array.isArray(aiData.questions)) {
                aiQuestions = aiData.questions.map((q: any, idx: number) => ({
                    id: `ai-${idx + 1}`,
                    question: q.question || q,
                    category: questionType,
                    difficulty: seniority,
                    topics: q.topics || [],
                    keyPoints: q.keyPoints || []
                }));
            }
        } catch (e) {
            console.warn('Failed to generate AI questions, using curated only', e);
        }

        // 4. Combine and return
        const allQuestions = [...curatedQuestions, ...aiQuestions];

        return {
            data: {
                questions: allQuestions,
                curatedCount: curatedQuestions.length,
                aiGeneratedCount: aiQuestions.length,
                roleType: roleType as string
            }
        };
    } catch (e: any) {
        return formatError(e);
    }
}

/**
 * Generate a strict, calibrated critique of the user's answer
 * Anti-Hallucination & Anti-Passivity Feature
 */
export async function generateAnswerCritique(
    question: QuestionItem,
    userAnswer: string,
    context: { company: string; position: string; round: string; reconData?: CompanyReconData; jobContextText?: string },
    configOverride?: Partial<ProviderConfig>
): Promise<{ data?: AnswerCritique; error?: string }> {
    try {
        const seniority = detectSeniority(context.position);

        // Anti-Hallucination: Explicitly instruct the AI to use ONLY proven facts if mentioning company specifics.
        const companyFacts = context.reconData
            ? `Verified Company Facts: ${JSON.stringify(context.reconData)}`
            : "No verified company data available. Do not invent specific product features or internal metrics.";
        const jobContextSection = context.jobContextText
            ? `\n\nJOB POSTING CONTEXT:\n${context.jobContextText}`
            : "";

        const prompt = `
            You are NOT a judge or a scorecard. You are the sharpest, warmest mentor this person has —
            someone who has sat on the other side of the table at ${context.company}, genuinely believes in them,
            and wants them to walk into that room ready. You are in their corner.

            They are preparing for a ${seniority} ${context.position} role at ${context.company}.
            They just answered this, out loud, a little nervous:

            QUESTION: "${question.question}"
            WHAT THEY SAID: "${userAnswer}"

            ${companyFacts}${jobContextSection}

            React like a real person who just listened to them — warm, present, specific. Your job is to make them
            feel SEEN first, then make them better. Two rules hold this together:
            1. NEVER be dishonest. Empty praise is a betrayal — they will feel it, and it will fail them in the room.
               If the answer was thin, rambling, or off-target, say so kindly and plainly.
            2. Be specific to THIS answer — react to their actual words, not generic advice. Find the one true thing
               they did well that they may not even realize was good, and the one change that would most raise their game.

            Talk TO them. Second person. Plain, human language — the way a great mentor talks at 11pm the night before.
            Adjust the bar to the level: ${seniority} (Junior = potential & coachability, Senior = trade-offs & impact, Staff = strategy & influence).
            Do not invent facts about ${context.company} you don't actually know.

            RETURN JSON:
            {
                "reaction": "2-3 sentences reacting to what they actually said — the moment they feel seen. Name the real, specific strength they may not realize they have. Warm, honest, human.",
                "the_one_thing": "The single highest-leverage change — just ONE thing, the one that matters most — said like a mentor leaning in, not a list of faults.",
                "say_it_like_this": "Rewrite the strongest version of THEIR answer, in their own voice (max 90 words), so they can hear how good it could sound.",
                "encouragement": "One honest, earned line that leaves them believing they can do this. Never hollow — tie it to something real they showed.",
                "score": 1-10 (number, for their private progress tracking only),
                "scoreLabel": "One gentle word: 'Getting there', 'Solid', 'Strong', or 'Ready'"
            }
        `;

        const data = await fetchJSON(prompt, "Critique", configOverride);
        return { data: data as AnswerCritique };
    } catch (e: any) {
        return formatError(e);
    }
}


// UNIFIED FETCH FUNCTIONS

async function fetchUnifiedReconMatch(
    company: string,
    position: string,
    round: string,
    resume: string,
    stories: string,
    configOverride?: Partial<ProviderConfig>,
    strategyLength: "brief" | "standard" | "detailed" = "standard",
    jobContextText: string = ""
): Promise<{ recon: CompanyReconData; match: MatchData } | { error: string }> {
    try {
        const fullContext = `RESUME SUMMARY:\n${resume}\n\nADDITIONAL STORIES:\n${stories}`;
        const jobContextSection = jobContextText ? `\n\nJOB POSTING CONTEXT:\n${jobContextText}` : "";
        const sanitizedCompany = company.trim().replace(/['"]/g, '');

        const unifiedLengthInstruction = strategyLength === "brief"
            ? "Write a CONCISE 150-200 word script in first-person (\"I\"). 2 short paragraphs: quick background + why this company."
            : strategyLength === "detailed"
            ? "Write a DETAILED 600-800 word script in first-person (\"I\") with 5+ paragraphs including specific project examples."
            : "Write a COMPREHENSIVE 450-600 word script in first-person (\"I\").";

        const unifiedStructureInstruction = strategyLength === "brief"
            ? `Structure:
            1. Background & Key Highlights
            2. Why ${sanitizedCompany}`
            : strategyLength === "detailed"
            ? `Structure:
            1. The Foundation (Education/Early)
            2. The Growth (Middle career, challenges/wins)
            3. The Peak (Recent/Senior roles, specific impacts)
            4. Key Projects (Specific examples with outcomes)
            5. The Alignment (Why ${sanitizedCompany}?)`
            : `Structure:
            1. The Foundation (Education/Early)
            2. The Growth (Middle career, challenges/wins)
            3. The Peak (Recent/Senior roles, specific impacts)
            4. The Alignment (Why ${sanitizedCompany}?)`;

        const prompt = `
            Context: Interview at ${sanitizedCompany} for '${position}' (Round: ${round}).
            Candidate Context: ${fullContext}${jobContextSection}

            Task: Perform TWO analyses in parallel.

            PART 1: COMPANY RECON
            Analyze ${sanitizedCompany}.
            - Description: 100-150 word executive summary.
            - Vibe: 3 culture keywords.
            - Business Model: How they make money.
            - Competitors: Top 3-5 competitors.

            PART 2: MATCH STRATEGY ("Tell me about yourself")
            ${unifiedLengthInstruction}
            ${unifiedStructureInstruction}
            
            CRITICAL:
            - Use ONLY provided Candidate Context.
            - NO specific metrics/numbers unless in resume.
            - "reasoning" field should contain the consolidated script.
            - **matched_entities**: You MUST extract the list of companies mentioned in the script.

            Return JSON:
            {
                "recon": {
                    "name": "Official Name",
                    "ticker": "Ticker/Private",
                    "industry": "Industry",
                    "description": "...",
                    "vibe": "...",
                    "business_model": "...",
                    "competitors": ["A", "B"]
                },
                "match": {
                    "headline": "Punchy 5-8 word headline",
                    "reasoning": "Full 4-paragraph script...",
                    "matched_entities": ["Company A", "Company B"]
                }
            }
        `;

        const data = await fetchJSON(prompt, "Unified Recon/Match", configOverride);

        if (!data || !data.recon || !data.match) throw new Error("Incomplete unified response");

        // Validate and sanitize Recon Data
        const validatedRecon: CompanyReconData = {
            name: data.recon.name || sanitizedCompany,
            ticker: data.recon.ticker || "Unknown",
            industry: data.recon.industry || "Technology",
            description: data.recon.description || `${sanitizedCompany} is a company in the technology sector.`,
            vibe: data.recon.vibe || "Professional",
            business_model: data.recon.business_model || "Not available",
            competitors: Array.isArray(data.recon.competitors) ? data.recon.competitors.slice(0, 5) : []
        };

        return {
            recon: validatedRecon,
            match: {
                headline: data.match.headline,
                reasoning: data.match.reasoning,
                matched_entities: Array.isArray(data.match.matched_entities) ? data.match.matched_entities : []
            }
        };

    } catch (e: any) {
        return { error: e.message || "Unified generation failed" };
    }
}

async function fetchUnifiedQuestions(
    company: string,
    position: string,
    round: string,
    configOverride: Partial<ProviderConfig>,
    counts: {
        questions: number;
        reverse: number;
        technical: number;
        systemDesign: number;
        coding: boolean;
    },
    context: {
        roleType: string;
        seniority: string;
        resume: string;
        stories: string;
        jobContextText?: string;
    }
): Promise<{
    questionsData: QuestionsData;
    reverseData: ReverseQuestionsData;
    technicalData?: TechnicalData;
    systemDesignData?: { questions: any[] };
    codingChallenge?: CodingChallenge;
} | { error: string }> {
    try {
        const { questions, reverse, technical, systemDesign, coding } = counts;
        const jobContextSection = context.jobContextText
            ? `\n\nJOB POSTING CONTEXT:\n${context.jobContextText}`
            : "";

        const prompt = `
            Generate interview questions for ${position} at ${company} (${round}).
            Role Type: ${context.roleType}, Seniority: ${context.seniority}.

            CANDIDATE CONTEXT:
            Resume Summary: ${context.resume}
            Additional Stories: ${context.stories}${jobContextSection}

            CRITICAL: Use the candidate's background to make questions specific and relevant where possible.

            TASKS:
            1. **General Questions** (${questions}): Behavioral, Knowledge, Case Study.
            2. **Reverse Questions** (${reverse}): Strategic questions to ask the interviewer.
            ${technical > 0 ? `3. **Technical Concepts** (${technical}): Conceptual questions (not coding).` : ""}
            ${systemDesign > 0 ? `4. **System Design/Product Questions** (${systemDesign}): Deep dive questions.` : ""}
            ${coding ? `5. **Coding Challenge**: One algorithm problem.` : ""}

            Return JSON:
            {
                "questions": [{ "id": "1", "category": "Behavioral", "question": "..." }],
                "reverse_questions": [{ "type": "Strategy", "question": "..." }],
                ${technical > 0 ? `"technical_questions": [{ "topic": "...", "question": "...", "context_clue": "..." }],` : ""}
                ${systemDesign > 0 ? `"system_design_questions": [{ "question": "...", "topics": [], "keyPoints": [] }],` : ""}
                ${coding ? `"coding_challenge": { "title": "...", "description": "...", "examples": [], "constraints": [], "starter_code": "..." }` : ""}
            }
        `;

        const data = await fetchJSON(prompt, "Unified Questions", configOverride);

        return {
            questionsData: { questions: data.questions || [] },
            reverseData: { reverse_questions: data.reverse_questions || [] },
            technicalData: data.technical_questions ? { questions: data.technical_questions } : undefined,
            systemDesignData: data.system_design_questions ? { questions: data.system_design_questions } : undefined,
            codingChallenge: data.coding_challenge
        };

    } catch (e: any) {
        return { error: e.message };
    }
}

/**
 * MASTER ORCHESTRATOR: FAANG-Style Backend Logic
 * Centralizes the entire interview prep generation flow on the server.
 * Enforces caching, rate limiting (via sequential/batching), and robust error handling.
 */
export async function generateInterviewPlan(
    company: string,
    position: string,
    round: string,
    resume: string,
    stories: string,
    settings: {
        modelConfig?: Partial<ProviderConfig>;
        prepSettings?: { questions: number; reverse: number; technical: number; systemDesign: number };
        outputPrefs?: { strategyLength: "brief" | "standard" | "detailed"; coverLetterLength: string };
        codingChallengeCount?: number;
        jobContext?: PrepJobContext;
    },
    forceRefresh: boolean = false
): Promise<{
    reconData?: CompanyReconData;
    matchData?: MatchData;
    questionsData?: QuestionsData;
    reverseData?: ReverseQuestionsData;
    technicalData?: TechnicalData;
    codingChallenges?: CodingChallenge[];
    systemDesignData?: SystemDesignData;
    error?: string;
    fromCache?: boolean;
    cacheKey?: string;
    jdFingerprint?: string;
    sessionReady?: boolean;
}> {
    try {
        const hasJd = (settings.jobContext?.content?.originalJd?.length ?? 0) > 0
            || (settings.jobContext?.content?.normalizedJd?.length ?? 0) > 0;
        const jdFingerprint = hasJd && settings.jobContext
            ? fingerprintJobContext(settings.jobContext)
            : undefined;

        console.log("[Orchestrator] Received settings:", JSON.stringify({
            hasJobContext: hasJd,
            jdFingerprint,
            prepSettings: settings.prepSettings,
            outputPrefs: settings.outputPrefs,
            codingChallengeCount: settings.codingChallengeCount,
            modelConfig: {
                provider: settings?.modelConfig?.provider,
                model: settings?.modelConfig?.model,
                apiKey: settings?.modelConfig?.apiKey ? "***" : "MISSING",
            },
        }, null, 2));

        const { primaryKey, legacyKey } = resolveCacheLookup(company, position, round, jdFingerprint);
        const cacheKey = primaryKey;
        const jobContextText = settings.jobContext?.content?.normalizedJd
            || settings.jobContext?.content?.originalJd
            || "";
        const hasResumeContext = resume.length > 20;

        // 1. Check Server Cache (if not forced)
        // Skip cache when the caller has resume context but the cached data was generated without it
        if (!forceRefresh) {
            const tryCacheKey = async (key: string) => {
                const { data: cached } = await fetchServerCache(key);
                if (!cached) return null;

                const cacheContextMatch = cached.hasResumeContext === hasResumeContext;
                const cacheUsable = cacheContextMatch && (!hasResumeContext || (hasResumeContext && cached.matchData));
                return cacheUsable ? cached : null;
            };

            const primaryCached = await tryCacheKey(primaryKey);
            if (primaryCached) {
                console.log("[Orchestrator] Server cache hit (primary key). hasResume:", hasResumeContext);
                const cachedCoding = (() => {
                    if (primaryCached.codingChallenges && Array.isArray(primaryCached.codingChallenges)) return primaryCached.codingChallenges;
                    const raw = (primaryCached as any).codingChallenge;
                    return Array.isArray(raw) ? raw : raw ? [raw] : [];
                })();
                return {
                    reconData: primaryCached.reconData,
                    matchData: primaryCached.matchData,
                    questionsData: primaryCached.questionsData,
                    reverseData: primaryCached.reverseData,
                    technicalData: primaryCached.technicalData,
                    codingChallenges: cachedCoding,
                    systemDesignData: primaryCached.systemDesignData,
                    fromCache: true,
                    cacheKey: primaryKey,
                    ...(jdFingerprint !== undefined ? { jdFingerprint } : {}),
                    sessionReady: planHasSessionQuestions(
                        primaryCached.questionsData,
                        primaryCached.systemDesignData,
                    ),
                };
            }

            if (!jdFingerprint && legacyKey !== primaryKey) {
                const legacyCached = await tryCacheKey(legacyKey);
                if (legacyCached) {
                    console.log("[Orchestrator] Server cache hit (legacy key). hasResume:", hasResumeContext);
                    const cachedCoding = (() => {
                        if (legacyCached.codingChallenges && Array.isArray(legacyCached.codingChallenges)) return legacyCached.codingChallenges;
                        const raw = (legacyCached as any).codingChallenge;
                        return Array.isArray(raw) ? raw : raw ? [raw] : [];
                    })();
                    return {
                        reconData: legacyCached.reconData,
                        matchData: legacyCached.matchData,
                        questionsData: legacyCached.questionsData,
                        reverseData: legacyCached.reverseData,
                        technicalData: legacyCached.technicalData,
                        codingChallenges: cachedCoding,
                        systemDesignData: legacyCached.systemDesignData,
                        fromCache: true,
                        cacheKey: legacyKey,
                        sessionReady: planHasSessionQuestions(
                            legacyCached.questionsData,
                            legacyCached.systemDesignData,
                        ),
                    };
                }
            } else {
                console.log("[Orchestrator] Skipping legacy cache (JD fingerprint present, primary miss).");
            }
        }

        // 3. Prepare Logic for Questions
        // Calculate needs for the question generation up front (inputs don't depend
        // on the recon/match output), so recon/match and questions can run together.
        const isTechnical = round.toLowerCase().includes('technical') ||
            position.toLowerCase().includes('engineer') ||
            position.toLowerCase().includes('developer') ||
            position.toLowerCase().includes('scientist') ||
            position.toLowerCase().includes('architect');

        const roleType = detectRoleType(position, round);
        const seniority = detectSeniority(position);

        const totalSysCount = settings.prepSettings?.systemDesign || 10;
        // Calculate how many AI questions we need (~30%, min 2).
        const aiSysCount = Math.max(Math.floor(totalSysCount * 0.3), 2);

        // 2+4. Run the two LLM generations (recon/match, questions) PLUS the
        // curated (non-LLM) system-design fetch concurrently, and tolerate partial
        // failure: if one of the two sequential calls fails we still return whatever
        // succeeded instead of throwing away the entire plan (mirrors the
        // coding-challenges allSettled path below). chargeIfSharedKey still runs
        // inside each fetchJSON, so credit/auth semantics are unchanged.
        const [reconMatchSettled, questionsSettled, sysSettled] = await Promise.allSettled([
            fetchUnifiedReconMatch(company, position, round, resume, stories, settings.modelConfig, settings.outputPrefs?.strategyLength || "standard", jobContextText),
            fetchUnifiedQuestions(company, position, round, settings.modelConfig ?? {}, {
                questions: settings.prepSettings?.questions || 20,
                reverse: settings.prepSettings?.reverse || 5,
                technical: isTechnical ? (settings.prepSettings?.technical || 10) : 0,
                systemDesign: aiSysCount,
                coding: isTechnical // generate one challenge if technical
            }, {
                roleType,
                seniority,
                resume,
                stories,
                jobContextText,
            }),
            fetchSystemDesignQuestions(company, position, round, settings.modelConfig, totalSysCount, true),
        ]);

        // Normalize each settled result to either its value or an error string.
        const reconMatchRes = reconMatchSettled.status === 'fulfilled'
            ? reconMatchSettled.value
            : { error: reconMatchSettled.reason?.message || String(reconMatchSettled.reason) };
        const questionsResKeys = questionsSettled.status === 'fulfilled'
            ? questionsSettled.value
            : { error: questionsSettled.reason?.message || String(questionsSettled.reason) };

        // Hard blocks (sign-in required / out of credits) must NOT be swallowed as a
        // "partial result" — propagate them so the client's sentinel UX fires.
        for (const r of [reconMatchRes, questionsResKeys]) {
            if (r && 'error' in r && typeof r.error === 'string' &&
                (r.error.startsWith(AUTH_REQUIRED) || r.error.startsWith(OUT_OF_CREDITS))) {
                throw new Error(r.error);
            }
        }

        const reconMatchOk = !('error' in reconMatchRes);
        const questionsOk = !('error' in questionsResKeys);

        // If BOTH core generations failed (non-sentinel), there's nothing to show.
        if (!reconMatchOk && !questionsOk) {
            const detail = ('error' in reconMatchRes && reconMatchRes.error) || ('error' in questionsResKeys && questionsResKeys.error) || "Failed to generate interview plan";
            throw new Error(typeof detail === 'string' ? detail : "Failed to generate interview plan");
        }

        if (!reconMatchOk) console.warn("[Orchestrator] Recon/Match failed, returning partial plan:", (reconMatchRes as { error: string }).error);
        if (!questionsOk) console.warn("[Orchestrator] Questions failed, returning partial plan:", (questionsResKeys as { error: string }).error);

        const reconData = reconMatchOk ? reconMatchRes.recon : undefined;
        const matchData = reconMatchOk ? reconMatchRes.match : undefined;

        // Curated system-design questions (non-LLM); empty if that fetch failed.
        const curatedQuestions = (sysSettled.status === 'fulfilled' ? sysSettled.value.data?.questions : undefined) || [];

        const {
            questionsData,
            reverseData,
            technicalData,
            codingChallenge: firstCodingChallenge,
            systemDesignData: aiSystemData,
        } = questionsOk
            ? questionsResKeys
            : { questionsData: undefined, reverseData: undefined, technicalData: undefined, codingChallenge: undefined, systemDesignData: undefined };

        // Generate additional coding challenges in parallel if requested
        const codingChallengeCount = settings.codingChallengeCount || (isTechnical ? 1 : 0);
        let codingChallenges: CodingChallenge[] = [];

        if (firstCodingChallenge) {
            codingChallenges.push(firstCodingChallenge);
        }

        if (codingChallengeCount > 1 && isTechnical) {
            const additionalCount = codingChallengeCount - codingChallenges.length;
            if (additionalCount > 0) {
                const additionalPromises = Array.from({ length: additionalCount }, (_, i) =>
                    fetchCodingChallenge(company, position, round, settings.modelConfig, codingChallenges.length + i)
                );
                const results = await Promise.allSettled(additionalPromises);
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value.data) {
                        codingChallenges.push(result.value.data);
                    }
                }
            }
        }

        const systemDesignCategory =
            roleType === "product" ? "Product Management" : "System Design";

        const finalSystemDesignQuestions = [
            ...curatedQuestions.map((q, idx) =>
                normalizeSystemDesignQuestion(q, idx, "curated", systemDesignCategory),
            ),
            ...(aiSystemData?.questions || []).map((q, idx) =>
                normalizeSystemDesignQuestion(q, idx, "ai", "System Design"),
            ),
        ];

        const finalSystemDesignData: SystemDesignData = {
            questions: finalSystemDesignQuestions,
            curatedCount: curatedQuestions.length,
            aiGeneratedCount: aiSystemData?.questions?.length || 0,
            roleType: roleType
        };

        const sessionReady = planHasSessionQuestions(questionsData, finalSystemDesignData);

        // 5. Save to Cache — ONLY when the plan is complete with session questions.
        // Caching a partial result would serve gaps as a cache hit forever.
        if (reconMatchOk && questionsOk && sessionReady) {
            const now = Date.now();
            const expires = now + 24 * 60 * 60 * 1000;

            const fullData = {
                id: crypto.randomUUID(),
                cacheKey,
                company,
                position,
                round,
                ...(jdFingerprint !== undefined ? { jdFingerprint } : {}),
                reconData,
                matchData,
                questionsData,
                reverseData,
                technicalData,
                codingChallenges,
                systemDesignData: finalSystemDesignData,
                resumeCompanies: [],
                hasResumeContext: resume.length > 20,
                createdAt: now,
                expiresAt: expires
            };

            void saveServerCache(fullData as any);
        }

        return {
            reconData,
            matchData,
            questionsData,
            reverseData,
            technicalData,
            codingChallenges,
            systemDesignData: finalSystemDesignData,
            fromCache: false,
            cacheKey,
            ...(jdFingerprint !== undefined ? { jdFingerprint } : {}),
            sessionReady,
        };

    } catch (e: any) {
        console.error("[Orchestrator] Plan generation failed:", e);
        return { error: e.message || "Failed to generate interview plan" };
    }
}
