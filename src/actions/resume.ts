"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { ResumeData } from "@/types/resume";
import { migrateLegacyProfile } from "@/lib/resume/profile-migration";
import { resumeIsUsable } from "@/lib/resume/resume-usable";

/**
 * Presence-only signal for a returning visit: does this user have a usable
 * résumé on file, without shipping the résumé itself down to the client.
 * Reuses `fetchResumeData`'s read (same doc, same migration) and the shared
 * `resumeIsUsable` bar rather than a second usability check — the client
 * gets a boolean, never the document.
 */
export async function hasUsableResumeOnFile(): Promise<{ hasResume: boolean }> {
    const { data } = await fetchResumeData();
    return { hasResume: resumeIsUsable(data) };
}

/**
 * Fetch structured resume data from database
 */
export async function fetchResumeData(): Promise<{ data?: ResumeData; source?: string; confidence?: number; updatedAt?: string | null; error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();

        if (!doc.exists) {
            return { data: undefined };
        }

        const docData = doc.data();
        const resumeData = docData?.resume_data as ResumeData | undefined;

        // Backward-compat: profiles saved before the name/profession split have
        // the candidate's name sitting in `profession` (see profile-migration.ts).
        // Reshape at this single read chokepoint so every caller sees the current
        // shape; the migrated data is persisted back automatically the next time
        // the user saves.
        if (resumeData?.profile) {
            resumeData.profile = migrateLegacyProfile(resumeData.profile);
        }

        return {
            data: resumeData,
            source: docData?.resume_import_source,
            confidence: docData?.resume_import_confidence,
            // Same field `saveResumeData` writes on every save (below) and
            // `getBaseResumeSummaryForUser` (lib/resume/base-resume.ts) reads
            // for the Settings card — reused here so the match-score toolbar's
            // "scored against your résumé of {date}" line has one source of
            // truth for "when was this last touched", not a second read path.
            updatedAt: (docData?.resume_last_updated as string | undefined) ?? null
        };
    } catch (e: any) {
        console.error("[Resume] Fetch Exception:", e);
        return { error: e.message };
    }
}

/**
 * Save structured resume data to database
 */
export async function saveResumeData(
    resumeData: ResumeData,
    importSource?: 'pdf' | 'docx' | 'text' | 'manual',
    confidence?: number
): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        console.log("[Resume] Saving resume data for:", user.uid);

        // 1. Generate text representation for RAG/Context (Dashboard compatibility)
        const resumeText = resumeDataToText(resumeData);

        const db = getAdminDb();

        // 2. Try to update everything first (resume_data + resume_text)
        try {
            const updateData: Record<string, any> = {
                resume_data: resumeData,
                resume_text: resumeText,
                resume_last_updated: new Date().toISOString()
            };

            if (importSource) updateData.resume_import_source = importSource;
            if (confidence !== undefined) updateData.resume_import_confidence = confidence;

            await db.collection("profiles").doc(user.uid).update(updateData);

            return {}; // Success

        } catch (e: any) {
            // If error, fall back to resume_text only
            console.warn("[Resume] Primary save failed, attempting fallback to resume_text only:", e.message);
        }

        // 3. Fallback: Save ONLY resume_text (and text-based fields) for Dashboard compatibility
        // This ensures the "Resume Required" state is cleared even if structured storage fails
        try {
            await db.collection("profiles").doc(user.uid).update({
                resume_text: resumeText,
            });
        } catch (fallbackError: any) {
            console.error("[Resume] Fallback Save Error:", fallbackError);
            return { error: fallbackError.message };
        }

        return {};
    } catch (e: any) {
        console.error("[Resume] Save Exception:", e);
        return { error: e.message };
    }
}

/**
 * Convert structured ResumeData to plain text for RAG/Context
 */
function resumeDataToText(data: ResumeData): string {
    const parts = [];

    // Profile
    if (data.profile) {
        const p = data.profile;
        parts.push(`Name/Contact: ${p.name || p.profession} | ${p.email} | ${p.location}`);
        if (p.profession) {
            parts.push(`Profession: ${p.profession}`);
        }
    }

    // Summary
    if (data.generatedSummary) {
        parts.push(`SUMMARY:\n${data.generatedSummary}`);
    }

    // Experience
    if (data.experience && data.experience.length > 0) {
        parts.push("EXPERIENCE:");
        data.experience.forEach(exp => {
            parts.push(`${exp.role} at ${exp.company} (${exp.dates})\n${exp.description}`);
        });
    }

    // Skills
    if (data.competencies && data.competencies.length > 0) {
        parts.push("SKILLS:");
        data.competencies.forEach(comp => {
            parts.push(`${comp.category}: ${comp.skills.join(", ")}`);
        });
    }

    // Education
    if (data.education && data.education.length > 0) {
        parts.push("EDUCATION:");
        data.education.forEach(edu => {
            parts.push(`${edu.degree} at ${edu.institution} (${edu.year})`);
        });
    }

    return parts.join("\n\n");
}
