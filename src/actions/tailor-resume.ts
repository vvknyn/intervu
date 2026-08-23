"use server";

import { TailoringRecommendation, ResumeExperience, ResumeCompetencyCategory, ResumeProfile, ResumeEducation, ResumeSection, ResumeData, JobAnalysis, RecommendationCategory, RecommendationPriority } from "@/types/resume";
import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { getBaseResumeForUser } from "@/lib/resume/base-resume";
import { generateGenericJSON } from "@/actions/generate-context";
import { TAILOR_FREE_LADDER } from "@/lib/llm/models";
import { enforceResumeIntegrity, screenAdvisoryRecommendations } from "@/lib/resume/tailor-integrity";

/** Single blank-profile default — used wherever a stored version predates
 *  (or never had) a profile, so a missing field degrades to an honestly
 *  empty profile rather than a fabricated one. */
const BLANK_PROFILE: ResumeProfile = {
    name: '', profession: '', yearsOfExperience: 0, location: '', email: '', phone: '', linkedin: ''
};

/**
 * Input type for saving a resume version - supports both snapshots and tailored versions
 */
export interface SaveVersionInput {
    // Required
    versionName: string;

    // Original data (the base state)
    originalSummary?: string;
    originalExperience?: ResumeExperience[];
    originalCompetencies?: ResumeCompetencyCategory[];
    originalProfile?: ResumeProfile;
    originalEducation?: ResumeEducation[];
    sectionOrder?: ResumeSection[];

    // Tailored data (can be same as original for snapshots)
    tailoredSummary?: string;
    tailoredExperience?: ResumeExperience[];
    tailoredCompetencies?: ResumeCompetencyCategory[];

    // Optional job info (null for snapshots)
    jobAnalysisId?: string | null;
    companyName?: string;
    positionTitle?: string;

    // Optional metadata
    recommendations?: TailoringRecommendation[];
    appliedAt?: string;

    // For updates
    id?: string;
}

/**
 * Save or Update a tailored resume version (or snapshot)
 * Supports both:
 * - Snapshots: Resume saves without a job link (original = tailored)
 * - Tailored versions: Resume tailored for a specific job (stores diff)
 */
export async function saveTailoredVersion(
    input: SaveVersionInput
): Promise<{ data?: { id: string }; error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Must be authenticated to save version" };
        }

        // Validate required fields
        if (!input.versionName || input.versionName.trim() === '') {
            return { error: "Version name is required" };
        }

        // Normalize data - use empty arrays/objects for missing fields
        const originalSummary = input.originalSummary || '';
        const originalExperience = input.originalExperience || [];
        const originalCompetencies = input.originalCompetencies || [];
        const originalProfile = input.originalProfile || BLANK_PROFILE;
        const originalEducation = input.originalEducation || [];

        const tailoredSummary = input.tailoredSummary || originalSummary;
        const tailoredExperience = input.tailoredExperience || originalExperience;
        const tailoredCompetencies = input.tailoredCompetencies || originalCompetencies;

        const db = getAdminDb();

        // Build the payload
        const payload: Record<string, any> = {
            user_id: user.uid,
            version_name: input.versionName.trim(),
            job_analysis_id: input.jobAnalysisId || null,
            company_name: input.companyName || 'Snapshot',
            position_title: input.positionTitle || 'Resume snapshot',
            original_summary: originalSummary,
            original_experience: originalExperience,
            original_competencies: originalCompetencies,
            original_profile: originalProfile,
            original_education: originalEducation,
            section_order: input.sectionOrder || ['summary', 'experience', 'skills', 'education'],
            tailored_summary: tailoredSummary,
            tailored_experience: tailoredExperience,
            tailored_competencies: tailoredCompetencies,
            recommendations: input.recommendations || [],
            applied_at: input.appliedAt || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        console.log("[saveTailoredVersion] Saving version:", {
            versionName: payload.version_name,
            companyName: payload.company_name,
            hasJobAnalysisId: !!payload.job_analysis_id,
            experienceCount: originalExperience.length,
            isUpdate: !!input.id
        });

        if (input.id) {
            // Update existing version — verify ownership
            const docRef = db.collection('tailored_resumes').doc(input.id);
            const doc = await docRef.get();
            if (!doc.exists || doc.data()?.user_id !== user.uid) {
                return { error: "Version not found" };
            }
            await docRef.update(payload);
            console.log("[saveTailoredVersion] Updated version:", input.id);
            return { data: { id: input.id } };
        } else {
            payload.created_at = new Date().toISOString();
            const docRef = await db.collection('tailored_resumes').add(payload);
            console.log("[saveTailoredVersion] Created version:", docRef.id);
            return { data: { id: docRef.id } };
        }
    } catch (e: any) {
        console.error("[saveTailoredVersion] Unexpected error:", e);
        return { error: e.message || "Failed to save version" };
    }
}

