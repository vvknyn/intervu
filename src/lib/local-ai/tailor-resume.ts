/**
 * Pure heuristic résumé tailor — no window, no model download.
 * Rules fallback when on-device generation is unavailable or rejected.
 */

import type { LocalAiEngineId } from "./engines/types";
import { ENGINE_LABELS } from "./engines/types";
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import type { ResumeData, ResumeExperience } from "@/types/resume";

export type TailorJobInput = {
    title: string;
    company?: string | null;
    tags?: string[] | null;
    description?: string | null;
    occupation?: string | null;
    location?: string | null;
};

export type TailorBulletDiff = {
    experienceId: string;
    company: string;
    role: string;
    before: string;
    after: string;
};

export type TailorDraft = {
    engineId: LocalAiEngineId;
    engineLabel: string;
    usedDescription: boolean;
    summaryBefore: string;
    summaryAfter: string;
    bullets: TailorBulletDiff[];
    tailored: ResumeData;
};

const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "as", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall",
    "can", "need", "our", "your", "their", "this", "that", "these", "those", "it", "its",
    "we", "you", "they", "he", "she", "who", "what", "which", "when", "where", "how", "all",
    "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just", "also", "into", "over",
    "about", "after", "before", "between", "through", "during", "without", "within", "along",
    "across", "while", "per", "via", "etc", "role", "job", "work", "team", "company",
]);

/** Small synonym clusters for implied JD ↔ résumé overlap. */
const RELATED: Record<string, string[]> = {
    roadmap: ["planning", "plan", "strategy", "priorit"],
    planning: ["roadmap", "plan", "strategy"],
    agile: ["scrum", "sprint", "kanban"],
    scrum: ["agile", "sprint"],
    develop: ["build", "engineer", "implement", "code"],
    build: ["develop", "engineer", "implement"],
    lead: ["led", "manage", "managed", "direct", "directed"],
    manage: ["lead", "led", "oversee", "managed"],
    product: ["pm", "program"],
    engineer: ["developer", "development", "engineering"],
    data: ["analytics", "analyst", "metrics"],
    design: ["ux", "ui", "user"],
};

const DESC_SLICE_CHARS = 1000;

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function uniqueTokens(text: string): string[] {
    return [...new Set(tokenize(text))];
}

function resumeVocabulary(resume: ResumeData): Set<string> {
    const parts = [
        resume.profile.profession,
        resume.generatedSummary,
        ...resume.competencies.flatMap((c) => [c.category, ...c.skills]),
        ...resume.experience.flatMap((e) => [e.role, e.company, e.description]),
    ];
    return new Set(tokenize(parts.join(" ")));
}

function extractJdKeywords(job: TailorJobInput): string[] {
    const descSlice = (job.description ?? "").slice(0, DESC_SLICE_CHARS);
    const raw = [job.title, ...(job.tags ?? []), job.occupation ?? "", descSlice].join(" ");
    return uniqueTokens(raw);
}

function jdKeywordsWithResumeOverlap(jdKeywords: string[], resumeTokens: Set<string>): string[] {
    const overlap: string[] = [];
    for (const kw of jdKeywords) {
        if (resumeTokens.has(kw)) {
            overlap.push(kw);
            continue;
        }
        for (const rt of resumeTokens) {
            if (rt.includes(kw) || kw.includes(rt)) {
                overlap.push(kw);
                break;
            }
        }
    }
    return [...new Set(overlap)];
}

function relatedJdTermsForBullet(bulletTokens: Set<string>, jdKeywords: string[]): string[] {
    const found: string[] = [];
    for (const jd of jdKeywords) {
        if (bulletTokens.has(jd)) {
            found.push(jd);
            continue;
        }
        const related = RELATED[jd] ?? [];
        if (related.some((r) => [...bulletTokens].some((bt) => bt.includes(r) || r.includes(bt)))) {
            found.push(jd);
        }
    }
    return found;
}

function splitDescriptionLines(description: string): string[] {
    return descriptionToBullets(description);
}

