/**
 * Résumé ↔ job-description match: the whole posting against the whole résumé.
 *
 * WHY THIS EXISTS (review, 2026-10-13)
 * ------------------------------------
 * The fit score used to read a job's TITLE and TAGS only (`jobVocabulary`,
 * match/score.ts): list rows carry no description, so "Strong" meant "the
 * title's two or three words appear somewhere in the résumé". Every
 * "Product Manager" posting scored the same for every product manager,
 * whatever it asked for, and a résumé's actual skills and duties decided
 * nothing. Tags are on ~30-40% of rows and `must_have_skills` on under 10%
 * outside tech (measured on the live corpus), so the description is the only
 * job-side signal that is there for every role.
 *
 * HOW IT WORKS — the useful part of how web search ranks, at the size of one
 * list:
 *  1. Document understanding. The description is split into Requirements,
 *     Responsibilities and the rest (`splitPackSections`, the same split the
 *     pack card shows). What a posting REQUIRES counts most, what the person
 *     would DO next; the company blurb, benefits and legal text not at all.
 *  2. Terms, not words. Each section yields its most frequent content
 *     phrases: two-word phrases ("customer success", "account management",
 *     "patient care") weigh double a single word, because a phrase is far
 *     more specific than either of its words.
 *  3. Generic words weigh nothing. Job-ad boilerplate ("experience",
 *     "team", "strong", "ability", "fast-paced") is the job-ad equivalent of
 *     a stop word: every posting says it, so it cannot tell two apart
 *     (the role IDF plays in BM25).
 *  4. Coverage from the employer's side: how much of what THIS posting asks
 *     for shows up anywhere in the résumé (summary, every role's bullets,
 *     skills, titles, education). A posting is a good fit when you have what
 *     it asks for, not when it happens to mention what you have.
 *
 * Pure and isomorphic: the server derives `JdTerms` from a description it
 * reads (the résumé never goes to the server for this), the browser scores
 * them against the résumé it holds, and a page that has the whole description
 * derives the same terms itself — one function, so a role scores the same on
 * every surface.
 */
import { splitPackSections } from "@/lib/jobs/for-you/pack-sections";
import type { DescBlock } from "@/lib/jobs/format-description";
import { evidencedSkills } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/** A posting's content phrases by section, most telling first. Compact enough to ride on a list row. */
export interface JdTerms {
    /** What the posting requires (Requirements / Qualifications / "What you bring"). */
    req: string[];
    /** What the person would do (Responsibilities / "What you'll do"), or the whole text when it has no headings. */
    duty: string[];
}

/** How many phrases each section keeps. Enough for a real posting's asks, small enough for a list row. */
export const JD_TERMS_PER_SECTION = 40;

