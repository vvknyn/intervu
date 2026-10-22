"use server";

import { FieldValue } from "firebase-admin/firestore";
import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { ResumeData } from "@/types/resume";
import { migrateLegacyProfile } from "@/lib/resume/profile-migration";
import { resumeIsOnFile } from "@/lib/resume/resume-usable";
import { hasResumeContent } from "@/lib/resume/has-content";
import { syncPreferencesFromResume } from "@/lib/agent/resume-preferences";

/**
 * Presence-only signal for a returning visit: does this user have a usable
 * résumé on file, without shipping the résumé itself down to the client.
 * Reuses `fetchResumeData`'s read (same doc, same migration) and the shared
 * `resumeIsOnFile` bar rather than a second usability check — the client
 * gets a boolean, never the document.
 */
export async function hasUsableResumeOnFile(): Promise<{ hasResume: boolean; updatedAt?: string | null }> {
    const { data, text, updatedAt } = await fetchResumeData();
    const hasResume = resumeIsOnFile({ data, text });
    // A text-only résumé counts as on file without reading it here: the
    // browser structures it (`storedResumeData`), never this server.
    // `updatedAt` (a timestamp, nothing from the résumé) lets a guest copy
    // parsed more recently replace it on sign-in (`shouldAdoptGuestResume`).
    return { hasResume, ...(hasResume ? { updatedAt: updatedAt ?? null } : {}) };
}

/**
 * Fetch structured resume data from database
 */
export async function fetchResumeData(): Promise<{
    data?: ResumeData;
    /** The résumé as stored text, sent only when there is no structured copy
     *  with content (file uploads on /resume or Settings, MCP `set_resume`).
     *  Callers pass both to `storedResumeData` so the browser structures it:
     *  résumé parsing never runs on our servers. */
    text?: string;
    source?: string;
    confidence?: number;
    updatedAt?: string | null;
    error?: string;
}> {
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
        const resumeText = typeof docData?.resume_text === "string" ? docData.resume_text.trim() : "";
        const text = resumeText && !(resumeData && hasResumeContent(resumeData)) ? resumeText : undefined;

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
            text,
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
 * The résumé as Firestore will take it: no `undefined` anywhere. The Admin
 * SDK rejects an `undefined` field value outright (`ignoreUndefinedProperties`
 * is not set — see actions/application.ts), and a parsed résumé carries them
 * (an absent `linkedin`, `gpa`, `unconfirmedPlaces`…), so the structured save
 * could throw on a perfectly good upload. A JSON round trip drops them, the
 * same as the Postgres docstore already does (docstore/values.ts).
 */
export async function firestoreSafeResume(resumeData: ResumeData): Promise<ResumeData> {
    return JSON.parse(JSON.stringify(resumeData)) as ResumeData;
}

/**
 * Save structured resume data to database.
 *
 * On success the structured copy replaces any older one and the person's
 * search preferences pick up what the new résumé says where they never set
 * them themselves (`syncPreferencesFromResume`). If the structured write
 * fails, the plain-text copy is written AND the old structured copy is
 * removed: before 2026-10-13 the fallback left the previous `resume_data` in
 * place, and every read prefers that copy (`fetchResumeData`), so a new
 * upload "saved" and the old résumé came back on the next visit.
 */
export async function saveResumeData(
    resumeData: ResumeData,
    importSource?: 'pdf' | 'docx' | 'text' | 'manual',
    confidence?: number
): Promise<{ error?: string; textOnly?: boolean }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        console.log("[Resume] Saving resume data for:", user.uid);

        const db = getAdminDb();
        const savedAt = new Date().toISOString();
        const clean = await firestoreSafeResume(resumeData);

        // The résumé this one replaces: what it filled in the preferences is replaced too.
        const previous = ((await db.collection("profiles").doc(user.uid).get().catch(() => null))?.data()?.resume_data ?? null) as ResumeData | null;

        // Structured save is the canonical copy. Drop any plain-text twin
        // from an earlier save so both are not kept after this succeeds.
        try {
            const updateData: Record<string, any> = {
                resume_data: clean,
                resume_text: FieldValue.delete(),
                resume_last_updated: savedAt
            };

            if (importSource) updateData.resume_import_source = importSource;
            if (confidence !== undefined) updateData.resume_import_confidence = confidence;

            await db.collection("profiles").doc(user.uid).set(updateData, { merge: true });

            // Best effort, never fails the save: the résumé is on file either way.
            try {
                await syncPreferencesFromResume(user.uid, clean, previous);
            } catch (e: unknown) {
                console.warn("[Resume] Preference sync from résumé failed:", e instanceof Error ? e.message : e);
            }

            return {}; // Success

        } catch (e: any) {
            console.warn("[Resume] Primary save failed, attempting fallback to resume_text only:", e.message);
        }

        try {
            await db.collection("profiles").doc(user.uid).set(
                {
                    resume_text: resumeDataToText(clean),
                    // The new résumé must win the next read: remove the older structured copy.
                    resume_data: FieldValue.delete(),
                    resume_last_updated: savedAt,
                    ...(importSource ? { resume_import_source: importSource } : {}),
                },
                { merge: true },
            );
        } catch (fallbackError: any) {
            console.error("[Resume] Fallback Save Error:", fallbackError);
            return { error: fallbackError.message };
        }

        return { textOnly: true };
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
