/**
 * The hard asks in a posting, read from its description: the things a person either has or does not,
 * which no amount of overlapping vocabulary makes up for. A "Customer Success Manager" asking for
 * fluent French, a Secret clearance, a CISSP, ten years or a team of eight to manage is not the
 * résumé's role whatever else the two share, and the fit score (jd-match.ts) used to read them as one
 * more phrase each (measured 2026-10-15: a synthetic Canada corpus of 247 TAM/CSM postings, 153 read
 * Strong for a résumé that fit 107 of them).
 *
 * Only an ask the posting states as required counts: a sentence that calls it an asset, a plus,
 * preferred or nice to have never does ("Bilingualism (English / French) is an asset"). Pure and
 * isomorphic, like `jdTermsFromDescription`, which carries the result on a list row (`JdTerms.asks`)
 * so the browser weighs it against the résumé it holds.
 */

import { SPOKEN_LANGUAGES } from "@/lib/match/posting-language";

/** What a posting asks for that a résumé either shows or does not. Absent fields mean the posting does not say. */
export interface JdAsks {
    /** Languages besides English it requires ("french", "japanese"). */
    langs?: string[];
    /** A security clearance (or Reliability Status) it requires. */
    clearance?: true;
    /** Managing people it asks for: direct reports, a team to hire and review. */
    manages?: true;
    /** Selling it asks for: a quota to carry, cold calling, outbound prospecting. */
    sells?: true;
    /** Certifications and licences it requires, as written ("CISSP", "NRP", "CPA"). */
    creds?: string[];
    /** The fewest years of experience a sentence asks of the person ("9+ years of relevant experience"): the years a posting states in its text when its structured `min_years_experience` is missing (`yearsRequired`). */
    years?: number;
    /** The skills its Requirements heading lists (`must_have_skills`, only when a real heading was found), lowercased. */
    must?: string[];
    /** Each bullet of its Requirements section as its most telling terms, one list per bullet (jd-match.ts). */
    bullets?: string[][];
}

/** A sentence that makes whatever it names optional. */
const OPTIONAL = /\b(?:asset|assets|preferred|prefer|nice[- ]to[- ]have|bonus|(?:a|an)\s+(?:plus|advantage)|considered|beneficial|desirable|ideal(?:ly)?|welcome|helpful|not required|not necessary|optional)\b/i;

const LANGUAGES = SPOKEN_LANGUAGES;
const LANG_NAME = `(${LANGUAGES.join("|")})`;
/** "fluent in French", "bilingual (English / French)", "Japanese language skills" followed or preceded by a word that makes it a requirement. */
const LANG_LEVEL = String.raw`(?:fluen(?:t|cy)|proficien(?:t|cy)|bilingual|bilingualism|native|business[- ]level|professional[- ]level|written and spoken|spoken and written|verbal and written|working knowledge)`;
const LANG_BEFORE = new RegExp(String.raw`\b${LANG_LEVEL}\b[^.\n;]{0,60}?\b${LANG_NAME}\b`, "gi");
const LANG_AFTER = new RegExp(String.raw`\b${LANG_NAME}\b[^.\n;]{0,40}?\b(?:is|are|must be)?\s*(?:required|mandatory|a must|essential|necessary|needed)\b`, "gi");
const LANG_SPEAKING = new RegExp(String.raw`\b${LANG_NAME}[- ](?:speaking|speaker|language skills|fluency)\b`, "gi");

/** Sentences of a description, with its markup and list marks gone. */
function sentences(text: string): string[] {
    return text
        .replace(/<\s*(?:br|\/p|\/li|\/h\d|\/div|\/ul|\/ol)\s*\/?>/gi, ". ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .split(/(?<=[.!?])\s+|\n+|[•·▪●]\s*/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter((s) => s.length > 3);
}

const unique = <T,>(values: T[]) => [...new Set(values)];

function languagesAsked(lines: string[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
        if (OPTIONAL.test(line)) continue;
        for (const re of [LANG_BEFORE, LANG_AFTER, LANG_SPEAKING]) {
            re.lastIndex = 0;
            for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1]!.toLowerCase());
        }
    }
    return unique(out);
}