const STOP = new Set([
    // English function words.
    "a", "an", "and", "or", "but", "nor", "so", "yet", "for", "of", "on", "in", "into", "onto", "at", "by", "to", "from",
    "with", "without", "within", "about", "as", "than", "then", "that", "this", "these", "those", "there", "here", "the",
    "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "doing", "have", "has", "had",
    "having", "will", "would", "shall", "should", "can", "could", "may", "might", "must", "need", "needs", "not", "no",
    "i", "me", "my", "we", "us", "our", "ours", "you", "your", "yours", "they", "them", "their", "it", "its", "he", "she",
    "his", "her", "who", "whom", "whose", "which", "what", "when", "where", "why", "how", "all", "any", "each", "every",
    "both", "either", "neither", "some", "such", "other", "others", "another", "more", "most", "less", "least", "many",
    "much", "few", "very", "also", "just", "only", "own", "same", "too", "via", "per", "etc", "eg", "ie", "e.g", "i.e",
    "if", "while", "whether", "because", "through", "across", "over", "under", "up", "down", "out", "off", "again",
    "further", "once", "well", "including", "include", "includes", "like", "plus", "new", "one", "two", "three",
    // Job-ad boilerplate: on nearly every posting, so it can't tell two apart.
    "experience", "experienced", "years", "year", "yrs", "ability", "able", "strong", "excellent", "good", "great",
    "skills", "skill", "skilled", "work", "working", "works", "team", "teams", "role", "roles", "position", "job",
    "candidate", "candidates", "opportunity", "opportunities", "company", "organization", "organisation", "environment",
    "fast", "paced", "fast-paced", "dynamic", "passionate", "passion", "motivated", "self", "self-starter", "highly",
    "demonstrated", "proven", "track", "record", "knowledge", "understanding", "familiarity", "familiar", "proficiency",
    "proficient", "required", "requirements", "requirement", "preferred", "qualifications", "qualification",
    "responsibilities", "responsibility", "responsible", "duties", "duty", "minimum", "equivalent", "related",
    "relevant", "related field", "degree", "bachelor", "bachelors", "bachelor's", "master", "masters", "plus", "asset",
    "nice", "ideal", "ideally", "looking", "join", "joining", "help", "helping", "ensure", "ensuring", "support",
    "supporting", "provide", "providing", "various", "multiple", "key", "core", "day", "days", "time", "level",
    "high", "highest", "quality", "best", "using", "use", "used", "based", "within", "ongoing", "successful", "success",
    "effectively", "effective", "communication", "communicate", "written", "verbal", "oral", "interpersonal",
    "detail", "detail-oriented", "oriented", "attention", "independently", "independent", "collaborate",
    "collaborative", "collaboration", "cross-functional", "functional", "stakeholders", "stakeholder", "partner",
    "partners", "people", "candidate's", "employer", "employees", "employee", "benefits", "salary", "pay", "range",
    "compensation", "equal", "employment", "accommodation", "accommodations", "applicants", "applicant", "apply",
    "status", "race", "gender", "disability", "veteran", "religion", "sexual", "orientation", "national", "origin",
    "full-time", "part-time", "full", "part", "hours", "hour", "shift", "location", "remote", "hybrid", "onsite",
    "office", "travel", "must", "eligible", "eligibility", "authorization", "authorized", "canada", "united", "states",
    // Verbs, praise and culture words every posting uses about itself.
    "build", "building", "drive", "driving", "deliver", "delivering", "make", "making", "create", "creating", "grow",
    "growing", "growth", "learn", "learning", "love", "want", "get", "take", "bring", "think", "thinking", "clearly",
    "differently", "please", "hiring", "hire", "world", "world-class", "global", "leading", "mission", "impact",
    "impactful", "culture", "values", "inclusive", "inclusion", "diverse", "diversity", "career", "careers",
    "exciting", "innovative", "innovation", "unique", "today", "future", "every", "everyone", "everything", "make sure",
    "keen", "eager", "comfortable", "thrive", "thrives", "ownership", "mindset", "approach", "balance", "between",
    "around", "toward", "towards", "always", "currently", "able", "ready", "free", "free time", "fun", "amazing",
    "awesome", "incredible", "talented", "smart", "curious", "humble", "hungry", "bonus", "vacation", "pto",
    "insurance", "dental", "medical", "health benefits", "rrsp", "401k", "perks", "wellness", "flexible",
    "business", "businesses", "companies", "problems", "problem", "things", "thing", "getting", "gets", "messy", "next",
    "steps", "step", "clear", "understand", "value", "outcome", "outcomes", "paid", "life", "base", "individual",
    "access", "plan", "sense", "chance", "person", "belonging", "confidence", "see", "helps", "results", "goals",
    "needs", "solution", "industry", "excellence", "opportunity to", "part of", "way", "ways", "lot", "lots",
]);

/** Conjunction tokens: always end a phrase ("sales and marketing" is two terms, not "sales marketing"). */
const ALWAYS_SPLIT = new Set(["and", "or", "&", "/"]);

