/**
 * The résumé lines that bear on one application question: the only part of the
 * résumé a screening answer is drafted from, and the only part sent to the
 * sealed AI server. Plain word matching, the same on every device (`wordKey`,
 * tailor-asks.ts): a line bears on a question when they share a word that
 * carries meaning, in any form ("migrated" / "migration"). A broad question
 * ("Why are you interested in this role?", "Tell us about yourself") is
 * answered from the lines that bear on the role's title and the résumé's
 * summary. A question no line bears on gets none, and then nothing is drafted
 * and nothing is sent.
 *
 * Every line leaves here without the person's name, email, phone numbers and
 * links (`withoutContactDetails`, and each part of the name on its own).
 */
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import { withoutContactDetails } from "@/lib/resume/without-contact";
import { wordKey } from "@/lib/local-ai/tailor-asks";
import type { ResumeData } from "@/types/resume";

export interface EvidenceLine {
    text: string;
    /** Where it is on the résumé: "Role · Company", "Summary" or "Skills". */
    where: string;
    source: "experience" | "project" | "summary" | "skills";
}

/** Lines a draft is made from and sent with: enough to answer from, few enough to keep a request small. */
export const EVIDENCE_MAX = 4;
/** A line longer than this is cut at a word. */
const LINE_MAX_CHARS = 280;
/** A line this much shorter after taking out contact details was mostly contact details: left out. */
const SCRUB_KEEP_RATIO = 0.6;
const LINE_MIN_CHARS = 15;

/** Questions about the person or the fit, which the role's title and the summary answer better than a word match. */
const BROAD =
    /\b(about (yourself|you)|introduce yourself|why (do you want|are you (interested|applying)|this (role|position|job|company|team)|us\b|should we)|what (interests|excites|attracts|motivates|draws)|strengths?|good fit|your background|most proud|biggest (achievement|accomplishment)|greatest (achievement|accomplishment))\b/i;

function keysOf(text: string): Set<string> {
    const out = new Set<string>();
    for (const word of text.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []) {
        const key = wordKey(word);
        if (key) out.add(key);
    }
    return out;
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pure: the line without the person's name and contact details, or null when little else was left. */
export function scrubbedLine(text: string, name?: string): string | null {
    let out = withoutContactDetails(text, name);
    for (const part of (name ?? "").split(/\s+/)) {
        if (part.replace(/[^\p{L}]/gu, "").length >= 3) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(part)}(?![\\p{L}\\p{N}])`, "giu"), "");
    }
    out = out.replace(/\(\s*[,;|]*\s*\)/g, "").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
    if (out.length > LINE_MAX_CHARS) out = `${out.slice(0, LINE_MAX_CHARS).replace(/\s+\S*$/, "")}…`;
    return out.length >= LINE_MIN_CHARS && out.length >= text.trim().length * SCRUB_KEEP_RATIO ? out : null;
}

/** Whether a question is one the role's title and the summary answer ("Why are you interested in this role?"). */
export function isBroadQuestion(question: string): boolean {
    return BROAD.test(question);
}

interface Candidate extends EvidenceLine {
    order: number;
}

function candidates(resume: ResumeData): Candidate[] {
    const out: Candidate[] = [];
    const push = (line: Omit<EvidenceLine, "text"> & { text: string }) => out.push({ ...line, order: out.length });
    for (const sentence of (resume.generatedSummary ?? "").split(/(?<=[.!?])\s+/)) {
        if (sentence.trim()) push({ text: sentence.trim(), where: "Summary", source: "summary" });
    }
    const entries = [
        ...resume.experience.map((entry) => ({ source: "experience" as const, entry })),
        ...(resume.projects ?? []).map((entry) => ({ source: "project" as const, entry })),
    ];
    for (const { source, entry } of entries) {
        const where = [entry.role, entry.company].filter(Boolean).join(" · ");
        for (const line of descriptionToBullets(entry.description ?? "")) push({ text: line, where, source });
    }
    return out;
}

/**
 * Pure: up to `max` résumé lines that bear on the question, best first, scrubbed
 * of the person's name and contact details. `job` is the posting's title: a
 * second reason for a line to count (the role asks about what it says).
 */
export function screeningEvidence(resume: ResumeData, question: string, job: { title: string }, max = EVIDENCE_MAX): EvidenceLine[] {
    const asked = keysOf(question);
    const role = keysOf(job.title);
    const broad = isBroadQuestion(question);
    const name = resume.profile?.name ?? "";
    const scored: (Candidate & { score: number })[] = [];
    for (const c of candidates(resume)) {
        const own = keysOf(c.text);
        let asks = 0;
        let roles = 0;
        for (const key of own) {
            if (asked.has(key)) asks++;
            if (role.has(key)) roles++;
        }
        const score = asks * 2 + roles + (broad && c.source === "summary" ? 1 : 0);
        // A line counts for what was asked; for a broad question, for the role or the summary.
        if (asks === 0 && !(broad && (roles > 0 || c.source === "summary"))) continue;
        if (score < 1) continue;
        const text = scrubbedLine(c.text, name);
        if (text) scored.push({ ...c, text, score });
    }
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    const lines: EvidenceLine[] = [];
    const seen = new Set<string>();
    for (const { text, where, source } of scored) {
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({ text, where, source });
        if (lines.length === max) break;
    }
    // A listed skill the question names, when no line says it (a "Do you know X?" question).
    if (lines.length < max) {
        for (const group of resume.competencies ?? []) {
            const named = group.skills.filter((skill) => [...keysOf(skill)].some((key) => asked.has(key)));
            if (named.length) lines.push({ text: `Skills: ${named.slice(0, 6).join(", ")}`, where: "Skills", source: "skills" });
            if (lines.length === max) break;
        }
    }
    return lines;
}
