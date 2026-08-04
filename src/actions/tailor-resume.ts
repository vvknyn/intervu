"use server";

import { TailoringRecommendation, ResumeExperience, ResumeCompetencyCategory, ResumeProfile, ResumeEducation, ResumeSection } from "@/types/resume";
import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";

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
        const originalProfile = input.originalProfile || {
            name: '', profession: '', yearsOfExperience: 0, location: '', email: '', phone: '', linkedin: ''
        };
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
