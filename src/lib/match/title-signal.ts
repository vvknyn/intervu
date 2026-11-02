/**
 * Title evidence for fit: which half of a bilingual title to score, which words are
 * stopwords or generic modifiers, and when two titles actually share a role.
 *
 * A Canadian posting often prints the same role twice ("Product Quality Owner -
 * Payments / Responsable de la qualité produit"). The other language's function
 * words and accent-cut stems were counted as terms the résumé lacked. Generic
 * modifiers ("technical", "manager") were enough, on their own, to claim a title
 * overlap and to raise a band. Neither is evidence of the role.
 *
 * Profession-agnostic: the lists are function words and rank-like modifiers, not
 * a map of one career's titles.
 */
import { FUNCTION_WORDS } from "@/lib/geo/common-words";
import { jobTitleMatchesTarget } from "@/lib/jobs/for-you/title-relevance";
import { RANK_WORDS } from "@/lib/match/duty-signals";
import { resumeLanguages } from "@/lib/match/posting-language";
import type { ResumeData } from "@/types/resume";

/**
 * Function words that must never be fit-term chips. English glue is
 * `FUNCTION_WORDS` ("of", "the", "and"). The French articles and conjunctions
 * are the other half of a bilingual title ("de", "la", "le", "des", "et").
 */
const FRENCH_FUNCTION_WORDS = [
    "de", "des", "du", "la", "le", "les", "et", "au", "aux", "une", "un",
    "à", "pour", "dans", "avec", "ou", "sur", "par", "qui", "que", "ce",
    "se", "ne", "pas", "est", "sont",
] as const;

export const TITLE_STOPWORDS: ReadonlySet<string> = new Set([...FUNCTION_WORDS, ...FRENCH_FUNCTION_WORDS]);

/**
 * Modifiers that name a rank, a grade, or a generic job shape. They never
 * identify a line of work on their own: "technical" + "manager" is not a
 * shared role. "analyst" is here because the owner listed it with the
 * modifiers — "Data Analyst" and "Business Analyst" do not overlap on
 * "analyst" alone.
 */
export const GENERIC_TITLE_MODIFIERS: ReadonlySet<string> = new Set([
    "technical", "technology", "technological",
    "senior", "sr", "junior", "jr", "lead", "leader", "leading",
    "manager", "managers", "management", "manage",
    "specialist", "specialists", "analyst", "analysts", "associate", "associates",
    "principal", "staff", "experienced", "experience",
    "coordinator", "coordinators", "assistant", "assistants",
    "officer", "officers", "representative", "representatives",
    "administrator", "administrators", "consultant", "consultants",
    "head", "director", "directors",
    "intern", "internship", "trainee", "apprentice", "graduate", "student",
    "professional", "intermediate", "entry", "level",
    "i", "ii", "iii", "iv", "v",
]);

/** French content words that mark a title span as French even with no accent. */
const FRENCH_CONTENT_WORDS: ReadonlySet<string> = new Set([
    "responsable", "responsables", "qualite", "qualité", "produit", "produits",
    "developpeur", "développeur", "developpeuse", "développeuse",
    "gestionnaire", "ingenieur", "ingénieur", "donnees", "données",
    "logiciel", "equipe", "équipe",
]);

const FRENCH_FUNCTION_SET: ReadonlySet<string> = new Set(FRENCH_FUNCTION_WORDS);

export function isGenericTitleModifier(token: string): boolean {
    return GENERIC_TITLE_MODIFIERS.has(token.toLowerCase());
}

export function isTitleStopword(token: string): boolean {
    return TITLE_STOPWORDS.has(token.toLowerCase());
}

/** Unicode letters stay intact, so "qualité" is not cut into the stem "qualit". */
function titleWords(text: string): string[] {
    return text.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean);
}

/**
 * Tokens a title or tag contributes to the fit vocabulary: unicode words,
 * stopwords and rank words removed. Truncated accent stems cannot appear
 * because a letter is never a split point.
 */
export function titleTermTokens(text: string): string[] {
    return titleWords(text).filter((token) => !TITLE_STOPWORDS.has(token) && !RANK_WORDS.has(token));
}

/** 0 = no French signal. 2 or more is a French title half, not a single article ("La Jolla"). */
export function frenchTitleScore(text: string): number {
    let score = 0;
    if (/[àâäéèêëïîôùûüçœ]/i.test(text)) score += 2;
    for (const word of titleWords(text)) {
        if (FRENCH_CONTENT_WORDS.has(word)) score += 2;
        else if (FRENCH_FUNCTION_SET.has(word)) score += 1;
    }
    return score;
}

const BILINGUAL_SEPARATORS = [" / ", " | ", " – ", " — ", " - ", "/"] as const;

/**
 * The two halves of an "EN / FR", "FR / EN", or " - " bilingual title, or null
 * when the title is one language. A separator counts only when one side is
 * French and the other is not, so "Product Quality Owner - Payments" stays whole.
 */
export function bilingualTitleHalves(title: string): { french: string; english: string } | null {
    for (const sep of BILINGUAL_SEPARATORS) {
        let from = 0;
        while (from < title.length) {
            const idx = title.indexOf(sep, from);
            if (idx < 0) break;
            const left = title.slice(0, idx).trim();
            const right = title.slice(idx + sep.length).trim();
            from = idx + Math.max(sep.length, 1);
            if (!left || !right) continue;
            const leftFrench = frenchTitleScore(left) >= 2;
            const rightFrench = frenchTitleScore(right) >= 2;
            if (leftFrench === rightFrench) continue;
            return leftFrench ? { french: left, english: right } : { french: right, english: left };
        }
    }
    return null;
}

