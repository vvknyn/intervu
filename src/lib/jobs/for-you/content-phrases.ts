/**
 * What the résumé shows, as a few short phrases the search can look for in a posting's whole text
 * (title, description, skills) whatever its title says: the retrieval half of "match the experience
 * and skills content first, the title last" (Vivek, 2026-10-14). The title lanes (`buildMatchQuery`)
 * find the roles whose title the résumé names; the content lanes find the ones whose content it
 * covers, so a "Platform Owner" or a "Solutions Lead" asking for the person's roadmap, API and
 * delivery work is in the pool too. Pure and isomorphic: the browser (guest résumés never leave it)
 * and the server (account résumés) derive the same phrases.
 *
 * Only a few skill words leave the résumé (two-word duty phrases, and single words from its skills list),
 * never lines, names or contact details, and a search carrying them is a résumé-built one (`fromResume`):
 * not logged (`shouldLogSearch`).
 */
import { isGenericJdWord } from "@/lib/match/jd-match";
import type { ResumeData } from "@/types/resume";

/** The most two-word duty phrases one search carries: one lane each, so each costs a query. */
export const CONTENT_PHRASES_MAX = 4;
/**
 * The most single skill, tool or domain words one search carries, each a lane of its own. A word is only
 * worth a lane if few postings mention it, which the browser cannot know: the server drops a word whose
 * lane does not read them all (`CONTENT_LANE_LIMIT`, meilisearch.ts).
 */
export const CONTENT_WORDS_MAX = 3;
/** All the lanes one search can carry. */
export const CONTENT_LANES_MAX = CONTENT_PHRASES_MAX + CONTENT_WORDS_MAX;

/** Words that read as content but name a kind of work done everywhere: a phrase of only these finds nothing in particular. */
const BROAD = new Set([
    "management", "manager", "analysis", "analytics", "development", "planning", "strategy", "strategic", "execution", "operations",
    "operational", "delivery", "process", "processes", "reporting", "research", "design", "service", "services", "systems", "system",
    "technical", "technology", "platform", "product", "products", "program", "project", "projects", "client", "clients", "customer",
    "customers", "data", "software", "solutions", "solution", "engineering", "leadership", "lead", "senior", "junior", "global",
    "infrastructure", "optimization", "architecture", "implementation", "configuration", "performance", "deprecation", "governance",
    "stakeholder", "stakeholders", "communication", "communications", "integration", "integrations", "transformation", "transformations",
    "microsoft", "excel", "word", "powerpoint", "outlook", "office", "spreadsheet", "spreadsheets",
]);

/** A pair ending in one of these names a job ("product owner", "account manager"), not what the person does: the title lanes carry it. */
const ROLE_NOUN = new Set([
    "owner", "manager", "managers", "engineer", "engineers", "developer", "developers", "lead", "leader", "analyst", "specialist", "director",
    "consultant", "executive", "associate", "coordinator", "officer", "architect", "administrator", "representative", "designer", "scientist",
    "nurse", "technician", "advisor", "adviser", "supervisor", "intern", "head", "partner",
]);

