"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { ResumeData, ResumeProfile, ResumeExperience, ResumeCompetencyCategory, ResumeEducation, ResumeConfidenceScores, UncertainField, ParsedResumeResult } from "@/types/resume";
import { generateGenericJSON } from "@/actions/generate-context";
import { ProviderConfig } from "@/lib/llm/types";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
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

/**
 * AI-powered resume parsing with confidence scores
 */
export async function parseResumeWithAI(
    content: string,
    contentType: 'pdf' | 'docx' | 'text',
    configOverride?: Partial<ProviderConfig>
): Promise<{ data?: ParsedResumeResult; error?: string }> {
    try {
        if (!content || content.trim().length < 50) {
            return { error: "Resume content too short. Please provide more text." };
        }

        const prompt = `
            You are an expert resume parser. Analyze the text and extract structured JSON.

            RESUME TEXT:
            """
            ${content.substring(0, 8000)}
            """

            EXTRACT:
            1. Profile: name (candidate's FULL NAME), profession (their job title / target role, e.g. "Product & Platform Lead" — NOT their name), yearsOfExperience (number), location, email, phone, linkedin.
            2. Experience: company, role, dates, description (preserve bullets as single string).
            3. Skills: grouped by category.
            4. Education: degree, institution, year.
            5. Professional Summary: Extract ENTIRE text of summary/profile/about section. If missing header, look for intro paragraph. Preserve full text.

            RETURN JSON:
            {
                "parsed": {
                    "profile": { "name": "Full Name", "profession": "Job Title", "yearsOfExperience": 5, "location": "City", "email": "email@example.com", "phone": "Phone", "linkedin": "URL" },
                    "experience": [{ "id": "exp-1", "company": "Company", "role": "Title", "dates": "2020-Present", "description": "• Point 1\\n• Point 2" }],
                    "competencies": [{ "category": "Tech Stack", "skills": ["Skill1", "Skill2"] }],
                    "education": [{ "id": "edu-1", "degree": "Degree", "institution": "School", "year": "2020" }],
                    "generatedSummary": "Full summary text here..."
                },
                "confidence": { "overall": 80, "profile": 80, "experience": 80, "competencies": 80, "education": 80, "summary": 80 },
                "uncertainFields": [],
                "warnings": []
            }
        `;

        const optimizedConfig = {
            ...configOverride
        };

        // Free models first, the paid default behind them — now the default for
        // every generation rather than this call site's own opt-in, so the
        // ladder is no longer named here. See lib/llm/models.ts FREE_LADDER.
        const result = await generateGenericJSON(prompt, optimizedConfig);

        if (!result) {
            return { error: "No response from AI. Please try again in a moment." };
        }

        if (result.error && !result.parsed) {
            return { error: result.error };
        }

        if (!result.parsed) {
            return { error: "Failed to parse resume structure. The AI response was incomplete. Please try again or use a different AI provider." };
        }

        // Helper to normalize newlines - converts literal \n strings to actual newlines
        // and ensures bullet points are on separate lines
        const normalizeDescription = (desc: string): string => {
            if (!desc) return "";

            // Replace literal \n with actual newlines
            let normalized = desc.replace(/\\n/g, '\n');

            // Also handle cases where bullets are run together without newlines
            // e.g., "• Point 1• Point 2" -> "• Point 1\n• Point 2"
            normalized = normalized.replace(/([^\n])([•\-\*])\s/g, '$1\n$2 ');

            // Normalize multiple newlines to double newlines max
            normalized = normalized.replace(/\n{3,}/g, '\n\n');

            return normalized.trim();
        };

        // Debug LLM response
        console.log("[Resume] LLM Response Keys:", result.parsed ? Object.keys(result.parsed) : "No parsed object");
        console.log("[Resume] Extracted Summary Raw:", result.parsed.generatedSummary || result.parsed.summary || result.parsed.professionalSummary || "MISSING");

        // Experience is derived first (ahead of profile) because years-of-experience
        // is computed from it below, not trusted from the model.
        const experience: ResumeExperience[] = Array.isArray(result.parsed.experience)
            ? result.parsed.experience.map((exp: any, idx: number) => ({
                id: exp.id || `exp-${idx + 1}`,
                company: exp.company || "",
                role: exp.role || "",
                dates: exp.dates || "",
                description: normalizeDescription(exp.description || "")
            }))
            : [];

        // Years of experience is computed in code from the parsed work-history dates,
        // never trusted from the model — an arithmetic result that drifts with the
        // model's training-cutoff notion of "now" is a lying value (e.g. it once
        // computed Feb 2013 -> "now" as 12 when the real answer was 13). The model's
        // own number is kept ONLY as a fallback for the rare case where no experience
        // entry had a parseable date.
        const computedYoE = computeYearsOfExperience(experience, new Date());
        const yearsOfExperience = computedYoE !== null
            ? computedYoE
            : Number(result.parsed.profile?.yearsOfExperience) || 0;

        // Validate and sanitize the parsed data
        const parsed: ResumeData = {
            profile: {
                name: result.parsed.profile?.name || "",
                profession: result.parsed.profile?.profession || "",
                yearsOfExperience,
                location: result.parsed.profile?.location || "",
                email: result.parsed.profile?.email || "",
                phone: result.parsed.profile?.phone || "",
                linkedin: result.parsed.profile?.linkedin || ""
            },
            experience,
            competencies: Array.isArray(result.parsed.competencies)
                ? result.parsed.competencies.map((comp: any) => ({
                    category: comp.category || "Skills",
                    skills: Array.isArray(comp.skills) ? comp.skills : []
                }))
                : [],
            education: Array.isArray(result.parsed.education)
                ? result.parsed.education.map((edu: any, idx: number) => ({
                    id: edu.id || `edu-${idx + 1}`,
                    degree: edu.degree || "",
                    institution: edu.institution || "",
                    year: edu.year || ""
                }))
                : [],
            generatedSummary: (result.parsed.generatedSummary || result.parsed.summary || result.parsed.professionalSummary || "").replace(/\\n/g, '\n').trim()
        };

        const confidence: ResumeConfidenceScores = {
            overall: Number(result.confidence?.overall) || 70,
            profile: Number(result.confidence?.profile) || 70,
            experience: Number(result.confidence?.experience) || 70,
            competencies: Number(result.confidence?.competencies) || 70,
            education: Number(result.confidence?.education) || 70,
            summary: Number(result.confidence?.summary) || 70
        };

        const uncertainFields: UncertainField[] = Array.isArray(result.uncertainFields)
            ? result.uncertainFields.map((field: any) => ({
                field: field.field || "",
                reason: field.reason || "",
                section: field.section || "profile"
            }))
            : [];

        const warnings: string[] = Array.isArray(result.warnings) ? result.warnings : [];

        // Add automatic warnings based on confidence
        if (confidence.overall < 70) {
            warnings.unshift("The AI had difficulty parsing your resume. Please review all sections carefully.");
        }
        if (confidence.experience < 70) {
            warnings.push("Some work experience entries may have parsing errors. Please verify dates and descriptions.");
        }
        if (confidence.competencies < 70) {
            warnings.push("Skills were found but could not be categorized automatically.");
        }

        return {
            data: {
                parsed,
                confidence,
                uncertainFields,
                warnings
            }
        };
    } catch (e: any) {
        console.error("[Resume] Parse Error:", e);
        return { error: e.message || "Failed to parse resume" };
    }
}

