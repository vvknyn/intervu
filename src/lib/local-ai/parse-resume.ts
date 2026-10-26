/**
 * Client-side résumé parse. The quick read (rules, structure-resume-text.ts)
 * always runs in the browser. When it misses something ranking uses
 * (`modelReadNeeded`), the caller can also ask sealed AI (Tinfoil, see
 * src/lib/sealed-ai/client.ts) to read it: the text goes without the person's
 * name, email, phone or links, encrypted so only Tinfoil's attested server
 * can read it, and the quick read stays whatever the model says.
 */

import { normalizeParsedResume, type RawParsedResumeInput } from "@/lib/resume/normalize-parsed-resume";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import { parseDateRange } from "@/lib/resume/years-of-experience";
import type { ParsedResumeResult } from "@/types/resume";
import { scoreLocalParseConfidence } from "./parse-confidence";
import { sealedChat } from "@/lib/sealed-ai/client";
import { withoutContactDetails } from "@/lib/resume/without-contact";
import { ENGINE_LABELS, type LocalAiEngineId, type ModelParseOutput } from "./engines/types";

export interface LocalParseResult {
    data: ParsedResumeResult;
    engine: LocalAiEngineId;
    engineLabel: string;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

const PROFILE_STRING_KEYS = [
    "name",
    "profession",
    "location",
    "email",
    "phone",
    "linkedin",
] as const;

function modelOutputToRaw(parsed: Record<string, unknown>): RawParsedResumeInput {
    const profile = (parsed.profile as RawParsedResumeInput["profile"]) ?? {};
    return {
        profile,
        experience: parsed.experience as RawParsedResumeInput["experience"],
        competencies: parsed.competencies as RawParsedResumeInput["competencies"],
        education: parsed.education as RawParsedResumeInput["education"],
        generatedSummary: (parsed.generatedSummary as string) ?? "",
    };
}

function hasMeaningfulExperience(experience: unknown): boolean {
    return (
        Array.isArray(experience) &&
        experience.some(
            (entry) =>
                isNonEmptyString((entry as { company?: string }).company) ||
                isNonEmptyString((entry as { role?: string }).role),
        )
    );
}

function hasMeaningfulCompetencies(competencies: unknown): boolean {
    return (
        Array.isArray(competencies) &&
        competencies.some((entry) => {
            const skills = (entry as { skills?: unknown }).skills;
            return Array.isArray(skills) && skills.some((skill) => isNonEmptyString(skill));
        })
    );
}

function hasMeaningfulEducation(education: unknown): boolean {
    return (
        Array.isArray(education) &&
        education.some(
            (entry) =>
                isNonEmptyString((entry as { degree?: string }).degree) ||
                isNonEmptyString((entry as { institution?: string }).institution),
        )
    );
}

/** Lower-case letters and digits only: how two reads of one name compare. */
const squash = (text: unknown) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** "Verde S.L." and "Verde S.L. – Madrid": one name, one read with more after it. An empty name is no name. */
function sameName(a: unknown, b: unknown): boolean {
    const [x, y] = [squash(a), squash(b)];
    return x !== "" && y !== "" && (x.startsWith(y) || y.startsWith(x));
}

const nameWords = (text: unknown) => String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** An entry as two reads name it: its title (or degree), its employer (or school) and its dates. */
interface EntryRead {
    title: unknown;
    org: unknown;
    dates: unknown;
}

/** "Jan 2019 – Present" and "2019 - Present": the years an entry starts and ends, or "" without dates. */
function yearsOf(dates: unknown, now: Date): string {
    const range = parseDateRange(String(dates ?? ""), now);
    return range ? `${range.start.getFullYear()}-${range.end.getFullYear()}` : "";
}

/**
 * One entry, read twice: the same years at an employer (or school) whose
 * names share a word ("Sr. Software Engineer, Acme" and "Senior Software
 * Engineer, Acme Corp, Toronto, ON"). Where either read has no dates, the
 * same two names, in either order.
 */
function sameEntry(x: EntryRead, y: EntryRead, now: Date): boolean {
    const [xYears, yYears] = [yearsOf(x.dates, now), yearsOf(y.dates, now)];
    if (xYears && yYears) return xYears === yYears && nameWords(x.org).some((w) => nameWords(y.org).includes(w));
    return (sameName(x.title, y.title) && sameName(x.org, y.org)) || (sameName(x.title, y.org) && sameName(x.org, y.title));
}

/** Newest first, as a résumé lists them: by when each began; entries without dates after them, in their order. */
function newestFirst<T>(entries: T[], dates: (entry: T) => unknown, now: Date): T[] {
    const dated = entries.map((entry) => ({ entry, start: parseDateRange(String(dates(entry) ?? ""), now)?.start.getTime() }));
    dated.sort((a, b) => (a.start !== undefined && b.start !== undefined ? b.start - a.start : Number(a.start === undefined) - Number(b.start === undefined)));
    return dated.map(({ entry }) => entry);
}

/**
 * The model's entries and each of the quick read's that none of them is,
 * newest first: a reply cut short at its token cap, or a résumé longer than
 * the text it was sent, keeps every entry the quick read found.
 */
function unionEntries<T>(model: T[], quick: T[] = [], read: (entry: T) => EntryRead, now: Date): T[] {
    const missed = quick.filter((entry) => !model.some((m) => sameEntry(read(entry), read(m), now)));
    return newestFirst([...model, ...missed], (entry) => read(entry).dates, now);
}

type Competencies = NonNullable<RawParsedResumeInput["competencies"]>;

/** "C++", "C#" and "C" are three skills: a skill is its own letters, digits, + and #. */
const skillKey = (skill: unknown) => String(skill ?? "").toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, "");

