/**
 * What line of work a text is, read from what it says rather than what it is called (Vivek, 2026-10-14/16:
 * "match the experience and skills content to the job profile first, and the title last"). A posting titled
 * "Product Engineering Coordinator" that asks for supply chain, procurement and vendor work is a supply chain
 * posting, whatever its title says; a "(Remote) Customer Support Analyst" whose duties are ticketing,
 * troubleshooting and password resets is IT support.
 *
 * The reading is the family lexicon (family-lexicon.ts): each of 35 lines of work has the 40 terms that most
 * set its postings apart from all the others, and a text scores for a family by the summed weight of the
 * family's terms it uses, per 100 words. The text is only called a family when one clearly leads:
 * `CONTENT_FAMILY_MIN_MARGIN` ahead of the runner-up and at least `CONTENT_FAMILY_MIN_TERMS` of the family's
 * terms matched. Anything less says nothing and the title decides as it always did. Pure: no I/O, no model, so
 * a posting reads the same on the server, in the browser and in a test.
 *
 * Both bars were set before any number was seen and are not tuned (Loopio and Caribou clear by about 0.05).
 */
import { FAMILY_LEXICON } from "@/lib/match/family-lexicon";
import type { ResumeData } from "@/types/resume";

/** The leading family must be this far ahead of the runner-up: (top - runner-up) / top. */
export const CONTENT_FAMILY_MIN_MARGIN = 0.2;
/** And at least this many of its distinct terms must be in the text. */
export const CONTENT_FAMILY_MIN_TERMS = 6;
/** The résumé's families are its leader and any family within this share of the leader's score. */
export const CONTENT_FAMILY_RESUME_BAND = 0.2;
/** Terms an explanation names. */
export const CONTENT_FAMILY_SHOWN_TERMS = 4;

/** What a posting's text reads as, when it reads as one line of work clearly. Rides on `JdTerms.family`. */
export interface ContentFamily {
    /** The family id (a key of the lexicon). */
    id: string;
    /** How far ahead of the runner-up it is, 0..1 (rounded to two places). */
    margin: number;
    /** The strongest of the family's terms the text uses, for the explanation (`CONTENT_FAMILY_SHOWN_TERMS` at most). */
    terms: string[];
}

/** The line of work a family id names, as a sentence says it ("security operations work"). */
export const CONTENT_FAMILY_LABEL: Readonly<Record<string, string>> = {
    product: "product management",
    engineering: "software engineering",
    data: "data and analytics",
    design: "design",
    marketing: "marketing",
    sales: "sales",
    customer_success: "customer success",
    clinical: "clinical care",
    physio: "physiotherapy",
    lab: "laboratory",
    pharmacy: "pharmacy",
    clinical_research: "clinical research",
    public_health: "public health",
    teaching: "teaching",
    operations: "operations",
    security_ops: "security operations",
    it_support: "IT support",
    devops_sre: "DevOps and infrastructure",
    qa: "quality assurance and testing",
    sales_ops_crm: "sales operations and CRM administration",
    finance_accounting: "finance and accounting",
    hr_recruiting: "HR and recruiting",
    legal_compliance: "legal and compliance",
    project_program_mgmt: "project and program management",
    supply_chain_logistics: "supply chain and logistics",
    warehouse_transport: "warehouse and transport",
    admin_office: "office administration",
    hospitality_retail: "hospitality and retail",
    construction_trades: "construction and the trades",
    manufacturing: "manufacturing",
    healthcare_support: "healthcare support",
    social_services: "social services and community support",
    ml_data_science: "machine learning and data science",
    physical_engineering: "mechanical and electrical engineering",
    customer_support: "customer support",
};

export const contentFamilyLabel = (id: string): string => CONTENT_FAMILY_LABEL[id] ?? id.replace(/_/g, " ");

// ---- the tokenizer: the one the lexicon was learned with, so a term is matched the way it was counted ----

/** English function words. */
const STOP: ReadonlySet<string> = new Set(
    (
        "a about above across after again against all almost also although always am among an and any are aren as at be because been before being below " +
        "between both but by can cannot could did do does doing done down during each either else etc even ever every few for from further get gets " +
        "had has have having he her here hers herself him himself his how however i if in into is isn it its itself just may me might more most much " +
        "must my myself neither no nor not now of off often on once one only onto or other others our ours ourselves out over own per perhaps rather " +
        "same shall she should since so some such than that the their theirs them themselves then there these they this those though through thus " +
        "to too toward towards under until up upon us very via was we were what whatever when where whether which while who whom whose why will with " +
        "within without would yet you your yours yourself yourselves"
    ).split(" "),
);

