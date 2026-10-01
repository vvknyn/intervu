/**
 * Duty-based role-family inference for Rank retrieval and MatchChip relevance.
 *
 * WHY: Rank and MatchChip generalize across résumés via responsibilities
 * (experience bullets + generated summary), not domain-specific career maps
 * like CS-Ops→PM adjacency tables. A CS-headline résumé whose bullets mention
 * roadmap, backlog, and stakeholder management should surface Product Manager
 * because the duties say so — not because a curated key lists that jump.
 *
 * Pure TS: no React, no I/O, no LLM.
 */
import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { splitRoleTitles } from "@/lib/jobs/adjacent-roles";
import { resumeMatchText } from "@/lib/resume/match-text";
import type { ResumeData } from "@/types/resume";

/**
 * Rank/level words stripped from duty tokens before family inference and
 * relevance scoring. Shared with score.ts (imported from here to avoid a
 * circular dependency).
 */
export const RANK_WORDS: ReadonlySet<string> = new Set([
    "senior", "sr", "junior", "jr", "staff", "principal", "lead", "chief",
    "associate", "entry", "entry-level", "intern", "internship", "trainee",
    "apprentice", "i", "ii", "iii", "iv", "v",
]);

/** Ambiguous duty tokens that belong to multiple families — need context. */
const AMBIGUOUS_DUTY_TOKENS = new Set(["pipeline"]);

/**
 * Health families that duties alone never add; a title has to name or hint
 * at them ("Clinical Coordinator", "Physiotherapy Resident"). Most need a
 * licence: a health science graduate who did patient intake and triage is not
 * a Registered Nurse, and searching "Registered Nurse" lists roles they can't
 * take. The research and public-health words ("trial", "consent",
 * "surveillance") also turn up in growth and security résumés.
 */
const TITLE_REQUIRED_FAMILIES: ReadonlySet<RoleFamilyId> = new Set([
    "clinical",
    "physio",
    "lab",
    "pharmacy",
    "clinical_research",
    "public_health",
]);

export type RoleFamilyId =
    | "product"
    | "engineering"
    | "data"
    | "design"
    | "marketing"
    | "sales"
    | "customer_success"
    | "clinical"
    | "physio"
    | "lab"
    | "pharmacy"
    | "clinical_research"
    | "public_health"
    | "teaching"
    | "operations";

const DUTY_SIGNALS: Readonly<Record<RoleFamilyId, ReadonlySet<string>>> = {
    product: new Set([
        "roadmap", "backlog", "requirements", "stakeholder", "sow", "adoption", "qbr", "pir", "rca",
    ]),
    engineering: new Set([
        "api", "pipeline", "etl", "latency", "incident", "observability", "deploy", "kubernetes",
    ]),
    data: new Set(["sql", "dashboard", "metric", "analytics", "warehouse"]),
    design: new Set(["figma", "wireframe", "prototype", "usability"]),
    marketing: new Set(["campaign", "seo", "funnel", "brand", "content"]),
    sales: new Set(["quota", "prospect", "pipeline"]),
    customer_success: new Set(["qbr", "qbrs", "churn", "renewal", "renewals", "nrr"]),
    clinical: new Set(["patient", "bedside", "triage", "medication", "phlebotomy", "charting"]),
    physio: new Set(["rehabilitation", "musculoskeletal", "orthopaedic", "orthopedic", "mobility"]),
    lab: new Set(["hematology", "haematology", "microbiology", "specimen", "specimens", "assay", "assays", "phlebotomy"]),
    pharmacy: new Set(["dispense", "dispensing", "compounding", "prescriptions"]),
    clinical_research: new Set(["irb", "gcp", "trial", "trials", "redcap", "ctms", "consent"]),
    public_health: new Set(["surveillance", "epidemiology", "outbreak", "biostatistics"]),
    teaching: new Set(["classroom", "curriculum", "lesson", "students", "pedagogy"]),
    operations: new Set(["onboarding", "cadence", "sla", "retention", "lifecycle", "compliance"]),
};

/** Short retrieval titles emitted per inferred family (for Meili `q`). */
const FAMILY_RETRIEVAL_TITLES: Readonly<Record<RoleFamilyId, readonly string[]>> = {
    product: ["Product Manager", "Technical Product Manager"],
    engineering: ["Software Engineer", "Backend Engineer"],
    data: ["Data Analyst", "Data Engineer"],
    design: ["UX Designer", "Product Designer"],
    marketing: ["Marketing Manager", "Digital Marketing Specialist"],
    sales: ["Account Executive", "Sales Manager"],
    customer_success: ["Customer Success Manager", "Technical Account Manager"],
    clinical: ["Registered Nurse", "Nurse"],
    physio: ["Physical Therapist", "Physiotherapist"],
    lab: ["Medical Laboratory Technologist", "Medical Technologist", "Clinical Laboratory Scientist"],
    pharmacy: ["Pharmacist", "Clinical Pharmacist"],
    clinical_research: ["Clinical Research Coordinator", "Clinical Research Assistant"],
    public_health: ["Public Health Analyst", "Epidemiologist", "Public Health Specialist"],
    teaching: ["Teacher", "Instructional Coordinator"],
    operations: ["Operations Manager", "Program Manager"],
};