const CLEARANCE = /\b(?:(?:security|secret|top[- ]secret|ts\/sci|enhanced reliability|reliability status|facility)\s+clearance|clearance\s+(?:is\s+)?required|(?:hold|obtain|maintain|active|valid|current)\s+(?:an?\s+)?(?:[\w-]+\s+){0,3}?(?:clearance|reliability status))\b|\b(?:secret|top secret|ts\/sci)\s+(?:level\s+)?clearance\b|\breliability status\b/i;

const MANAGES = new RegExp(
    [
        String.raw`\bdirect reports?\b`,
        String.raw`\b(?:manage|managing|lead|leading|supervis\w+|oversee|overseeing|coach\w*|hire|hiring|build and lead)\s+(?:and\s+(?:mentor|develop|coach|hire|grow)\s+)?(?:a|the|our|your)?\s*(?:team|group|staff|squad)\s+of\s+\d+(?:\s*(?:to|-|–)\s*\d+)?\s+[\w-]+`,
        String.raw`\b(?:manage|managing|lead|leading|supervis\w+|oversee|overseeing)\s+(?:a\s+)?(?:team\s+of\s+)?\d+(?:\s*(?:to|-|–)\s*\d+)?\+?\s+(?:[\w-]+\s+){0,2}(?:people|staff|employees|reports|nurses|engineers|developers|agents|managers|specialists|analysts|representatives|reps|associates|designers|technicians)\b`,
        String.raw`\b(?:conduct|own|owning|deliver|write|writing|complete|run|perform)\w*\s+(?:annual\s+|regular\s+|quarterly\s+)?performance (?:reviews?|evaluations?|appraisals?)\b`,
        String.raw`\b(?:people|line) (?:management|manager|leadership)\b`,
        String.raw`\b(?:headcount|hiring and (?:managing|developing|coaching))\b`,
    ].join("|"),
    "i",
);

const SELLS = new RegExp(
    [
        String.raw`\bcold[- ]?(?:call|calling|calls|emails?|outreach)\b`,
        String.raw`\boutbound (?:prospecting|outreach|sales|calls|calling)\b`,
        String.raw`\b(?:carry|carrying|own|owning|meet|exceed|hit|achieve)\s+(?:a\s+|an\s+|your\s+|the\s+)?(?:(?:sales|revenue|new[- ]business|new[- ]logo)\s+)?(?:quota|bag)\b(?!\s+of)`,
        String.raw`\bquota[- ]carrying\b`,
        String.raw`\b(?:generate|building|build|source|sourcing)\s+(?:new\s+)?(?:pipeline|leads|prospects)\b`,
        String.raw`\bclose\s+(?:new\s+)?(?:logos|business|deals|sales)\b`,
        String.raw`\bnew[- ]business development\b`,
    ].join("|"),
    "i",
);

