export interface ResumeProfile {
    name: string;
    profession: string;
    yearsOfExperience: number;
    location: string;
    email: string;
    phone: string;
    linkedin?: string;
    website?: string;
    /**
     * Bare place names from the contact line ("Mississauga") that name no
     * region or country, so `location` stayed blank. Never a location or a
     * filter until the user confirms which place it is.
     */
    unconfirmedPlaces?: string[];
}

/** Every section `getSectionOrder` can place — the one place this set is
 *  enumerated, so `ResumeSection` and the missing-section merge below can't
 *  drift apart. */
export const ALL_SECTIONS = ['summary', 'skills', 'experience', 'projects', 'education'] as const;
export type ResumeSection = (typeof ALL_SECTIONS)[number];
export type ProfessionType = 'engineering' | 'product' | 'design' | 'data' | 'business' | 'general';

// Helper to detect profession type from title
export function detectProfessionType(profession: string): ProfessionType {
    const lower = profession.toLowerCase();

    if (lower.includes('engineer') || lower.includes('developer') || lower.includes('architect') ||
        lower.includes('devops') || lower.includes('sre') || lower.includes('software') ||
        lower.includes('frontend') || lower.includes('backend') || lower.includes('fullstack')) {
        return 'engineering';
    }
    if (lower.includes('product') || lower.includes('program') || lower.includes('project') ||
        lower.includes('scrum') || lower.includes('agile')) {
        return 'product';
    }
    if (lower.includes('design') || lower.includes('ux') || lower.includes('ui') ||
        lower.includes('creative') || lower.includes('graphic')) {
        return 'design';
    }
    if (lower.includes('data') || lower.includes('analyst') || lower.includes('analytics') ||
        lower.includes('scientist') || lower.includes('ml') || lower.includes('machine learning')) {
        return 'data';
    }
    if (lower.includes('business') || lower.includes('finance') || lower.includes('consultant') ||
        lower.includes('strategy') || lower.includes('operations') || lower.includes('sales') ||
        lower.includes('marketing')) {
        return 'business';
    }
    return 'general';
}

/** The default section order for a profession/experience combination — every
 *  branch is a permutation of `ALL_SECTIONS`, so `getSectionOrder` below can
 *  merge any section a saved order predates without a section-specific case. */
function defaultSectionOrder(yearsOfExperience: number, professionType: ProfessionType): ResumeSection[] {
    const isFresher = yearsOfExperience < 3;

    // Freshers: Education first, then skills, then experience
    if (isFresher) {
        switch (professionType) {
            case 'engineering':
            case 'design':
            case 'data':
                return ['summary', 'skills', 'education', 'experience', 'projects'];
            default:
                return ['summary', 'education', 'skills', 'experience', 'projects'];
        }
    }

    // Experienced: Experience first, then skills
    switch (professionType) {
        case 'engineering':
        case 'data':
            return ['summary', 'skills', 'experience', 'projects', 'education'];
        case 'product':
        case 'business':
        default:
            return ['summary', 'experience', 'projects', 'skills', 'education'];
    }
}

/** Inserts every section that's in `defaultOrder` but missing from `saved`
 *  at the position it would occupy by default — i.e. immediately after the
 *  nearest earlier (in default order) section that's already present, or at
 *  the start if none is. General merge, not a per-section splice: a section
 *  order saved before ANY given section existed still gets that section back
 *  in a sensible spot, not just 'projects'. */
function mergeMissingSections(saved: ResumeSection[], defaultOrder: ResumeSection[]): ResumeSection[] {
    const merged = [...saved];
    for (const section of defaultOrder) {
        if (merged.includes(section)) continue;
        const defaultIdx = defaultOrder.indexOf(section);
        let insertAt = merged.length;
        for (let i = defaultIdx - 1; i >= 0; i--) {
            const anchorIdx = merged.indexOf(defaultOrder[i]);
            if (anchorIdx !== -1) {
                insertAt = anchorIdx + 1;
                break;
            }
        }
        merged.splice(insertAt, 0, section);
    }
    return merged;
}

/**
 * The ONLY reader of `data.sectionOrder` — every consumer that needs a
 * résumé's section order (live preview, markdown/zip-markdown/docx export,
 * the editing panel nav) calls this instead of reading the field directly,
 * so a saved order from before a section existed (e.g. a résumé reordered
 * before 'projects' shipped) still surfaces that section rather than
 * silently dropping it for whoever bypassed the merge.
 */
