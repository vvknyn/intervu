/**
 * Pure heuristic résumé tailor — no window, no model download.
 * Rules fallback when on-device generation is unavailable or rejected.
 */

import type { LocalAiEngineId } from "./engines/types";
import { ENGINE_LABELS } from "./engines/types";
import { resumeMatchText } from "@/lib/resume/match-text";
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
    /** Which array on `ResumeData` this bullet's `experienceId` indexes into
     *  — `experience` and `projects` share the same id-bearing shape, so a
     *  diff must say which one a revert (tailor-with-engine.ts) should
     *  patch. */
    source: "experience" | "project";
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

/**
 * Every field of the résumé that counts as "the résumé's own text" — single
 * source for both keyword-overlap scoring (`resumeVocabulary`, stopword-
 * filtered, below) and the grounding truthfulness check
 * (`tailor-with-engine.ts`'s `groundDraft`, which needs the raw, unfiltered
 * text — stopwords like "team"/"company" are ordinary words a rewrite is
 * allowed to reuse, not fabricated claims).
 *
 * Builds on `resumeMatchText` (match-text.ts) — the one place that owns
 * "what free text counts as the résumé's own" (summary, experience
 * descriptions, project descriptions, skills) — layering on the structural
 * fields match-text.ts intentionally omits (profession, competency category
 * labels, experience/project role & company) so a bullet rewrite is free to
 * reuse a job title or employer name without tripping the grounding gate.
 */
export function resumeFullText(resume: ResumeData): string {
    return [
        resume.profile.profession,
        resumeMatchText(resume),
        ...resume.competencies.map((c) => c.category),
        ...resume.experience.flatMap((e) => [e.role, e.company]),
        ...(resume.projects ?? []).flatMap((p) => [p.role, p.company]),
    ].join(" ");
}

function resumeVocabulary(resume: ResumeData): Set<string> {
    return new Set(tokenize(resumeFullText(resume)));
}

function extractJdKeywords(job: TailorJobInput): string[] {
    const descSlice = (job.description ?? "").slice(0, DESC_SLICE_CHARS);
    const raw = [job.title, ...(job.tags ?? []), job.occupation ?? "", descSlice].join(" ");
    return uniqueTokens(raw);
}

/** The role's words (title, tags, occupation, the start of the posting): what a one-page tailored PDF keeps bullets for. */
export function roleTermsForJob(job: TailorJobInput): string[] {
    return extractJdKeywords(job);
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
    return description
        .split(/\n|•/)
        .map((l) => l.replace(/^[\s\-*]+/, "").trim())
        .filter(Boolean);
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

// Used to append a fabricated "Recent focus includes <title> work." clause
// whenever the job title wasn't already reflected in the summary — a claim
// about what the candidate has recently been doing that the résumé itself
// never made. Deleted (front-door C1): a tailor that cannot invent leaves
// the summary alone instead of inventing a sentence to cover the gap.
function rewriteSummary(
    base: string,
    overlapTerms: string[],
): string {
    let result = base.trim();
    if (!result.endsWith(".")) result += ".";

    const freshTerms = overlapTerms.filter((t) => !termAlreadyPresent(result, t)).slice(0, 2);
    if (freshTerms.length > 0) {
        const woven =
            freshTerms.length === 1
                ? `Hands-on with ${freshTerms[0]}.`
                : `Hands-on with ${freshTerms[0]} and ${freshTerms[1]}.`;
        result = `${result.replace(/\.$/, "")}. ${woven}`;
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

/** Shared by both experience and project bullets — `ResumeData.projects`
 *  entries reuse the exact `ResumeExperience` shape, so one selector serves
 *  both. */
function selectBulletSources(entries: ResumeExperience[], max = 4): ResumeExperience[] {
    return entries.filter((e) => e.description?.trim()).slice(0, max);
}

/** Rewrites the first meaningful bullet of every eligible entry in `entries`
 *  (experience OR projects — same shape), patching the matching entry in
 *  `tailoredList` in place and returning one `TailorBulletDiff` per rewrite,
 *  tagged with `source` so a later revert patches the right array. */
function tailorBulletsForEntries(
    entries: ResumeExperience[],
    tailoredList: ResumeExperience[],
    source: TailorBulletDiff["source"],
    job: TailorJobInput,
    jdKeywords: string[],
    overlapTerms: string[],
    max: number,
): TailorBulletDiff[] {
    const bullets: TailorBulletDiff[] = [];
    for (const entry of selectBulletSources(entries, max)) {
        const hit = firstMeaningfulBullet(entry.description);
        if (!hit) continue;

        const after = rewriteBullet(hit.line, job.title, jdKeywords, overlapTerms);
        const idx = tailoredList.findIndex((e) => e.id === entry.id);
        if (idx >= 0) {
            tailoredList[idx] = {
                ...tailoredList[idx],
                description: replaceBulletLine(entry.description, hit.index, after, hit.lines),
            };
        }

        bullets.push({
            experienceId: entry.id,
            source,
            company: entry.company,
            role: entry.role,
            before: hit.line,
            after,
        });
    }
    return bullets;
}

function cloneResume(resume: ResumeData): ResumeData {
    return JSON.parse(JSON.stringify(resume)) as ResumeData;
}

/** Detect legacy robotic heuristic patterns — useful in tests. */
export function looksRoboticTailor(text: string): boolean {
    return (
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
    const summaryAfter = rewriteSummary(summaryBefore, overlapTerms);
    tailored.generatedSummary = summaryAfter;

    const bullets: TailorBulletDiff[] = [
        ...tailorBulletsForEntries(resume.experience, tailored.experience, "experience", job, jdKeywords, overlapTerms, 4),
        ...tailorBulletsForEntries(resume.projects ?? [], tailored.projects ?? [], "project", job, jdKeywords, overlapTerms, 4),
    ];

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