const WORD = /[^a-z0-9+#.]+/;
const words = (text: string): string[] => text.toLowerCase().split(WORD).map((w) => w.replace(/^[.]+|[.]+$/g, "")).filter(Boolean);
const stem = (word: string) => word.replace(/(?:es|s)$/, "");

const clean = (w: string) => w.length >= 3 && !/^\d/.test(w) && !isGenericJdWord(w);

/** A domain or URL written in a role field ("velai.app"): a side project, not an employer role title. */
const DOMAIN_ROLE = /^[a-z0-9-]+\.[a-z]{2,6}$/i;

/**
 * Two-word phrases in order of how much the résumé leans on them: every run of two adjacent content words
 * (no function or job-ad word between them) in its summary, roles, projects and skills, counted across the
 * whole résumé, with a skill the person listed counting double and a pair corroborated by their work prose
 * gaining an extra point. A pair repeated across roles ("release coordination", "api migration") is what they
 * actually do; one that appears once in a trailing side project is a passing mention.
 */
function rankedPairs(resume: ResumeData, skip: ReadonlySet<string>): { pair: string; weight: number }[] {
    const counts = new Map<string, { n: number; first: number }>();
    let order = 0;
    const add = (pair: string, n: number) => {
        const entry = counts.get(pair);
        if (entry) entry.n += n;
        else counts.set(pair, { n, first: order++ });
    };
    const scan = (text: string, weight: number) => {
        const tokens = text.toLowerCase().split(/[^a-z0-9+#.\-]+/).map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ""));
        for (let i = 0; i + 1 < tokens.length; i++) {
            const a = tokens[i]!;
            const b = tokens[i + 1]!;
            if (!clean(a) || !clean(b) || skip.has(stem(a)) || skip.has(stem(b)) || a === b) continue;
            if (BROAD.has(a) && BROAD.has(b)) continue;
            if (ROLE_NOUN.has(b) || ROLE_NOUN.has(a)) continue;
            add(`${a} ${b}`, weight);
        }
    };
    for (const group of resume.competencies ?? []) {
        for (const skill of group?.skills ?? []) {
            const normalized = (skill ?? "")
                .replace(/[(),]/g, " . ")
                .replace(/^(\s*[a-z0-9+#.\-]+\s*)[&/](\s*[a-z0-9+#.\-]+\s*)$/i, "$1 $2")
                .replace(/[&/]/g, " . ");
            scan(normalized, 2);
        }
    }
    const workEntries = (resume.experience ?? []).filter((e) => !DOMAIN_ROLE.test((e?.role ?? "").trim()));
    const roleDescriptions =
        workEntries.length > 0
            ? workEntries.map((e) => e.description ?? "")
            : [...(resume.experience ?? []).map((e) => e.description ?? ""), ...(resume.projects ?? []).map((e) => e.description ?? "")];
    const prose: string[] = [resume.generatedSummary ?? "", ...roleDescriptions];
    const proseStems = new Set(prose.flatMap(words).map(stem));
    for (const text of prose) for (const sentence of text.split(/[\n.;:!?()]+/)) scan(sentence.replace(/[&/,]/g, " . "), 1);
    return [...counts.entries()]
        .map(([pair, { n, first }]) => {
            const [a, b] = pair.split(" ") as [string, string];
            const corroborated = proseStems.has(stem(a)) && proseStems.has(stem(b)) ? 1 : 0;
            return { pair, weight: n + corroborated, first };
        })
        .sort((x, y) => y.weight - x.weight || x.first - y.first);
}

/**
 * Up to `CONTENT_PHRASES_MAX` two-word phrases the résumé leans on most (`rankedPairs`), skipping any whose
 * words the title phrases (`avoid`) already carry, and any made only of broad words ("project management").
 * Two phrases sharing a word count once, so the four cover different work.
 */
export function contentPairsFor(resume: ResumeData, avoid: readonly string[] = []): string[] {
    const skip = new Set(avoid.flatMap(words).map(stem));
    const out: string[] = [];
    const used = new Set<string>();
    for (const { pair } of rankedPairs(resume, skip)) {
        const [a, b] = pair.split(" ") as [string, string];
        if (used.has(stem(a)) || used.has(stem(b))) continue;
        out.push(pair);
        used.add(stem(a));
        used.add(stem(b));
        if (out.length >= CONTENT_PHRASES_MAX) break;
    }
    return out;
}

/**
 * Up to `CONTENT_WORDS_MAX` single words from the skills the résumé LISTS (never its prose, where names and
 * places sit): tools, methods and domains such as "meilisearch" or "observability", the words a pair of
 * adjacent words cannot carry. A longer word is a rarer one, so the longest come first; a word already in a
 * chosen phrase (`used`), a title word, a broad or generic word, a job noun and a word of the person's own
 * name never leave. The server keeps a word's lane only if it proves rare (`CONTENT_LANE_LIMIT`).
 */
export function contentWordsFor(resume: ResumeData, avoid: readonly string[] = [], used: readonly string[] = []): string[] {
    const skip = new Set([...avoid, ...used].flatMap(words).map(stem));
    const name = new Set(words(resume.profile?.name ?? "").map(stem));
    const found = new Map<string, number>();
    let order = 0;
    for (const group of resume.competencies ?? []) {
        for (const skill of group?.skills ?? []) {
            for (const raw of (skill ?? "").toLowerCase().split(/[^a-z0-9+#.]+/)) {
                const word = raw.replace(/^[.]+|[.]+$/g, "");
                if (word.length < 3 || word.length > 24 || !/[a-z]/.test(word) || !clean(word) || BROAD.has(word) || ROLE_NOUN.has(word)) continue;
                if (skip.has(stem(word)) || name.has(stem(word)) || found.has(word)) continue;
                found.set(word, order++);
            }
        }
    }
    return [...found.entries()]
        .sort((x, y) => y[0].length - x[0].length || x[1] - y[1])
        .slice(0, CONTENT_WORDS_MAX)
        .map(([word]) => word);
}

/** The lanes a résumé-built search adds to its title lanes: the duty phrases first, then the rarer single skill words. Empty when the résumé gives none: the title lanes then do all the retrieving. */
export function contentPhrasesFor(resume: ResumeData, avoid: readonly string[] = []): string[] {
    const pairs = contentPairsFor(resume, avoid);
    return [...pairs, ...contentWordsFor(resume, avoid, pairs)];
}

/** What the server takes from a request's `contentPhrases`: a few short plain phrases (up to `CONTENT_PHRASES_MAX` of two to three words, up to `CONTENT_WORDS_MAX` single words), nothing else (the field arrives from the browser). */
export function sanitizeContentPhrases(phrases: readonly string[] | undefined): string[] {
    if (!phrases) return [];
    const out: string[] = [];
    let pairs = 0;
    let singles = 0;
    for (const raw of phrases) {
        const phrase = String(raw ?? "").toLowerCase().replace(/[^a-z0-9+#. ]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ").slice(0, 40);
        const single = !phrase.includes(" ");
        if (single ? phrase.length < 3 : phrase.length < 5) continue;
        if (out.includes(phrase)) continue;
        if (single ? singles >= CONTENT_WORDS_MAX : pairs >= CONTENT_PHRASES_MAX) continue;
        out.push(phrase);
        if (single) singles++;
        else pairs++;
    }
    return out;
}