/** Title substring hints — one duty signal + a related title word fires the family. */
const TITLE_FAMILY_HINTS: Readonly<Record<RoleFamilyId, ReadonlySet<string>>> = {
    product: new Set(["product", "pm", "program", "owner"]),
    engineering: new Set(["engineer", "developer", "devops", "sre", "software", "platform"]),
    data: new Set(["data", "analyst", "analytics", "bi", "scientist"]),
    design: new Set(["design", "ux", "ui", "creative"]),
    marketing: new Set(["market", "growth", "brand", "content"]),
    sales: new Set(["sales", "account", "revenue", "business development", "bd"]),
    customer_success: new Set(["customer success", "client success", "account manag", "csm"]),
    // Nursing needs a licence, so only a nursing word counts: "Patient Services Assistant" and
    // "Clinical Research Assistant" are not nurses. "rn"/"lpn" are whole-word patterns below:
    // as substrings they hit "intern" and "governance".
    clinical: new Set(["nurse", "nursing"]),
    physio: new Set(["physio", "physical therap", "rehab", "kinesi"]),
    lab: new Set(["laborator", "lab ", "mlt", "phlebotom"]),
    pharmacy: new Set(["pharmac"]),
    clinical_research: new Set(["clinical research", "research coordinator", "research assistant", "clinical trial", "study coordinator"]),
    public_health: new Set(["public health", "epidemiolog", "health promot", "community health"]),
    teaching: new Set(["teach", "instructor", "educator", "professor", "faculty"]),
    operations: new Set(["operations", "ops", "program", "coordinator"]),
};

/** Whole-title patterns that alone name a family (no duty signal required). */
const TITLE_FAMILY_PATTERNS: Readonly<Record<RoleFamilyId, readonly RegExp[]>> = {
    product: [/product manager/i, /technical product manager/i, /product owner/i],
    engineering: [
        /software (?:engineer|developer)/i,
        /back-?end (?:engineer|developer)/i,
        /front-?end (?:engineer|developer)/i,
        /full[- ]?stack (?:engineer|developer)/i,
        /devops engineer/i,
        /site reliability engineer/i,
        /\bSRE\b/,
        /(?:cyber)?security engineer/i,
        /(?:platform|infrastructure|cloud) engineer/i,
        /(?:machine learning|ml) engineer/i,
        /(?:ios|android|mobile) (?:engineer|developer)/i,
        /web developer/i,
        /qa engineer/i,
    ],
    data: [/data analyst/i, /data engineer/i, /analytics engineer/i],
    design: [/ux designer/i, /product designer/i, /ui designer/i],
    marketing: [/marketing manager/i, /growth marketing/i, /content strategist/i],
    sales: [/account executive/i, /sales manager/i, /business development/i, /sales development/i, /sales representative/i, /inside sales/i, /\b[SB]DR\b/],
    customer_success: [/customer success/i, /client success/i, /technical account manag/i, /\baccount manager\b/i],
    clinical: [/registered nurse/i, /\bnurse\b/i, /clinical coordinator/i, /\b(?:RN|LPN|RPN)\b/],
    physio: [/physiotherap/i, /physical therap/i],
    lab: [/medical laborator/i, /clinical laborator/i, /medical technologist/i, /laboratory technologist/i, /\bMLT\b/],
    pharmacy: [/\bpharmacist\b/i],
    clinical_research: [/clinical research/i, /clinical trials?/i, /research coordinator/i, /\bCRC\b/],
    public_health: [/public health/i, /epidemiologist/i, /health promot/i, /community health/i],
    teaching: [/\bteacher\b/i, /instructor/i, /professor/i],
    operations: [/operations manager/i, /program manager/i],
};

/** Tokenize duty text: meaningful title tokens with rank words stripped. */
export function dutyTokens(text: string): string[] {
    return meaningfulTitleTokens(text).filter((t) => !RANK_WORDS.has(t));
}

/** Unique duty tokens across the résumé's matchable text (summary,
 *  experience/project bullets, skills) — see resumeMatchText for why all
 *  four sources are read, not experience alone. */