/** A line that makes a credential a requirement. */
const CRED_WORD = /\b(?:certification|certificate|certified|licen[cs]e|licen[cs]ed|licen[cs]ure|designation|credential|accredit\w*)\b/i;
/** …but is about knowing or using something, not holding it. */
const CRED_EXPERIENCE = /\b(?:experience (?:with|in|using)|familiar(?:ity)? with|knowledge of|exposure to|working with|understanding of)\b/i;
/** Credential names: letters in capitals ("CISSP", "NRP", "CPA"), or "Security+". */
const CRED_TOKEN = /\b(?:[A-Z]{2,8}\+?|[A-Z][a-z]+\+)(?![a-z])/g;
/** Capitalised words that are not credentials. */
const NOT_CRED = new Set(["AND", "OR", "THE", "FOR", "WITH", "US", "USA", "CA", "UK", "EU", "ON", "BC", "AB", "QC", "NS", "HR", "IT", "AI", "ML", "SQL", "API", "APIS", "SSO", "CRM", "SAAS", "B2B", "B2C", "ERP", "EMR", "EHR", "KPI", "KPIS", "OKR", "OKRS", "ROI", "SLA", "SLAS", "QBR", "QBRS", "PRD", "PRDS", "MBA", "BA", "BS", "BSC", "BASC", "MS", "MSC", "PHD", "AWS", "GCP", "CI", "CD", "UI", "UX", "QA", "NOTE", "EOE", "ASAP", "FTE", "PTO", "RSU", "RSUS", "DEI", "COVID", "NA", "EMEA", "APAC", "LATAM"]);
/** Recognized candidate certifications, licences and professional designations (excludes compliance standards like PCI DSS, EEO labels like WMBE, and product acronyms). */
const KNOWN_CREDS = new Set([
    "CISSP", "CISM", "CISA", "CRISC", "CCSP", "CEH", "OSCP", "GIAC", "GSEC", "SECURITY+", "NETWORK+", "A+", "CYSA+",
    "PMP", "CAPM", "PRINCE2", "CSM", "CSPO", "PSPO", "PSM", "SAFE", "ITIL", "TOGAF", "CBAP", "CCBA", "LSSBB", "LSSGB",
    "CPA", "CFA", "CMA", "CIA", "CFP", "ACCA", "CGA", "CAMS", "CFCS", "FRM", "PRM", "CTP",
    "RN", "LPN", "LVN", "RPN", "NP", "APRN", "CNS", "CRNA", "CNM", "CNA", "PSW", "BLS", "ACLS", "PALS", "NRP",
    "CCRN", "CEN", "TNCC", "CPN", "OCN", "RD", "RDN", "RPH", "PHARMD", "MD", "DO", "DDS", "DMD", "OD", "DPM", "DVM",
    "PT", "DPT", "OT", "OTR", "SLP", "CCC", "RT", "RRT", "LCSW", "LMSW", "LMFT", "LPC", "LPCC", "LMHC", "BCBA",
    "PE", "FE", "EIT", "PENG", "PGEO", "LEED", "AIA", "NCARB",
    "PHR", "SPHR", "GPHR", "SHRM", "CHRP", "CHRL", "CHRE", "CCMP",
    "CCNA", "CCNP", "CCIE", "CKA", "CKAD", "CKS", "RHCSA", "RHCE",
    "CDL", "AZ", "DZ", "TWIC", "OSHA", "WHMIS", "HACCP", "SERVSAFE", "CFAA", "ASE",
    "FINRA", "SIE", "CSC", "CIM", "LLQP", "RIBO", "CIP", "FCIP",
]);

function credentialsAsked(lines: string[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
        if (!CRED_WORD.test(line) || OPTIONAL.test(line) || CRED_EXPERIENCE.test(line)) continue;
        if (COMPANY_VOICE.test(line) && !SEEKING_VOICE.test(line)) continue;
        for (const m of line.matchAll(CRED_TOKEN)) {
            const token = m[0]!;
            const upper = token.toUpperCase();
            if (NOT_CRED.has(upper.replace(/\+$/, "")) || !KNOWN_CREDS.has(upper)) continue;
            out.push(token);
        }
    }
    return unique(out);
}

/** Figures a posting spells out for years of experience ("five years of experience"). */
const YEAR_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const YEAR_FIGURE = String.raw`(\d{1,2}|${Object.keys(YEAR_WORDS).join("|")})`;
/** "9+ years", "5 yrs", "3-5 years", "five to seven years": the first figure is the fewest. Not "18 years of age" or "years old". */
const YEARS = new RegExp(String.raw`\b${YEAR_FIGURE}\s*(?:\+|plus)?(?:\s*(?:-|–|to)\s*(?:\d{1,2}|${Object.keys(YEAR_WORDS).join("|")})\s*\+?)?\s*(?:years?|yrs?)\b(?!\s*(?:of age|old|ago)\b)`, "i");
/** What leads a list item that is only the ask: "9+ years of relevant experience", "Minimum of 5 years", "At least 3 years", "Have 5+ years". */
const YEARS_LEAD = /^\W*(?:(?:you\s+)?(?:have|bring|possess)|(?:a\s+)?minimum(?:\s+of)?|min\.?|at\s+least|over|more\s+than|requires?|required|experience)?[\s:–-]*$/i;
/** A line that opens as the requirements list, so every figure of years on it is asked of the person: "Requirements: BSc, 7+ years, a licence". */
const YEARS_LABEL = /^\W*(?:requirements?|(?:minimum\s+)?qualifications?|(?:your|the\s+ideal)\s+profile|about\s+you|what\s+you(?:'ll|\s+will)?\s+(?:bring|need|have)|what\s+we(?:'re|\s+are)\s+looking\s+for|must[- ]haves?)\b/i;
/** A word that makes a sentence ask something of the person: "you bring", "must have", "candidates with", "requires". Not a bare "with" or "has" ("With over 10 years in the market, we...", "The founder has 20 years"). */
const YEARS_CUE = /\b(?:you|must|should|need|needs|require|requires|required|minimum|least|bring|brings|possess|(?:candidates?|applicants?|someone|people|professionals?)\s+with)\b/i;
/** A sentence about the company, not the person: its age or history ("founded in 2008", "20 years of history"), or "we/our" with nothing that seeks or asks ("we have served clients for 15 years"). */
const COMPANY_HISTORY = /\b(?:founded|established|history|anniversary|ago|since\s+(?:19|20)\d\d|in\s+business)\b/i;
const COMPANY_VOICE = /\b(?:we|we've|we're|our|us)\b/i;
const SEEKING_VOICE = /\b(?:you|want|wants|looking|seek|seeking|need|needs|require|requires|hire|hiring|expect|expects|ask|asks)\b/i;

