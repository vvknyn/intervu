/**
 * Putting what a role asks for first, without changing a word: within each
 * role on the résumé, the lines that use the job's words move up; within each
 * skills group, the skills the job names move to the front. Ties keep the
 * résumé's own order, so nothing moves without a reason that can be named.
 *
 * Shared by the site's tailoring (tailor-resume.ts `withRoleOrder`, which
 * shows each move as a change the person can undo) and the Velai Chrome
 * extension (extension/src/tailor-order.ts re-exports `orderForRole`).
 */
import { spellingKey } from "@/lib/local-ai/tailor-wording";
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import type { ResumeData, ResumeExperience } from "@/types/resume";

export interface RoleOrder {
    /** The résumé with lines and skills reordered (a copy; the input is left as it was). */
    resume: ResumeData;
    /** "Registered Nurse · St. Michael's Hospital" for each role whose lines moved. */
    movedRoles: string[];
    /** The skills now at the front because the job names them, in résumé order. */
    leadingSkills: string[];
}

/** One role whose lines move: `order[i]` is the index of the line that now comes i-th. */
export interface LineOrder {
    source: "experience" | "project";
    entryId: string;
    company: string;
    role: string;
    order: number[];
}

/** One skills group whose skills move: the group's index in `competencies`, before and after. */
export interface SkillOrder {
    group: number;
    category: string;
    before: string[];
    after: string[];
    /** The skills the job names, now first (in résumé order). */
    leading: string[];
}

function wordsOf(text: string): string[] {
    return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]{3,}/gu)?.filter((w) => w.length >= 3) ?? [];
}

/** How many of the job's words a line uses (each word counted once), however
 *  each spells it ("counselling" is the posting's "counseling"). */
export function roleTermHits(text: string, terms: ReadonlySet<string>): number {
    let n = 0;
    for (const word of new Set(wordsOf(text).map(spellingKey))) if (terms.has(word)) n++;
    return n;
}

export function roleTermSet(roleTerms: readonly string[]): Set<string> {
    return new Set(roleTerms.filter((t) => t.length >= 3).map(spellingKey));
}

/** Stable: higher score first, the original order on ties; returns the original indexes. */
function orderByScore<T>(items: T[], score: (item: T) => number): number[] {
    return items
        .map((item, i) => ({ i, s: score(item) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map(({ i }) => i);
}

const isIdentity = (order: number[]) => order.every((v, i) => v === i);

function entryLineOrders(entries: ResumeExperience[], source: LineOrder["source"], terms: ReadonlySet<string>): LineOrder[] {
    const out: LineOrder[] = [];
    for (const entry of entries) {
        const bullets = descriptionToBullets(entry.description ?? "");
        if (bullets.length < 2) continue;
        const order = orderByScore(bullets, (line) => roleTermHits(line, terms));
        if (isIdentity(order)) continue;
        out.push({ source, entryId: entry.id, company: entry.company, role: entry.role, order });
    }
    return out;
}

/** The roles whose lines move for this job, and how. */
export function lineOrders(resume: ResumeData, roleTerms: readonly string[]): LineOrder[] {
    const terms = roleTermSet(roleTerms);
    return [
        ...entryLineOrders(resume.experience ?? [], "experience", terms),
        ...entryLineOrders(resume.projects ?? [], "project", terms),
    ];
}

/** The skills groups whose skills move for this job, and how. */
export function skillOrders(resume: ResumeData, roleTerms: readonly string[]): SkillOrder[] {
    const terms = roleTermSet(roleTerms);
    const out: SkillOrder[] = [];
    (resume.competencies ?? []).forEach((group, index) => {
        const order = orderByScore(group.skills, (skill) => roleTermHits(skill, terms));
        if (isIdentity(order)) return;
        const after = order.map((i) => group.skills[i]);
        out.push({
            group: index,
            category: group.category,
            before: group.skills,
            after,
            leading: after.filter((skill) => roleTermHits(skill, terms) > 0),
        });
    });
    return out;
}

/**
 * Pure: `resume` with each role's lines and each skills group ordered by how
 * many of `roleTerms` (the job's words, `roleTermsForJob`) they use.
 */
export function orderForRole(resume: ResumeData, roleTerms: readonly string[]): RoleOrder {
    const movedRoles: string[] = [];
    const leadingSkills: string[] = [];
    const reorder = (entries: ResumeExperience[], orders: LineOrder[]) =>
        entries.map((entry) => {
            const move = orders.find((o) => o.entryId === entry.id);
            if (!move) return entry;
            const bullets = descriptionToBullets(entry.description ?? "");
            movedRoles.push([entry.role, entry.company].filter(Boolean).join(" · "));
            return { ...entry, description: move.order.map((i) => `- ${bullets[i]}`).join("\n") };
        });
    const orders = lineOrders(resume, roleTerms);
    const experience = reorder(resume.experience ?? [], orders.filter((o) => o.source === "experience"));
    const projects = resume.projects ? reorder(resume.projects, orders.filter((o) => o.source === "project")) : resume.projects;
    const competencies = [...(resume.competencies ?? [])];
    for (const move of skillOrders(resume, roleTerms)) {
        competencies[move.group] = { ...competencies[move.group], skills: move.after };
        leadingSkills.push(...move.leading);
    }
    return { resume: { ...resume, experience, projects, competencies }, movedRoles, leadingSkills };
}