// ---------------------------------------------------------------------------
// Apply-flow tailoring — spec docs/specs/2026-08-22-apply-resume-package.md
// Section A. `enforceResumeIntegrity` (lib/resume/tailor-integrity.ts) is the
// actual guarantee; everything here is thin I/O around it.
// ---------------------------------------------------------------------------

export interface TailorForJobInput {
    jobId: string;
    jobTitle: string;
    companyName: string;
    jobText: string;        // posting description, plain text
    jobUrl?: string;
}

/** "structured" — base résumé is ResumeData, so a diff and a saved version are
 *  possible. "advisory" — base résumé is plain text only: recommendations are
 *  real, but there is nothing structured to diff or save, and we say so rather
 *  than inventing a structure. */
export type TailorMode = "structured" | "advisory";

export interface TailorForJobResult {
    mode: TailorMode;
    analysis: JobAnalysis;
    recommendations: TailoringRecommendation[];
    /** Present only when mode === "structured". */
    tailored?: {
        summary: string;
        experience: ResumeExperience[];
        competencies: ResumeCompetencyCategory[];
    };
    /** Present only when mode === "structured" — what it started from, so the
     *  client can diff and pass both halves to saveTailoredVersion. */
    original?: ResumeData;
    /** How many model suggestions the integrity check threw away. */
    dropped: number;
}

const JOB_TEXT_CAP = 6000; // mirrors the 8000-char cap on résumé text in resume.ts:191

const NO_INVENTION_RULE =
    "CRITICAL: only reword, reorder, and re-emphasise what the résumé already says. " +
    "Never add an employer, title, date, degree, skill, tool, or number that isn't already there.";

/** Only summary + experience + competencies — profile and education are
 *  never sent to the model (spec A4: "Never send profile or education").
 *  Each experience entry is tagged with its id so a structured proposal can
 *  echo it back; `enforceResumeIntegrity` reverts any entry whose id drifts. */
function resumeBlockFromResumeData(data: ResumeData): string {
    const parts: string[] = [];
    if (data.generatedSummary) parts.push(`SUMMARY:\n${data.generatedSummary}`);
    if (data.experience.length > 0) {
        parts.push("EXPERIENCE:");
        data.experience.forEach((exp) => {
            parts.push(`[id:${exp.id}] ${exp.role} at ${exp.company} (${exp.dates})\n${exp.description}`);
        });
    }
    if (data.competencies.length > 0) {
        parts.push("SKILLS:");
        data.competencies.forEach((comp) => {
            parts.push(`${comp.category}: ${comp.skills.join(", ")}`);
        });
    }
    return parts.join("\n\n");
}