/**
 * The half of a bilingual title written in the résumé's language. English when
 * the résumé reads English (including English-first bilingual résumés). The
 * French half only when French is a language they read and English is not,
 * or French is the language their résumé is written in first.
 */
export function titleInResumeLanguage(title: string, languages: readonly string[]): string {
    const halves = bilingualTitleHalves(title);
    if (!halves) return title;
    const readsEnglish = languages.length === 0 || languages.includes("english");
    const readsFrench = languages.includes("french");
    if (readsFrench && !readsEnglish) return halves.french;
    if (readsFrench && readsEnglish && languages[0] === "french") return halves.french;
    return halves.english;
}

export function resumeRoleTitles(resume: ResumeData): string[] {
    const titles = [
        resume.profile?.profession ?? "",
        ...(resume.experience ?? []).map((entry) => entry.role ?? ""),
        ...(resume.projects ?? []).map((project) => project.role ?? ""),
    ];
    const out: string[] = [];
    for (const title of titles) {
        const trimmed = title.trim();
        if (trimmed && !out.some((have) => have.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
    }
    return out;
}

function sameToken(a: string, b: string): boolean {
    return a === b || a === `${b}s` || a === `${b}es` || b === `${a}s` || b === `${a}es`;
}

/**
 * A token cut off an accented word ("qualit" from "qualité"). A whole word that
 * also prefixes a longer word ("product" beside "production") is not one.
 */
export function isTruncatedStem(token: string, source: string): boolean {
    const words: string[] = source.toLowerCase().match(/\p{L}[\p{L}\p{N}+#.]*/gu) ?? [];
    if (words.includes(token)) return false;
    return words.some((word) => word.startsWith(token) && word.length > token.length);
}

/** Words that name the line of work, rank and generic modifiers removed. */
export function roleHeadTokens(title: string): string[] {
    const out: string[] = [];
    for (const token of titleTermTokens(title)) {
        if (isGenericTitleModifier(token)) continue;
        if (!out.some((have) => sameToken(have, token))) out.push(token);
    }
    return out;
}

/** Rank words and stopwords removed, generic modifiers kept: "Senior Product Manager" → product, manager. */
function contentTokens(title: string): string[] {
    return titleTermTokens(title);
}

/**
 * Contiguous pairs that name work. A pair of nothing but modifiers
 * ("technical manager", "experienced analyst") is not one.
 */
export function meaningfulPhrases(title: string): string[] {
    const tokens = contentTokens(title);
    const out: string[] = [];
    for (let i = 0; i < tokens.length - 1; i++) {
        const a = tokens[i]!;
        const b = tokens[i + 1]!;
        if (isGenericTitleModifier(a) && isGenericTitleModifier(b)) continue;
        const phrase = `${a} ${b}`;
        if (!out.includes(phrase)) out.push(phrase);
    }
    return out;
}

export function sharedRoleHeads(jobTitle: string, resumeTitle: string): string[] {
    const resumeHeads = roleHeadTokens(resumeTitle);
    return roleHeadTokens(jobTitle).filter((token) => resumeHeads.some((head) => sameToken(head, token)));
}

export function sharedMeaningfulPhrases(jobTitle: string, resumeTitle: string): string[] {
    const resumePhrases = new Set(meaningfulPhrases(resumeTitle));
    return meaningfulPhrases(jobTitle).filter((phrase) => resumePhrases.has(phrase));
}

/** The same title once rank words are ignored ("Sr. Product Manager" and "Product Manager"). */
export function sameTitleModuloRank(jobTitle: string, resumeTitle: string): boolean {
    const job = contentTokens(jobTitle);
    const resume = contentTokens(resumeTitle);
    return job.length > 0 && job.length === resume.length && job.every((token, i) => sameToken(token, resume[i]!));
}

/**
 * True when the titles share a role head, a meaningful phrase, or are the same
 * title aside from rank words. Generic modifiers alone do not count.
 */
export function titlesShareSignal(jobTitle: string, resumeTitle: string): boolean {
    return sharedRoleHeads(jobTitle, resumeTitle).length > 0
        || sharedMeaningfulPhrases(jobTitle, resumeTitle).length > 0
        || sameTitleModuloRank(jobTitle, resumeTitle);
}

export function resumeSharesTitleSignal(resume: ResumeData, jobTitle: string): boolean {
    const scored = titleInResumeLanguage(jobTitle, resumeLanguages(resume) ?? ["english"]);
    return resumeRoleTitles(resume).some((role) => titlesShareSignal(scored, role));
}

/**
 * A searched or held title matches this posting for band purposes. A run of
 * whole words still has to name a role (`jobTitleMatchesTarget`): a target made
 * only of generic modifiers does not, unless the posting is that same title
 * once rank words are ignored.
 */
export function countsAsTitleMatch(jobTitle: string, targetTitle: string): boolean {
    if (!jobTitleMatchesTarget(jobTitle, targetTitle)) return false;
    if (roleHeadTokens(targetTitle).length > 0) return true;
    return sameTitleModuloRank(jobTitle, targetTitle);
}