/** The model's skill lists, each with the quick read's skills none of them holds from the quick read's list of that name. */
function unionSkills(model: Competencies, quick: Competencies = []): Competencies {
    const held = new Set(model.flatMap((c) => c.skills ?? []).map(skillKey));
    const lists = model.map((c) => ({ ...c, skills: [...(c.skills ?? [])] }));
    for (const c of quick) {
        const missed = (c.skills ?? []).filter((skill) => !held.has(skillKey(skill)));
        missed.forEach((skill) => held.add(skillKey(skill)));
        if (missed.length === 0) continue;
        const list = lists.find((l) => squash(l.category) === squash(c.category));
        if (list) list.skills.push(...missed);
        else lists.push({ ...c, skills: missed });
    }
    return lists;
}

/**
 * Merge model output into heuristic draft without letting empty WASM fields
 * clobber good rule-based extractions, or a shorter read drop what the quick
 * read found.
 */
export function mergeModelIntoHeuristic(
    heuristic: RawParsedResumeInput,
    modelOut: Record<string, unknown> | null,
    now: Date = new Date(),
): { raw: RawParsedResumeInput; usedHeuristic: boolean } {
    if (!modelOut || typeof modelOut !== "object") {
        return { raw: heuristic, usedHeuristic: true };
    }

    const fromModel = modelOutputToRaw(modelOut);
    let modelContributed = false;

    const mergedProfile = { ...(heuristic.profile ?? {}) };
    for (const key of PROFILE_STRING_KEYS) {
        const value = fromModel.profile?.[key];
        if (isNonEmptyString(value)) {
            mergedProfile[key] = value;
            modelContributed = true;
        }
    }
    if (
        typeof fromModel.profile?.yearsOfExperience === "number" &&
        fromModel.profile.yearsOfExperience > 0
    ) {
        mergedProfile.yearsOfExperience = fromModel.profile.yearsOfExperience;
        modelContributed = true;
    }

    const raw: RawParsedResumeInput = {
        profile: mergedProfile,
        experience: heuristic.experience,
        projects: heuristic.projects,
        competencies: heuristic.competencies,
        education: heuristic.education,
        generatedSummary: heuristic.generatedSummary,
        // The model reads content; the layout is the source's own.
        sectionOrder: heuristic.sectionOrder,
        sectionHeadings: heuristic.sectionHeadings,
        additionalSections: heuristic.additionalSections,
        sourceHeader: heuristic.sourceHeader,
    };

    if (hasMeaningfulExperience(fromModel.experience)) {
        raw.experience = unionEntries(fromModel.experience!, heuristic.experience, (e) => ({ title: e.role, org: e.company, dates: e.dates }), now);
        modelContributed = true;
    }
    if (hasMeaningfulCompetencies(fromModel.competencies)) {
        raw.competencies = unionSkills(fromModel.competencies!, heuristic.competencies);
        modelContributed = true;
    }
    if (hasMeaningfulEducation(fromModel.education)) {
        raw.education = unionEntries(fromModel.education!, heuristic.education, (e) => ({ title: e.degree, org: e.institution, dates: e.year }), now);
        modelContributed = true;
    }
    if (isNonEmptyString(fromModel.generatedSummary)) {
        raw.generatedSummary = fromModel.generatedSummary;
        modelContributed = true;
    }

    return { raw, usedHeuristic: !modelContributed };
}

/** The most résumé text sent to the model: a long résumé's first pages hold what ranking reads. */
const SEALED_READ_CHARS = 8_000;
/** Reply cap: the entries and lines of a résumé that long, copied out. */
const SEALED_READ_MAX_TOKENS = 3_000;
const SEALED_READ_TIMEOUT_MS = 40_000;

/** The résumé text without what identifies the person: their name, email, phone numbers and links (without-contact.ts). */
export { withoutContactDetails };