function buildTailorPrompt(resumeBlock: string, jobText: string, input: TailorForJobInput, mode: TailorMode): string {
    const tailoredShape = mode === "structured"
        ? `,
            "tailored": {
                "summary": "reworded professional summary — same facts as the original, no new ones",
                "experience": [
                    { "id": "SAME id as the matching original entry, e.g. from [id:...]", "company": "SAME as original", "role": "SAME as original", "dates": "SAME as original", "description": "reworded/reordered description — no new facts, numbers, or skills" }
                ],
                "competencies": [
                    { "category": "category name", "skills": ["only skills already present in the résumé"] }
                ]
            }`
        : "";

    return `
        You are tailoring a résumé for a specific job posting. ${NO_INVENTION_RULE}

        RÉSUMÉ:
        """
        ${resumeBlock}
        """

        JOB POSTING — ${input.companyName} — ${input.jobTitle}:
        """
        ${jobText}
        """

        Return ONLY this JSON shape:
        {
            "analysis": {
                "extractedRequirements": ["requirement from the posting", "..."],
                "extractedSkills": ["skill the posting asks for", "..."],
                "cultureIndicators": ["culture/value signal from the posting", "..."],
                "seniorityLevel": "e.g. Senior"
            },
            "recommendations": [
                { "id": "rec-1", "category": "summary|experience|skills|overall", "priority": "high|medium|low", "title": "short title", "original": "exact original text this replaces (omit for overall/skills)", "suggested": "the reworded text or skill, using ONLY facts already in the résumé", "reasoning": "why this helps for this job" }
            ]${tailoredShape}
        }

        Do not include a "profile" or "education" field anywhere in the response.
    `;
}

const RECOMMENDATION_CATEGORIES: RecommendationCategory[] = ["summary", "experience", "skills", "overall"];
const RECOMMENDATION_PRIORITIES: RecommendationPriority[] = ["high", "medium", "low"];

function normalizeRecommendations(raw: unknown): TailoringRecommendation[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((r: any, idx: number) => ({
        id: typeof r?.id === "string" && r.id.trim() ? r.id.trim() : `rec-${idx + 1}`,
        category: RECOMMENDATION_CATEGORIES.includes(r?.category) ? r.category : "overall",
        priority: RECOMMENDATION_PRIORITIES.includes(r?.priority) ? r.priority : "medium",
        title: typeof r?.title === "string" ? r.title : "",
        original: typeof r?.original === "string" ? r.original : undefined,
        suggested: typeof r?.suggested === "string" ? r.suggested : "",
        reasoning: typeof r?.reasoning === "string" ? r.reasoning : "",
    }));
}

function normalizeAnalysis(raw: any, input: TailorForJobInput, jobText: string): JobAnalysis {
    return {
        jobUrl: input.jobUrl,
        jobText,
        companyName: input.companyName,
        positionTitle: input.jobTitle,
        extractedRequirements: Array.isArray(raw?.extractedRequirements) ? raw.extractedRequirements : [],
        extractedSkills: Array.isArray(raw?.extractedSkills) ? raw.extractedSkills : [],
        cultureIndicators: Array.isArray(raw?.cultureIndicators) ? raw.cultureIndicators : [],
        seniorityLevel: typeof raw?.seniorityLevel === "string" ? raw.seniorityLevel : "",
    };
}

/** Untrusted model JSON coerced to the shape `enforceResumeIntegrity` expects
 *  — thin I/O sanitizing before the pure decision, never trusting the model
 *  for field types it could get wrong. */
function coerceExperience(raw: unknown): ResumeExperience[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((e: any) => ({
        id: typeof e?.id === "string" ? e.id : "",
        company: typeof e?.company === "string" ? e.company : "",
        role: typeof e?.role === "string" ? e.role : "",
        dates: typeof e?.dates === "string" ? e.dates : "",
        description: typeof e?.description === "string" ? e.description : "",
    }));
}

function coerceCompetencies(raw: unknown): ResumeCompetencyCategory[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((c: any) => ({
        category: typeof c?.category === "string" ? c.category : "",
        skills: Array.isArray(c?.skills) ? c.skills.filter((s: unknown) => typeof s === "string") : [],
    }));
}

