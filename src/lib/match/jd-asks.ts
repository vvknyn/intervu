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
    /** The skills its Requirements heading lists (`must_have_skills`, only when a real heading was found), lowercased. */
    must?: string[];
    /** Each bullet of its Requirements section as its most telling terms, one list per bullet (jd-match.ts). */
    bullets?: string[][];
}

/** A sentence that makes whatever it names optional. */
const OPTIONAL = /\b(?:asset|assets|preferred|prefer|nice[- ]to[- ]have|bonus|(?:a|an)\s+(?:plus|advantage)|considered|beneficial|desirable|ideal(?:ly)?|welcome|helpful|not required|not necessary|optional)\b/i;

const LANGUAGES = [
    "french", "spanish", "german", "italian", "portuguese", "dutch", "swedish", "polish", "russian", "ukrainian", "turkish", "greek", "hebrew", "arabic",
    "hindi", "punjabi", "urdu", "tamil", "bengali", "gujarati", "mandarin", "cantonese", "japanese", "korean", "vietnamese", "tagalog", "thai", "indonesian",
];
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

function credentialsAsked(lines: string[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
        if (!CRED_WORD.test(line) || OPTIONAL.test(line) || CRED_EXPERIENCE.test(line)) continue;
        for (const m of line.matchAll(CRED_TOKEN)) {
            const token = m[0]!;
            if (NOT_CRED.has(token.toUpperCase().replace(/\+$/, ""))) continue;
            out.push(token);
        }
    }
    return unique(out);
}

/** Skills a posting's real Requirements heading lists (`evidencedSkills`), trimmed to the short names. */
export function mustSkillsOf(skills: readonly string[] | undefined): string[] | undefined {
    const out = unique((skills ?? []).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2 && s.length <= 40)).slice(0, 12);
    return out.length > 0 ? out : undefined;
}

/** What `description` asks that a résumé either shows or does not; undefined when it asks none of it. */
export function jdAsksFromDescription(description: string | null | undefined, must?: readonly string[]): JdAsks | undefined {
    const text = (description ?? "").trim();
    const asks: JdAsks = {};
    const skills = mustSkillsOf(must);
    if (skills) asks.must = skills;
    if (text.length >= 40) {
        const lines = sentences(text);
        const langs = languagesAsked(lines);
        if (langs.length > 0) asks.langs = langs;
        if (lines.some((l) => CLEARANCE.test(l) && !OPTIONAL.test(l))) asks.clearance = true;
        if (lines.some((l) => MANAGES.test(l) && !OPTIONAL.test(l))) asks.manages = true;
        if (lines.some((l) => SELLS.test(l) && !OPTIONAL.test(l))) asks.sells = true;
        const creds = credentialsAsked(lines);
        if (creds.length > 0) asks.creds = creds;
    }
    return Object.keys(asks).length > 0 ? asks : undefined;
}