/** Posting headings and equal-opportunity / application-process words: never terms, whatever the family. */
const BOILERPLATE: ReadonlySet<string> = new Set(
    (
        "responsibilities responsibility requirements requirement qualifications qualification duties summary overview description about benefits perks " +
        "compensation salary range pay bonus equity vacation insurance dental vision health wellness " +
        "equal opportunity employer employers accommodation accommodations disability disabilities veteran veterans gender race religion orientation " +
        "protected applicants applicant discrimination harassment diversity inclusion inclusive belonging " +
        "apply applying application applications resume cv cover letter submit submitting " +
        "inc ltd llc corp corporation limited gmbh " +
        "etc eg ie including include includes included e.g i.e " +
        "preferred required nice have plus bonus must should ability able " +
        "http https www com org net html"
    ).split(" "),
);

/** Sentences that are legal boilerplate, taken out whole. */
const BOILERPLATE_SENTENCE =
    /equal (?:employment )?opportunity|reasonable accommodation|without regard to|protected (?:by|class|status)|affirmative action|background check|e-?verify|privacy (?:policy|notice)|we (?:are|do) not (?:discriminate|accept)|applicants? (?:will|must|who)|unsolicited|agencies?|recruitment (?:agenc|firm)/i;

function cleanText(raw: string): string {
    const stripped = String(raw ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&(?:nbsp|amp|quot|#39|lt|gt);/g, " ")
        .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g, " ")
        .replace(/[*_#>`|]+/g, " ")
        .replace(/[•●▪–—]/g, " . ");
    // sentence-ish split: full stops, question/exclamation marks and line breaks
    const kept = stripped.split(/(?<=[.!?])\s+|\n+/).filter((s) => !BOILERPLATE_SENTENCE.test(s));
    return kept.join(" . ").toLowerCase();
}

/** Light stemmer, applied to both sides: plurals only ("stakeholders" = "stakeholder"). */
function stem(w: string): string {
    if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
}

/** Sentences of tokens, so a two-word term never spans a full stop. */
function tokenize(text: string): string[][] {
    return text
        .split(/\s\.\s|[.!?;:()\[\]{}]\s|\s[.!?;:()\[\]{}]/)
        .map((s) => (s.match(/[a-z][a-z0-9+#]*/g) ?? []).filter((t) => t.length >= 2))
        .filter((s) => s.length > 0);
}

const usable = (t: string) => !STOP.has(t) && !BOILERPLATE.has(t) && !/^\d+$/.test(t);

/** The DISTINCT light-stemmed words and adjacent word pairs of a text, and its word count. */
function termsOf(text: string): { terms: Set<string>; words: number } {
    const terms = new Set<string>();
    let words = 0;
    for (const sentence of tokenize(text)) {
        words += sentence.length;
        const stems = sentence.map((t) => (usable(t) ? stem(t) : ""));
        for (let i = 0; i < stems.length; i++) {
            const a = stems[i]!;
            if (!a) continue;
            terms.add(a);
            const b = stems[i + 1];
            if (b) terms.add(`${a} ${b}`);
        }
    }
    return { terms, words };
}

// ---- the reading ----

interface Scored {
    id: string;
    score: number;
    /** [term, weight, circular] of the family's terms the text uses. */
    matched: Array<readonly [string, number, boolean]>;
}

/** Every family scored for a text, best first; empty for a text with no words. */
function rankFamilies(text: string): Scored[] {
    const { terms, words } = termsOf(cleanText(text));
    if (words === 0) return [];
    const ranked: Scored[] = [];
    for (const [id, lexicon] of Object.entries(FAMILY_LEXICON)) {
        const matched: Scored["matched"] = [];
        let sum = 0;
        for (const entry of lexicon) {
            if (!terms.has(entry[0])) continue;
            matched.push([entry[0], entry[1], entry.length === 3]);
            sum += entry[1];
        }
        ranked.push({ id, score: (sum * 100) / words, matched });
    }
    return ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const marginOf = (ranked: Scored[]): number => {
    const top = ranked[0];
    return top && top.score > 0 ? (top.score - (ranked[1]?.score ?? 0)) / top.score : 0;
};

/**
 * The terms an explanation names: the strongest the text uses, the circular ones (words of the family's own
 * titles) only when there are too few others, and a word never beside a longer matched term that holds it
 * ("chain" beside "supply chain"). Written as the text wrote them, not as stemmed for matching.
 */
function shownTerms(matched: Scored["matched"], text: string): string[] {
    const byWeight = matched.slice().sort((a, b) => b[1] - a[1]);
    const ordered = [...byWeight.filter((m) => !m[2]), ...byWeight.filter((m) => m[2])];
    const picked: string[] = [];
    for (const [term] of ordered) {
        if (matched.some(([other]) => other !== term && other.length > term.length && ` ${other} `.includes(` ${term} `))) continue;
        picked.push(term);
        if (picked.length >= CONTENT_FAMILY_SHOWN_TERMS) break;
    }
    const wanted = new Set(picked);
    const surface = new Map<string, string>();
    for (const sentence of tokenize(cleanText(text))) {
        for (let i = 0; i < sentence.length; i++) {
            const a = usable(sentence[i]!) ? stem(sentence[i]!) : "";
            if (!a) continue;
            if (wanted.has(a) && !surface.has(a)) surface.set(a, sentence[i]!);
            const b = sentence[i + 1];
            if (b && usable(b)) {
                const pair = `${a} ${stem(b)}`;
                if (wanted.has(pair) && !surface.has(pair)) surface.set(pair, `${sentence[i]} ${b}`);
            }
        }
        if (surface.size === wanted.size) break;
    }
    return picked.map((term) => surface.get(term) ?? term);
}

/** The posting's own title (whole, and its role phrase before the first comma, dash or bracket) taken out of its text: the title never reads the posting. */
function withoutTitle(text: string, title: string | null | undefined): string {
    const t = (title ?? "").trim();
    if (!t) return text;
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const phrases = [t, t.split(/[,(–—-]/)[0]!.trim()].filter((p) => p.length >= 4);
    return phrases.reduce((acc, p) => acc.replace(new RegExp(escape(p), "gi"), " "), text);
}

/**
 * The line of work a posting's text clearly reads as, or `null` when no family leads it clearly (a short or
 * mixed text): then the title decides, as it always did.
 */
export function postingContentFamily(description: string | null | undefined, title?: string | null): ContentFamily | null {
    const text = (description ?? "").trim();
    if (text.length < 200) return null;
    const read = withoutTitle(text, title);
    const ranked = rankFamilies(read);
    const top = ranked[0];
    if (!top || top.matched.length < CONTENT_FAMILY_MIN_TERMS) return null;
    const margin = marginOf(ranked);
    if (margin < CONTENT_FAMILY_MIN_MARGIN) return null;
    return { id: top.id, margin: Math.round(margin * 100) / 100, terms: shownTerms(top.matched, read) };
}

const RESUME_FAMILIES = new WeakMap<ResumeData, ReadonlySet<string> | null>();

/**
 * The lines of work the résumé's own experience shows: what the person did, not what they were called, read
 * from the experience bullets alone (no titles, summary or skills list). The leader plus any family within
 * `CONTENT_FAMILY_RESUME_BAND` of its score, so a résumé that sits between two lines of work (a technical
 * account manager: product 7.9, customer success 7.1) holds both, and a posting for either is not another
 * line of work. `null` when the experience text is too thin to read (the leader matches fewer than
 * `CONTENT_FAMILY_MIN_TERMS` of its terms): with nothing to compare a posting to, no posting is called another line of work.
 */
export function resumeContentFamilies(resume: ResumeData): ReadonlySet<string> | null {
    if (RESUME_FAMILIES.has(resume)) return RESUME_FAMILIES.get(resume)!;
    const text = (resume?.experience ?? []).map((e) => e?.description ?? "").join("\n");
    const ranked = rankFamilies(text);
    const top = ranked[0];
    const set =
        top && top.score > 0 && top.matched.length >= CONTENT_FAMILY_MIN_TERMS
            ? new Set(ranked.filter((r) => r.score > 0 && r.score >= (1 - CONTENT_FAMILY_RESUME_BAND) * top.score).map((r) => r.id))
            : null;
    RESUME_FAMILIES.set(resume, set);
    return set;
}