export function getSectionOrder(data: {
    sectionOrder?: ResumeSection[];
    profile?: { yearsOfExperience?: number; profession?: string };
}): ResumeSection[] {
    const professionType = detectProfessionType(data.profile?.profession || '');
    const defaultOrder = defaultSectionOrder(data.profile?.yearsOfExperience || 0, professionType);
    const saved = data.sectionOrder;
    if (!saved || saved.length === 0) return defaultOrder;
    return mergeMissingSections(saved, defaultOrder);
}

export interface ResumeExperience {
    id: string;
    company: string;
    role: string;
    dates: string;
    description: string;
}

export interface ResumeCompetencyCategory {
    category: string;
    skills: string[];
}

export interface ResumeEducation {
    id: string;
    degree: string;
    institution: string;
    year?: string;
    /** Typed by the person — never inferred/extracted from an upload. */
    gpa?: string;
    honours?: string[];
    coursework?: string[];
    activities?: string[];
}

export interface ResumeData {
    profile: ResumeProfile;
    experience: ResumeExperience[];
    projects?: ResumeExperience[];
    competencies: ResumeCompetencyCategory[];
    education: ResumeEducation[];
    generatedSummary: string;
    sectionOrder?: ResumeSection[]; // Custom section order (if user has manually reordered)
    /** Each section's heading as the uploaded résumé words it ("Work History"), so an export keeps the original's wording. */
    sectionHeadings?: Partial<Record<ResumeSection, string>>;
    /** Sections beyond the five above (Certifications, Languages, Awards), kept as written so an export prints them in place. */
    additionalSections?: ResumeAdditionalSection[];
    /** The name and contact lines as the uploaded résumé printed them. */
    sourceHeader?: ResumeSourceHeader;
}

export interface ResumeSourceHeader {
    /** The line the name came from, credentials and all ("Amara Okafor, RN"); "" when none. */
    nameLine: string;
    contactLines: string[];
}

export interface ResumeAdditionalSection {
    heading: string;
    /** One entry per line or bullet of the source section. */
    lines: string[];
    /** The modelled section it followed in the source; null when it came before all of them. */
    after: ResumeSection | null;
}

// Resume Parsing Types
export interface ResumeConfidenceScores {
    overall: number;
    profile: number;
    experience: number;
    competencies: number;
    education: number;
    summary: number;
}

export interface UncertainField {
    field: string;
    reason: string;
    section: 'profile' | 'experience' | 'competencies' | 'education' | 'summary';
}

export interface ParsedResumeResult {
    parsed: ResumeData;
    confidence: ResumeConfidenceScores;
    uncertainFields: UncertainField[];
    warnings: string[];
}

// Resume Tailoring Types
export interface JobAnalysis {
    id?: string;
    jobUrl?: string;
    jobText: string;
    companyName: string;
    positionTitle: string;
    extractedRequirements: string[];
    extractedSkills: string[];
    cultureIndicators: string[];
    seniorityLevel: string;
}

export type RecommendationPriority = 'high' | 'medium' | 'low';
export type RecommendationCategory = 'summary' | 'experience' | 'skills' | 'overall';

export interface TailoringRecommendation {
    id: string;
    category: RecommendationCategory;
    priority: RecommendationPriority;
    title: string;
    original?: string;
    suggested: string;
    reasoning: string;
}

export interface ExperienceComparison {
    experienceId: string;
    original: string;
    tailored: string;
    changes: string[]; // List of what changed
}

export interface TailoredResumeVersion {
    id?: string;
    userId?: string;
    jobAnalysisId?: string;
    versionName: string;

    // Original snapshot - FULL resume data
    originalSummary: string;
    originalExperience: ResumeExperience[];
    originalCompetencies: ResumeCompetencyCategory[];
    originalProfile: ResumeProfile;        // Added to prevent name/contact info loss
    originalEducation: ResumeEducation[];  // Added to prevent education loss
    sectionOrder?: ResumeSection[];        // Added to preserve custom section ordering

    // Tailored content
    tailoredSummary: string;
    tailoredExperience: ResumeExperience[];
    tailoredCompetencies: ResumeCompetencyCategory[];

    // Recommendations
    recommendations: TailoringRecommendation[];

    // Metadata
    companyName: string;
    positionTitle: string;
    jobPosting?: string; // Original job posting text
    appliedAt?: string;
    createdAt?: string;
    updatedAt?: string;
}