export function resumeDutyTokens(resume: ResumeData): string[] {
    return [...new Set(dutyTokens(resumeMatchText(resume)))];
}

function normalizeTitles(titles: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of titles) {
        for (const part of splitRoleTitles(raw ?? "")) {
            const key = part.toLowerCase();
            if (!part.trim() || seen.has(key)) continue;
            seen.add(key);
            out.push(part);
        }
    }
    return out;
}

function titleBlob(titles: string[]): string {
    return normalizeTitles(titles).join(" ").toLowerCase();
}

function titleMentionsFamily(family: RoleFamilyId, titles: string[]): boolean {
    const blob = titleBlob(titles);
    if (!blob) return false;
    for (const hint of TITLE_FAMILY_HINTS[family]) {
        if (blob.includes(hint)) return true;
    }
    for (const pattern of TITLE_FAMILY_PATTERNS[family]) {
        for (const title of normalizeTitles(titles)) {
            if (pattern.test(title)) return true;
        }
    }
    return false;
}

function titleNamesFamily(family: RoleFamilyId, titles: string[]): boolean {
    for (const pattern of TITLE_FAMILY_PATTERNS[family]) {
        for (const title of normalizeTitles(titles)) {
            if (pattern.test(title)) return true;
        }
    }
    return false;
}

function ambiguousTokenAllowed(
    token: string,
    family: RoleFamilyId,
    dutySet: ReadonlySet<string>,
    titles: string[],
): boolean {
    if (!AMBIGUOUS_DUTY_TOKENS.has(token)) return true;

    const otherSignals = [...DUTY_SIGNALS[family]].filter(
        (s) => s !== token && dutySet.has(s),
    );
    if (otherSignals.length > 0) return true;
    return titleMentionsFamily(family, titles);
}

function countFamilyDutySignals(
    family: RoleFamilyId,
    tokens: string[],
    titles: string[],
): number {
    const dutySet = new Set(tokens);
    let count = 0;
    for (const token of tokens) {
        if (!DUTY_SIGNALS[family].has(token)) continue;
        if (!ambiguousTokenAllowed(token, family, dutySet, titles)) continue;
        count++;
    }
    return count;
}

/**
 * Infer compact role families from experience/profession titles + duty tokens.
 *
 * A family fires when:
 * - ≥2 distinct duty-signal tokens match (not for `TITLE_REQUIRED_FAMILIES`), OR
 * - 1 duty-signal AND titles mention a related word, OR
 * - a title clearly names the family (e.g. "Product Manager", "Registered Nurse").
 */
export function inferRoleFamilies(titles: string[], dutyTokenList: string[]): RoleFamilyId[] {
    const fired: RoleFamilyId[] = [];
    for (const family of Object.keys(DUTY_SIGNALS) as RoleFamilyId[]) {
        if (titleNamesFamily(family, titles)) {
            fired.push(family);
            continue;
        }
        const signalCount = countFamilyDutySignals(family, dutyTokenList, titles);
        if (signalCount >= 2 && !TITLE_REQUIRED_FAMILIES.has(family)) {
            fired.push(family);
            continue;
        }
        if (signalCount >= 1 && titleMentionsFamily(family, titles)) {
            fired.push(family);
        }
    }
    return fired;
}

/** Retrieval titles derived from inferred duty/title families (deduped, stable order). */
export function dutyDerivedRoleTitles(resume: ResumeData): string[] {
    const titles: string[] = [];
    const profession = (resume.profile?.profession ?? "").trim();
    if (profession) titles.push(profession);
    for (const exp of resume.experience ?? []) {
        const role = (exp.role ?? "").trim();
        if (role) titles.push(role);
    }

    const dutyTokenList = resumeDutyTokens(resume);
    const families = inferRoleFamilies(titles, dutyTokenList);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const family of families) {
        for (const title of FAMILY_RETRIEVAL_TITLES[family]) {
            const key = title.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(title);
        }
    }
    return out;
}

/**
 * The families a title-like phrase IS, by whole-title pattern only ("Customer
 * Success Operations Manager" → customer success and operations). No duty
 * inference: this reads what a résumé or a posting calls the role.
 */
export function familiesNamedBy(phrases: string[]): RoleFamilyId[] {
    return (Object.keys(DUTY_SIGNALS) as RoleFamilyId[]).filter((family) => titleNamesFamily(family, phrases));
}

/** The retrieval titles of `families`, in family order, deduped. */
export function familyRetrievalTitles(families: RoleFamilyId[]): string[] {
    return [...new Set(families.flatMap((family) => FAMILY_RETRIEVAL_TITLES[family]))];
}