export async function tailorResumeForJob(
    input: TailorForJobInput,
): Promise<{ data?: TailorForJobResult; error?: string; needs?: "auth" | "resume" }> {
    try {
        const user = await getServerUser();
        if (!user) return { needs: "auth" };

        const base = await getBaseResumeForUser(user.uid);
        if (base.source === "none") return { needs: "resume" };

        const jobText = input.jobText.slice(0, JOB_TEXT_CAP);
        const mode: TailorMode = base.source === "resume_data" ? "structured" : "advisory";
        const resumeBlock = base.source === "resume_data"
            ? resumeBlockFromResumeData(base.resume_data)
            : base.resume_text;

        const prompt = buildTailorPrompt(resumeBlock, jobText, input, mode);
        const result = await generateGenericJSON(prompt, undefined, TAILOR_FREE_LADDER);

        if (!result) return { error: "No response from AI. Please try again in a moment." };
        if (result.error) return { error: result.error };
        if (!result.analysis || !Array.isArray(result.recommendations)) {
            return { error: "AI response was incomplete. Please try again." };
        }

        const analysis = normalizeAnalysis(result.analysis, input, jobText);

        if (mode === "advisory") {
            // Same guarantee as the structured path, applied to the advice
            // itself — nothing here to revert (there's no ResumeData to diff),
            // but a recommendation still can't introduce a fact absent from
            // the résumé text.
            const resumeText = (base as { source: "resume_text"; resume_text: string }).resume_text;
            const { kept, dropped } = screenAdvisoryRecommendations(
                resumeText,
                normalizeRecommendations(result.recommendations),
            );
            return {
                data: {
                    mode,
                    analysis,
                    recommendations: kept,
                    dropped: dropped.length,
                },
            };
        }

        if (!result.tailored) {
            return { error: "AI response was incomplete. Please try again." };
        }

        const original = (base as { source: "resume_data"; resume_data: ResumeData }).resume_data;
        const recommendations = normalizeRecommendations(result.recommendations);
        const verdict = enforceResumeIntegrity(
            original,
            {
                summary: typeof result.tailored.summary === "string" ? result.tailored.summary : undefined,
                experience: coerceExperience(result.tailored.experience),
                competencies: coerceCompetencies(result.tailored.competencies),
            },
            recommendations,
        );

        if (verdict.violations.length > 0) {
            console.warn("[tailorResumeForJob] integrity violations:", verdict.violations);
        }

        const droppedIds = new Set(verdict.dropped.map((r) => r.id));
        return {
            data: {
                mode,
                analysis,
                recommendations: recommendations.filter((r) => !droppedIds.has(r.id)),
                tailored: verdict.tailored,
                original,
                dropped: verdict.dropped.length,
            },
        };
    } catch (e: any) {
        console.error("[tailorResumeForJob] Unexpected error:", e);
        return { error: e.message || "Failed to tailor résumé" };
    }
}

export interface TailoredVersionSummary {
    id: string;
    versionName: string;
    companyName: string;
    positionTitle: string;
    recommendationCount: number;
    createdAt: string | null;
    updatedAt: string | null;
}

/** Every field the tailored-versions list needs — the summary half of the
 *  document read below. Single place both `fetchTailoredVersionsAction` and
 *  `fetchTailoredVersionAction` read this shape from, so they can't drift
 *  apart in how they interpret the same document. */
function docToTailoredVersionSummary(id: string, d: FirebaseFirestore.DocumentData): TailoredVersionSummary {
    return {
        id,
        versionName: d.version_name || "",
        companyName: d.company_name || "",
        positionTitle: d.position_title || "",
        recommendationCount: Array.isArray(d.recommendations) ? d.recommendations.length : 0,
        createdAt: d.created_at ?? null,
        updatedAt: d.updated_at ?? null,
    };
}