/**
 * Extract text from PDF file (server-side)
 * Uses unpdf library (lightweight, works in serverless runtimes)
 */
export async function extractPDFText(fileBase64: string): Promise<{ text?: string; error?: string }> {
    try {
        console.log("[Resume] Starting PDF extraction, base64 length:", fileBase64.length);

        // Validate input
        if (!fileBase64 || fileBase64.length < 100) {
            return { error: "Invalid PDF data received. Please try uploading again." };
        }

        // Convert base64 to Uint8Array
        let uint8: Uint8Array;
        try {
            const buffer = Buffer.from(fileBase64, 'base64');
            console.log("[Resume] Buffer created, size:", buffer.length, "bytes");

            const header = buffer.slice(0, 5).toString('ascii');
            if (!header.startsWith('%PDF')) {
                console.error("[Resume] Invalid PDF header:", header);
                return { error: "The file does not appear to be a valid PDF. Please check the file format." };
            }

            uint8 = new Uint8Array(buffer);
        } catch (bufferError) {
            console.error("[Resume] Buffer conversion error:", bufferError);
            return { error: "Failed to process PDF file. The file may be corrupted." };
        }

        // Extract text using unpdf
        let pages: string[];
        try {
            const { extractText } = await import('unpdf');
            console.log("[Resume] unpdf loaded, extracting text...");
            const result = await extractText(uint8);
            pages = result.text;
            console.log("[Resume] Extraction complete, pages:", result.totalPages);
        } catch (parseError: any) {
            console.error("[Resume] unpdf error:", parseError);
            const msg = parseError.message || '';

            if (/password/i.test(msg)) {
                return { error: "This PDF is password-protected. Please unlock it or paste the text directly." };
            }
            if (/encrypt/i.test(msg)) {
                return { error: "This PDF is encrypted. Please use an unencrypted version or paste the text directly." };
            }

            return { error: `Could not parse PDF: ${msg}. Please try pasting the content directly.` };
        }

        const rawText = pages.join('\n\n');

        // Validate extracted text
        if (!rawText || rawText.trim().length < 20) {
            return {
                error: "No text could be extracted from this PDF. It may be an image-based/scanned document. Please paste your resume text instead."
            };
        }

        // Clean up the text
        const cleanedText = rawText
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        console.log("[Resume] PDF extraction successful, cleaned text length:", cleanedText.length);

        return { text: cleanedText };
    } catch (e: any) {
        console.error("[Resume] PDF Extract Error:", e);
        const errorMsg = e.message || "Unknown error";
        return { error: `Failed to extract text from PDF: ${errorMsg}. Please try pasting the content directly.` };
    }
}

/**
 * Extract text from DOCX file (server-side)
 */
export async function extractDocxText(fileBase64: string): Promise<{ text?: string; error?: string }> {
    try {
        // Dynamic import to avoid bundling issues
        const mammoth = await import('mammoth');

        // Convert base64 to buffer
        const buffer = Buffer.from(fileBase64, 'base64');

        const result = await mammoth.extractRawText({ buffer });

        if (!result.value || result.value.trim().length < 50) {
            return { error: "Could not extract text from DOCX. The file may be empty or corrupted." };
        }

        return { text: result.value };
    } catch (e: any) {
        console.error("[Resume] DOCX Extract Error:", e);
        return { error: "Failed to extract text from DOCX. Please try pasting the content directly." };
    }
}