/**
 * The fewest years of experience the posting asks of the person, from the sentences that ask for them as a
 * requirement: a list item that opens on the figure ("9+ years of relevant experience", "Minimum 5 years"),
 * a line under a requirements label ("Requirements: BSc, 7+ years"), or a sentence that asks ("you bring 7+
 * years", "candidates with 3-5 years"). Never a company's age or history, an optional clause, or a figure that
 * is not experience ("18 years of age"). Several asks read as the smallest: the most that is stated for sure.
 * The structured `min_years_experience` is on about half the postings, so a posting that states the years
 * only in its text was never held to them.
 */
function yearsRequired(lines: string[]): number | undefined {
    let fewest: number | undefined;
    for (const line of lines) {
        const labelled = YEARS_LABEL.test(line);
        for (const clause of line.split(";")) {
            if (OPTIONAL.test(clause) || COMPANY_HISTORY.test(clause) || (COMPANY_VOICE.test(clause) && !SEEKING_VOICE.test(clause))) continue;
            const m = YEARS.exec(clause);
            if (!m) continue;
            const before = clause.slice(0, m.index);
            if (!(labelled || YEARS_LEAD.test(before) || YEARS_CUE.test(before.split(/\s+/).slice(-6).join(" ")))) continue;
            const raw = m[1]!.toLowerCase();
            const n = /^\d/.test(raw) ? Number(raw) : YEAR_WORDS[raw];
            if (n == null || n < 1 || n > 30) continue;
            fewest = fewest == null ? n : Math.min(fewest, n);
        }
    }
    return fewest;
}

/** Skills a posting's real Requirements heading lists (`evidencedSkills`), trimmed to the short names. */
export function mustSkillsOf(skills: readonly string[] | undefined): string[] | undefined {
    const out = unique((skills ?? []).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2 && s.length <= 40)).slice(0, 12);
    return out.length > 0 ? out : undefined;
}

/** What `description` (and the language its `title` asks for) asks that a résumé either shows or does not; undefined when it asks none of it. */
export function jdAsksFromDescription(description: string | null | undefined, must?: readonly string[], title?: string | null): JdAsks | undefined {
    const text = (description ?? "").trim();
    const asks: JdAsks = {};
    const skills = mustSkillsOf(must);
    if (skills) asks.must = skills;
    if (text.length >= 40) {
        const lines = sentences(text);
        // The title can ask too ("French-speaking Account Manager", "Bilingual (English/French) Support Agent").
        const langs = languagesAsked(title ? [title, ...lines] : lines);
        if (langs.length > 0) asks.langs = langs;
        if (lines.some((l) => CLEARANCE.test(l) && !OPTIONAL.test(l))) asks.clearance = true;
        if (lines.some((l) => MANAGES.test(l) && !OPTIONAL.test(l))) asks.manages = true;
        if (lines.some((l) => SELLS.test(l) && !OPTIONAL.test(l))) asks.sells = true;
        const creds = credentialsAsked(lines);
        if (creds.length > 0) asks.creds = creds;
        const years = yearsRequired(lines);
        if (years != null) asks.years = years;
    }
    return Object.keys(asks).length > 0 ? asks : undefined;
}