/** The text sent: up to the last whole line that fits, so no entry reaches the model cut mid-line. */
function sealedReadText(text: string): string {
    if (text.length <= SEALED_READ_CHARS) return text;
    const lineEnd = text.lastIndexOf("\n", SEALED_READ_CHARS);
    return text.slice(0, lineEnd > 0 ? lineEnd : SEALED_READ_CHARS);
}

export function readSealedPrompt(text: string): string {
    return `Read this résumé into JSON. The person's name and contact details were removed.
Copy every word exactly as written; leave out anything the text doesn't say.
Reply with JSON only, in this shape:
{"profile":{"profession":"","yearsOfExperience":0,"location":""},"experience":[{"company":"","role":"","dates":"","description":"• bullet\\n• bullet"}],"competencies":[{"category":"","skills":[""]}],"education":[{"degree":"","institution":"","year":""}]}

"""
${sealedReadText(text)}
"""`;
}

/**
 * A reply cut off at the token cap, closed after its last whole value:
 * `{"experience":[{…},{"role":"Engi` → `{"experience":[{…}]}`. Null when
 * nothing in it closed.
 */
function closeTruncatedJson(json: string): string | null {
    const closers: string[] = [];
    let inString = false;
    let cut = 0;
    let tail = "";
    for (let i = 0; i < json.length; i++) {
        const ch = json[i];
        if (inString) {
            if (ch === "\\") i++;
            else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") closers.push(ch === "{" ? "}" : "]");
        else if (ch === "}" || ch === "]") {
            closers.pop();
            cut = i + 1;
            tail = [...closers].reverse().join("");
        }
    }
    return cut > 0 ? json.slice(0, cut) + tail : null;
}

export function parseModelJson(text: string): ModelParseOutput {
    const start = text.indexOf("{");
    if (start === -1) return null;
    for (const json of [text.slice(start, text.lastIndexOf("}") + 1), closeTruncatedJson(text.slice(start))]) {
        try {
            const parsed = JSON.parse(json ?? "") as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
            // Not whole: the next reading, or none.
        }
    }
    return null;
}

/** Sealed AI's read of the résumé, or null when it's off or fails. Identity fields stay the quick read's. */
async function readWithSealedAi(content: string, name?: string): Promise<ModelParseOutput> {
    const reply = await sealedChat([{ role: "user", content: readSealedPrompt(withoutContactDetails(content, name)) }], {
        maxTokens: SEALED_READ_MAX_TOKENS,
        temperature: 0,
        timeoutMs: SEALED_READ_TIMEOUT_MS,
    });
    const out = reply ? parseModelJson(reply) : null;
    if (!out) return null;
    // It never saw these: anything it puts there isn't the person's.
    const profile = (out.profile && typeof out.profile === "object" ? out.profile : {}) as Record<string, unknown>;
    delete profile.name;
    delete profile.email;
    delete profile.phone;
    delete profile.linkedin;
    delete profile.website;
    return { ...out, profile };
}

export interface ParseResumeLocallyOptions {
    /**
     * Also ask sealed AI to read it, on top of the quick read: only worth it
     * when the quick read missed something (`modelReadNeeded`).
     */
    withModel?: boolean;
}

/**
 * Parse résumé text: the quick read in this browser, and — when asked and
 * sealed AI is set up — the sealed model's read merged over it.
 */
export async function parseResumeLocally(
    content: string,
    options: ParseResumeLocallyOptions = {},
): Promise<LocalParseResult> {
    if (!content || content.trim().length < 50) {
        throw new Error("Resume content too short. Please provide more text.");
    }

    const heuristicDraft = structureResumeText(content);
    let raw: RawParsedResumeInput = {
        profile: heuristicDraft.profile,
        experience: heuristicDraft.experience,
        projects: heuristicDraft.projects,
        competencies: heuristicDraft.competencies,
        education: heuristicDraft.education,
        generatedSummary: heuristicDraft.generatedSummary,
        sectionOrder: heuristicDraft.sectionOrder,
        sectionHeadings: heuristicDraft.sectionHeadings,
        additionalSections: heuristicDraft.additionalSections,
        sourceHeader: heuristicDraft.sourceHeader,
    };

    let usedHeuristic = true;
    if (options.withModel) {
        const merged = mergeModelIntoHeuristic(raw, await readWithSealedAi(content, heuristicDraft.profile?.name));
        raw = merged.raw;
        usedHeuristic = merged.usedHeuristic;
    }
    const engine: LocalAiEngineId = usedHeuristic ? "heuristic" : "sealed";

    const confidence = scoreLocalParseConfidence(raw);

    const data = normalizeParsedResume(raw, {
        localRules: usedHeuristic,
        confidence,
    });

    return { data, engine, engineLabel: ENGINE_LABELS[engine] };
}