function firstMeaningfulBullet(description: string): { line: string; index: number; lines: string[] } | null {
    const lines = splitDescriptionLines(description);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length >= 8) return { line: lines[i], index: i, lines };
    }
    return null;
}

function replaceBulletLine(description: string, index: number, newLine: string, allLines: string[]): string {
    const rebuilt = allLines.map((l, i) => (i === index ? newLine : l));
    return rebuilt.join("\n");
}

function titleAlreadyInSummary(summary: string, title: string): boolean {
    const summaryLower = summary.toLowerCase();
    const titleLower = title.toLowerCase().trim();
    if (!titleLower) return true;
    if (summaryLower.includes(titleLower)) return true;
    const titleTokens = tokenize(title).filter((t) => t.length >= 4);
    return titleTokens.some((t) => summaryLower.includes(t));
}

function termAlreadyPresent(text: string, term: string): boolean {
    return text.toLowerCase().includes(term.toLowerCase());
}

function composeBaseSummary(resume: ResumeData): string {
    if (resume.generatedSummary?.trim()) return resume.generatedSummary.trim();
    const yoe = resume.profile.yearsOfExperience;
    const prof = resume.profile.profession?.trim() || "Professional";
    const skills = resume.competencies.flatMap((c) => c.skills).slice(0, 6);
    const skillPhrase = skills.length > 0 ? ` with expertise in ${skills.slice(0, 4).join(", ")}` : "";
    const yoePhrase = yoe > 0 ? `${yoe}+ years of experience` : "";
    return [prof, yoePhrase].filter(Boolean).join(" — ") + skillPhrase + ".";
}