export async function fetchTailoredVersionsAction(): Promise<{ data?: TailoredVersionSummary[]; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Must be authenticated" };

        const db = getAdminDb();
        const snapshot = await db.collection("tailored_resumes").where("user_id", "==", user.uid).get();

        // Sorted in code (newest updated_at first) rather than an `.orderBy()`
        // that would need a Firestore composite index on (user_id, updated_at).
        const versions: TailoredVersionSummary[] = snapshot.docs
            .map((doc) => docToTailoredVersionSummary(doc.id, doc.data()))
            .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

        return { data: versions };
    } catch (e: any) {
        console.error("[fetchTailoredVersionsAction] Unexpected error:", e);
        return { error: e.message || "Failed to fetch tailored versions" };
    }
}

/** The full document — the exact inverse of the payload `saveTailoredVersion`
 *  writes (see its `payload` object above). Both halves (original + tailored)
 *  are included so a single fetch can render a diff or render a PDF without a
 *  second round-trip. */
export interface TailoredVersionDetail extends TailoredVersionSummary {
    originalProfile: ResumeProfile;
    originalEducation: ResumeEducation[];
    originalSummary: string;
    originalExperience: ResumeExperience[];
    originalCompetencies: ResumeCompetencyCategory[];
    sectionOrder: ResumeSection[];
    tailoredSummary: string;
    tailoredExperience: ResumeExperience[];
    tailoredCompetencies: ResumeCompetencyCategory[];
    recommendations: TailoringRecommendation[];
}

function docToTailoredVersionDetail(id: string, d: FirebaseFirestore.DocumentData): TailoredVersionDetail {
    const originalProfile: ResumeProfile = d.original_profile || BLANK_PROFILE;
    const originalEducation: ResumeEducation[] = Array.isArray(d.original_education) ? d.original_education : [];
    const originalSummary: string = typeof d.original_summary === "string" ? d.original_summary : "";
    const originalExperience: ResumeExperience[] = Array.isArray(d.original_experience) ? d.original_experience : [];
    const originalCompetencies: ResumeCompetencyCategory[] = Array.isArray(d.original_competencies) ? d.original_competencies : [];

    return {
        ...docToTailoredVersionSummary(id, d),
        originalProfile,
        originalEducation,
        originalSummary,
        originalExperience,
        originalCompetencies,
        sectionOrder: Array.isArray(d.section_order) ? d.section_order : ['summary', 'experience', 'skills', 'education'],
        // A row saved before a tailored field existed (or that never diverged
        // from the original) degrades to its original half — never to an
        // empty résumé, and never an invented section.
        tailoredSummary: typeof d.tailored_summary === "string" ? d.tailored_summary : originalSummary,
        tailoredExperience: Array.isArray(d.tailored_experience) ? d.tailored_experience : originalExperience,
        tailoredCompetencies: Array.isArray(d.tailored_competencies) ? d.tailored_competencies : originalCompetencies,
        recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
    };
}

export async function fetchTailoredVersionAction(id: string): Promise<{ data?: TailoredVersionDetail; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Must be authenticated" };

        const db = getAdminDb();
        const docRef = db.collection("tailored_resumes").doc(id);
        const doc = await docRef.get();
        // Ownership check BEFORE returning anything — same pattern as
        // deleteTailoredVersionAction below. Missing and not-owned return the
        // identical "not found" so a caller can't distinguish "doesn't exist"
        // from "exists but isn't yours".
        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Version not found" };
        }

        return { data: docToTailoredVersionDetail(doc.id, doc.data()!) };
    } catch (e: any) {
        console.error("[fetchTailoredVersionAction] Unexpected error:", e);
        return { error: e.message || "Failed to fetch tailored version" };
    }
}

export async function deleteTailoredVersionAction(id: string): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Must be authenticated" };

        const db = getAdminDb();
        const docRef = db.collection("tailored_resumes").doc(id);
        const doc = await docRef.get();
        // Ownership check — same pattern as saveTailoredVersion's update path above.
        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Version not found" };
        }
        await docRef.delete();
        return {};
    } catch (e: any) {
        console.error("[deleteTailoredVersionAction] Unexpected error:", e);
        return { error: e.message || "Failed to delete version" };
    }
}