/** Lowercased content tokens of `text`, with `null` where a stop word or punctuation breaks a phrase. */
function tokenStream(text: string, exclude?: ReadonlySet<string>): (string | null)[] {
    const out: (string | null)[] = [];
    const raw = text
        .toLowerCase()
        .replace(/[’']/g, "'")
        .split(/(\s+|[,;:()\[\]{}!?"“”|•·–—]|\.(?=\s|$))/);
    for (const piece of raw) {
        const word = piece.trim().replace(/^[-'./]+|[-'./]+$/g, "").replace(/'s$/, "");
        if (!word || /^\s+$/.test(piece)) continue;
        if (
            ALWAYS_SPLIT.has(word) ||
            !/[a-z0-9]/.test(word) ||
            STOP.has(word) ||
            exclude?.has(word) ||
            word.includes("'") || // we're, you'll, it's: never a requirement
            /^\d+\+?$/.test(word) ||
            word.length < 2
        ) {
            if (out.at(-1) !== null) out.push(null);
            continue;
        }
        out.push(word);
    }
    return out;
}

/** Unigrams and adjacent-word bigrams (never across a break) with their counts, in first-seen order. */
function termCounts(text: string, exclude?: ReadonlySet<string>): Map<string, number> {
    const counts = new Map<string, number>();
    const add = (t: string) => counts.set(t, (counts.get(t) ?? 0) + 1);
    const stream = tokenStream(text, exclude);
    for (let i = 0; i < stream.length; i++) {
        const w = stream[i];
        if (!w) continue;
        add(w);
        const next = stream[i + 1];
        if (next) add(`${w} ${next}`);
    }
    return counts;
}

/** A section's text, leaving out equal-opportunity / privacy / agency fine print (`DescBlock.fine`). */
function blocksText(blocks: DescBlock[]): string {
    return blocks
        .filter((b) => !b.fine)
        .map((b) => [b.lead, b.text, ...(b.items ?? [])].filter(Boolean).join("\n"))
        .join("\n");
}

const isPhrase = (term: string) => term.includes(" ");

/** How much more a two-word phrase says than a single word, when ranking a section's terms. */
const PHRASE_RANK_WEIGHT = 1.5;

/** The section's most telling terms: phrases weigh more, then count, then first appearance. */
function topTerms(text: string, max: number, exclude?: ReadonlySet<string>): string[] {
    const counts = termCounts(text, exclude);
    return [...counts.entries()]
        .map(([term, n], order) => ({ term, weight: n * (isPhrase(term) ? PHRASE_RANK_WEIGHT : 1), order }))
        .sort((a, b) => b.weight - a.weight || a.order - b.order)
        .slice(0, max)
        .map((t) => t.term);
}

/** What a description's terms are read alongside: the employer and place (left out), and the extractor's evidenced skills (put first). */
export type JdSourceJob = { company?: string | null; location?: string | null } & Partial<
    Pick<PublicJob, "must_have_skills" | "preferred_skills" | "skills_section_found">
>;

/** The words of the employer's name and the role's place: a posting repeats both, neither is an ask. */
function ownWords(job: { company?: string | null; location?: string | null } | undefined): Set<string> {
    const words = new Set<string>();
    for (const text of [job?.company, job?.location]) {
        for (const w of (text ?? "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2) words.add(w);
    }
    return words;
}

/**
 * A description's requirement and duty terms. A posting with no headings we
 * recognise gives all its terms as duties: still the posting's own words, just
 * not known to be hard requirements. `job` (its company and place) keeps the
 * employer's own name and city out of the terms.
 */
export function jdTermsFromDescription(
    description: string | null | undefined,
    job?: JdSourceJob,
): JdTerms | null {
    const text = (description ?? "").trim();
    // Skills the upstream extractor read from a real Requirements heading
    // (`evidencedSkills` — never the unstamped, fabricated ones) lead the asks.
    const skills = job ? evidencedSkills(job, "must_have_skills").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    const withSkills = (req: string[]) => [...new Set([...skills, ...req])].slice(0, JD_TERMS_PER_SECTION + skills.length);
    if (text.length < 40) return skills.length > 0 ? { req: skills, duty: [] } : null;
    const exclude = ownWords(job);
    const sections = splitPackSections(text);
    const reqText = blocksText(sections.requirements);
    const dutyText = blocksText(sections.responsibilities);
    if (!reqText.trim() && !dutyText.trim()) {
        const kept = blocksText([...sections.about, ...sections.responsibilities, ...sections.requirements]);
        const all = topTerms(kept || text, JD_TERMS_PER_SECTION, exclude);
        return all.length > 0 || skills.length > 0 ? { req: skills, duty: all } : null;
    }
    return {
        req: withSkills(topTerms(reqText, JD_TERMS_PER_SECTION, exclude)),
        duty: topTerms(dutyText, JD_TERMS_PER_SECTION, exclude),
    };
}

/** Everything the résumé says, as one searchable set of terms (words and two-word phrases). */
export type ResumeTermSet = ReadonlySet<string>;

const RESUME_TERMS = new WeakMap<ResumeData, ResumeTermSet>();

export function resumeTermSet(resume: ResumeData): ResumeTermSet {
    const cached = RESUME_TERMS.get(resume);
    if (cached) return cached;
    const parts: string[] = [
        resume.profile?.profession ?? "",
        resume.generatedSummary ?? "",
        ...(resume.experience ?? []).flatMap((e) => [e.role ?? "", e.description ?? ""]),
        ...(resume.projects ?? []).flatMap((p) => [p.role ?? "", p.description ?? ""]),
        ...(resume.competencies ?? []).flatMap((g) => [g.category ?? "", ...(g.skills ?? [])]),
        ...(resume.education ?? []).flatMap((e) => [e.degree ?? "", ...(e.coursework ?? [])]),
        // Certifications, Languages, Awards… as written ("PMP", "ACLS", "Salesforce Administrator").
        ...(resume.additionalSections ?? []).flatMap((section) => section.lines ?? []),
    ];
    // One break between parts so no phrase spans two bullets.
    const set = new Set(termCounts(parts.filter(Boolean).join(" . ")).keys());
    // A résumé's own words count whether or not a posting would treat them as filler.
    for (const part of parts) for (const w of part.toLowerCase().split(/[^a-z0-9+#.]+/)) if (w.length >= 2) set.add(w);
    RESUME_TERMS.set(resume, set);
    return set;
}

/** A term the résumé has, tolerating a plural on its last word either way. */
function resumeHas(terms: ResumeTermSet, term: string): boolean {
    if (terms.has(term)) return true;
    if (term.endsWith("es") && terms.has(term.slice(0, -2))) return true;
    if (term.endsWith("s") && terms.has(term.slice(0, -1))) return true;
    return terms.has(`${term}s`) || terms.has(`${term}es`);
}

export interface JdCoverage {
    /** 0..1: weighted share of what the posting asks for that the résumé shows. */
    coverage: number;
    /** The posting's terms the résumé shows / doesn't, requirements first — for "why this role". */
    matched: string[];
    missing: string[];
}

/** A matched two-word phrase ("account management") says twice what a single word does. */
const PHRASE_MATCH_WEIGHT = 2;

/** Requirements count 60%, duties 40% (whichever the posting has, when it has one). */
const REQ_SHARE = 0.6;

/**
 * Phantom unmatched weight added to every section (a Bayesian prior toward
 * "not shown"): a posting whose Requirements list holds six terms can't read
 * as a near-total match from four generic hits. Longer sections barely move.
 */
const COVERAGE_PRIOR_WEIGHT = 6;

function sectionCoverage(terms: readonly string[], resume: ResumeTermSet) {
    let have = 0;
    let total = 0;
    const matched: string[] = [];
    const missing: string[] = [];
    for (const term of terms) {
        const w = isPhrase(term) ? PHRASE_MATCH_WEIGHT : 1;
        total += w;
        if (resumeHas(resume, term)) {
            have += w;
            matched.push(term);
        } else missing.push(term);
    }
    return { share: total > 0 ? have / (total + COVERAGE_PRIOR_WEIGHT) : null, matched, missing };
}

/**
 * How much of what a posting asks for the résumé shows (its evidenced
 * must-have skills already lead `jd.req` — `jdTermsFromDescription`). Null
 * when the posting gave nothing to compare.
 */
export function jdCoverage(resume: ResumeData, jd: JdTerms): JdCoverage | null {
    const terms = resumeTermSet(resume);
    const req = sectionCoverage(jd.req, terms);
    const duty = sectionCoverage(jd.duty, terms);
    if (req.share == null && duty.share == null) return null;
    const coverage =
        req.share == null ? duty.share! : duty.share == null ? req.share : REQ_SHARE * req.share + (1 - REQ_SHARE) * duty.share;
    return {
        coverage,
        matched: [...req.matched, ...duty.matched.filter((t) => !req.matched.includes(t))],
        missing: [...req.missing, ...duty.missing.filter((t) => !req.missing.includes(t))],
    };
}

/**
 * Coverage that reads as a full match, for a résumé of `JD_FULL_RESUME_TERMS`
 * terms or more. Measured on live postings against the golden résumés
 * (2026-10-13, /tmp/eval/calibrate.ts in the review): a full résumé covers a
 * median ~0.18 (p75 ~0.25) of the weighted terms of postings for its own kind
 * of role and ~0.07 of the rest — a posting always names its own product,
 * customers and tools, which no résumé does, so full coverage is never near 1.
 */
export const JD_FULL_COVERAGE = 0.28;

/** Résumé size (distinct terms) at which `JD_FULL_COVERAGE` applies unscaled. */
export const JD_FULL_RESUME_TERMS = 500;

/**
 * A short résumé can't cover what a long one can: the golden résumés of
 * 55–80 terms (a nurse's, a physiotherapist's) cover ~0.04–0.08 of their own
 * role's postings, the 500–760-term ones ~0.18. The bar scales with size on
 * a gentle curve, so a concise résumé can still read as a full match on its
 * own kind of role while unrelated postings (~0.00–0.03 for those résumés)
 * stay low.
 */
export function jdFullCoverageFor(resumeTerms: number): number {
    const size = Math.max(1, resumeTerms);
    return JD_FULL_COVERAGE * Math.pow(Math.min(1, size / JD_FULL_RESUME_TERMS), 0.6);
}

/** Coverage on the 0..1 scale the fit components use, for a résumé of `resumeTerms` terms. */
export function jdFitScore(coverage: number, resumeTerms: number = JD_FULL_RESUME_TERMS): number {
    return Math.max(0, Math.min(1, coverage / jdFullCoverageFor(resumeTerms)));
}

/** Per job object: its terms, from the row (`jd_terms`) or its own description. */
const JD_CACHE = new WeakMap<object, JdTerms | null>();

export function jdTermsOf(job: JdSourceJob & { jd_terms?: JdTerms | null; description?: string | null }): JdTerms | null {
    if (job.jd_terms) return job.jd_terms;
    if (typeof job.description !== "string") return null;
    if (JD_CACHE.has(job)) return JD_CACHE.get(job)!;
    const terms = jdTermsFromDescription(job.description, job);
    JD_CACHE.set(job, terms);
    return terms;
}