/** Strip robotic heuristic tails before rewrite or after model output. */
export function stripRoboticSummaryTails(text: string): string {
    return text
        .replace(/\s*Hands-on with [^.?!]+[.?!]/gi, "")
        .replace(/\s*Recent focus includes [^.?!]+[.?!]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isFullHumanSummary(summary: string): boolean {
    const trimmed = summary.trim();
    return trimmed.length > 120 || (trimmed.match(/[.!?]/g)?.length ?? 0) >= 2;
}

function weaveTrustedAdvisorClause(overlapTerms: string[], result: string): string | null {
    const fresh = overlapTerms.filter((t) => !termAlreadyPresent(result, t) && t.length >= 4).slice(0, 2);
    if (fresh.length === 0) return null;
    const focus = fresh.join(" and ");
    if (/account|success|sla|stakeholder|enterprise|customer/i.test(focus)) {
        return `Bring deep fluency in ${focus} from a current enterprise book of business.`;
    }
    return null;
}

function rewriteSummary(
    base: string,
    job: TailorJobInput,
    overlapTerms: string[],
): string {
    let result = stripRoboticSummaryTails(base.trim());
    if (!result) return composeBaseSummary({ generatedSummary: base } as ResumeData);
    if (!result.endsWith(".")) result += ".";

    if (isFullHumanSummary(result)) {
        const clause = weaveTrustedAdvisorClause(overlapTerms, result);
        if (clause && !result.includes(clause)) {
            result = `${result.replace(/\.$/, "")}. ${clause}`;
        }
        return result.replace(/\.\s+\./g, ".").replace(/\.\./g, ".");
    }

    const title = job.title.trim();
    if (title && !titleAlreadyInSummary(result, title)) {
        const titleTokens = tokenize(title).filter((t) => t.length >= 4);
        const hasOverlap = titleTokens.some((t) => overlapTerms.includes(t));
        if (hasOverlap) {
            const clause = weaveTrustedAdvisorClause(overlapTerms, result);
            if (clause) {
                result = `${result.replace(/\.$/, "")}. ${clause}`;
            }
        }
    }

    return result.replace(/\.\s+\./g, ".").replace(/\.\./g, ".");
}

function substituteJdSynonym(bullet: string, jdKeywords: string[]): string {
    const bulletTokens = new Set(tokenize(bullet));
    const related = relatedJdTermsForBullet(bulletTokens, jdKeywords);
    if (related.length === 0) return bullet;

    const jdTerm = related[0];
    const cluster = [jdTerm, ...(RELATED[jdTerm] ?? [])];

    for (const candidate of cluster) {
        if (candidate === jdTerm) continue;
        const re = new RegExp(`\\b${candidate}\\b`, "i");
        if (re.test(bullet) && !termAlreadyPresent(bullet, jdTerm)) {
            return bullet.replace(re, (match) =>
                match.charAt(0) === match.charAt(0).toUpperCase() ? capitalize(jdTerm) : jdTerm,
            );
        }
    }

    for (const [key, synonyms] of Object.entries(RELATED)) {
        if (!cluster.includes(key) && key !== jdTerm) continue;
        for (const syn of synonyms) {
            const re = new RegExp(`\\b${syn}\\b`, "i");
            if (re.test(bullet) && syn !== jdTerm && !termAlreadyPresent(bullet, jdTerm)) {
                return bullet.replace(re, (match) =>
                    match.charAt(0) === match.charAt(0).toUpperCase() ? capitalize(jdTerm) : jdTerm,
                );
            }
        }
    }

    return bullet;
}

function capitalize(s: string): string {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function rewriteBullet(
    bullet: string,
    _jobTitle: string,
    jdKeywords: string[],
    _overlapTerms: string[],
): string {
    const cleaned = bullet.replace(/^[•\-\s]+/, "").trim();
    return substituteJdSynonym(cleaned, jdKeywords);
}

function selectExperiences(experience: ResumeExperience[], max = 4): ResumeExperience[] {
    return experience.filter((e) => e.description?.trim()).slice(0, max);
}

function cloneResume(resume: ResumeData): ResumeData {
    return JSON.parse(JSON.stringify(resume)) as ResumeData;
}

/** Detect legacy robotic heuristic patterns — useful in tests. */
export function looksRoboticTailor(text: string): boolean {
    const handsOnCount = (text.match(/Hands-on with/gi) ?? []).length;
    return (
        handsOnCount >= 1 ||
        /Recent focus includes/i.test(text) ||
        /Targeting .+ roles/i.test(text) ||
        /Skilled in /i.test(text) ||
        /^Led .+ — /m.test(text) ||
        /aligned with .+ responsibilities/i.test(text) ||
        /Results-driven/i.test(text)
    );
}

export function heuristicTailorResume(resume: ResumeData, job: TailorJobInput): TailorDraft {
    const tailored = cloneResume(resume);
    const jdKeywords = extractJdKeywords(job);
    const resumeTokens = resumeVocabulary(resume);
    const overlapTerms = jdKeywordsWithResumeOverlap(jdKeywords, resumeTokens);

    const summaryBefore = composeBaseSummary(resume);
    const summaryAfter = rewriteSummary(summaryBefore, job, overlapTerms);
    tailored.generatedSummary = summaryAfter;

    const bullets: TailorBulletDiff[] = [];
    const targets = selectExperiences(resume.experience, 4);

    for (const exp of targets) {
        const hit = firstMeaningfulBullet(exp.description);
        if (!hit) continue;

        const after = rewriteBullet(hit.line, job.title, jdKeywords, overlapTerms);
        const expIdx = tailored.experience.findIndex((e) => e.id === exp.id);
        if (expIdx >= 0) {
            tailored.experience[expIdx] = {
                ...tailored.experience[expIdx],
                description: replaceBulletLine(exp.description, hit.index, after, hit.lines),
            };
        }

        bullets.push({
            experienceId: exp.id,
            company: exp.company,
            role: exp.role,
            before: hit.line,
            after,
        });
    }

    return {
        engineId: "heuristic",
        engineLabel: ENGINE_LABELS.heuristic,
        usedDescription: Boolean(job.description?.trim()),
        summaryBefore,
        summaryAfter,
        bullets: bullets.slice(0, 4),
        tailored,
    };
}

/** Extract digit runs for truthfulness checks (model output validation). */
export function extractDigitRuns(text: string): string[] {
    return text.match(/\d+/g) ?? [];
}

export function introducesNewNumbers(original: string, rewritten: string): boolean {
    const orig = new Set(extractDigitRuns(original));
    return extractDigitRuns(rewritten).some((n) => !orig.has(n));
}
