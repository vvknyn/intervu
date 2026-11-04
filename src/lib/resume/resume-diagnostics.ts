import type { ResumeData } from "@/types/resume";
import { descriptionToBullets } from "./merge-bullet-lines";

export interface BulletDiagnosticItem {
    entryId: string;
    roleTitle: string;
    bullet: string;
    detail?: string;
}

export interface ResumeDiagnosticsReport {
    totalBullets: number;
    quantifiedBullets: number;
    weakOpeners: BulletDiagnosticItem[];
    unquantifiedBullets: BulletDiagnosticItem[];
    fillerAndBuzzwords: BulletDiagnosticItem[];
    overlongBullets: BulletDiagnosticItem[];
    tightenableCount: number;
}

const WEAK_OPENER_RE =
    /^(?:[•\-*▪]\s*)?(?:(?:was|were)\s+)?(responsible\s+for|helped\s+with|assisted\s+(?:in|with)|worked\s+on|tasked\s+with|involved\s+in|duties\s+included|in\s+charge\s+of|accountable\s+for)\b/i;

const CONVERTIBLE_DUTY_RE =
    /^(\s*(?:[•\-*▪]\s*)?)(?:(?:was|were)\s+)?(?:responsible\s+for|tasked\s+with|in\s+charge\s+of|accountable\s+for|duties\s+included)\s+([A-Za-z]+ing)\b/i;

const FILLER_WORDS_RE =
    /\b(successfully|effectively|various|multiple|numerous|several\s+different)\b/i;

const BUZZWORDS_RE =
    /\b(results-driven|hard-?working|team\s+player|go-getter|thought\s+leader|synergy|detail-oriented|self-starter|dynamic|passionate\s+about)\b/i;

const QUANTIFIED_SIGNAL_RE =
    /\d|%|\$|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|hundred|thousand|million|billion|daily|weekly|bi-?weekly|monthly|quarterly|annually|shift|shifts)\b/i;

const IRREGULAR_GERUNDS: Record<string, string> = {
    leading: "led",
    building: "built",
    growing: "grew",
    running: "ran",
    making: "made",
    driving: "drove",
    writing: "wrote",
    overseeing: "oversaw",
    cutting: "cut",
    setting: "set",
    hitting: "hit",
    splitting: "split",
    teaching: "taught",
    bringing: "brought",
    keeping: "kept",
    meeting: "met",
    winning: "won",
    holding: "held",
    selling: "sold",
    telling: "told",
    finding: "found",
    sending: "sent",
    spending: "spent",
    lending: "lent",
    paying: "paid",
    saying: "said",
    laying: "laid",
    dealing: "dealt",
    feeling: "felt",
    leaving: "left",
    losing: "lost",
    choosing: "chose",
    speaking: "spoke",
    breaking: "broke",
    taking: "took",
    giving: "gave",
    seeing: "saw",
    doing: "did",
    going: "went",
    getting: "got",
};

const DOUBLE_CONSONANT_GERUNDS = new Set([
    "planning",
    "shipping",
    "mapping",
    "logging",
    "flagging",
    "tagging",
    "dropping",
    "stopping",
    "wrapping",
    "stepping",
    "fitting",
    "spotting",
    "plotting",
    "scanning",
    "spanning",
    "thinning",
    "pinning",
    "trimming",
    "skimming",
    "vetting",
    "netting",
    "chatting",
    "knotting",
    "equipping",
    "controlling",
    "patrolling",
    "enrolling",
    "fulfilling",
    "referring",
    "preferring",
    "transferring",
    "occurring",
    "conferring",
    "deferring",
    "incurring",
    "submitting",
    "admitting",
    "emitting",
    "omitting",
    "permitting",
    "committing",
    "transmitting",
    "allotting",
]);

const SILENT_E_STEMS = new Set([
    "manag",
    "creat",
    "organiz",
    "organis",
    "analyz",
    "analys",
    "improv",
    "enhanc",
    "optimiz",
    "optimis",
    "reduc",
    "decreas",
    "increas",
    "resolv",
    "solv",
    "advis",
    "streamlin",
    "prepar",
    "compil",
    "coordinat",
    "collaborat",
    "facilitat",
    "automat",
    "integrat",
    "migrat",
    "architected".slice(0, -2),
    "execut",
    "implement",
    "operat",
    "evaluat",
    "negotiat",
    "communicat",
    "delegat",
    "escalat",
    "validat",
    "generat",
    "acceler",
    "consolidat",
    "standardiz",
    "standardis",
    "moderniz",
    "modernis",
    "supervis",
    "diagnos",
    "triag",
    "discharg",
    "educat",
    "administrat",
    "orchestrat",
    "cultivat",
    "formulat",
    "initi",
    "launch",
    "scal",
    "scalin".slice(0, -2),
    "serv",
    "sav",
    "shap",
    "shar",
    "guid",
    "handl",
    "schedul",
    "maintai".slice(0, -1),
    "updat",
    "upgrad",
    "produc",
    "introduc",
    "defin",
    "refin",
    "combin",
    "examin",
    "determin",
    "align",
    "assign",
    "design",
    "assur",
    "ensur",
    "measur",
    "secu",
    "secur",
    "proc",
    "procur",
    "structur",
    "captur",
    "configur",
    "clos",
    "compos",
    "expos",
    "propos",
    "us",
    "reus",
    "rev",
    "revis",
    "achiev",
    "receiv",
    "perceiv",
    "reliev",
    "believ",
    "conclud",
    "includ",
    "exclud",
    "provid",
    "decid",
    "divid",
    "presid",
    "res",
    "resid",
    "comple",
    "complet",
    "comp",
    "compet",
    "delet",
    "promot",
    "devot",
    "pil",
    "pilot",
    "quot",
    "not",
    "vot",
    "rout",
    "distribut",
    "contribut",
    "institut",
    "constitut",
    "substitut",
    "execut",
    "prosecut",
]);

/**
 * Converts a common English gerund ("managing", "building", "streamlining")
 * into its past-tense form ("managed", "built", "streamlined"), or null if uncertain.
 */
export function gerundToPastTense(gerund: string): string | null {
    const low = gerund.toLowerCase();
    if (!low.endsWith("ing") || low.length < 5) return null;
    if (IRREGULAR_GERUNDS[low]) return IRREGULAR_GERUNDS[low]!;
    if (DOUBLE_CONSONANT_GERUNDS.has(low)) return `${low.slice(0, -3)}ed`;
    const stem = low.slice(0, -3);
    if (stem.endsWith("y")) return `${stem}ed`;
    if (stem.endsWith("i")) return `${stem.slice(0, -1)}ied`;
    if (
        SILENT_E_STEMS.has(stem) ||
        /(?:at|iz|is|ur|iv|ov|av|ev|ul|gl|pl|bl|cl|dl|fl|tl|zl|rc|nc|rg|ng|lg|dg|th|sh|ch)$/.test(stem)
    ) {
        if (/(?:at|iz|is|ur|iv|ov|av|ev|ul|gl|pl|bl|cl|dl|fl|tl|zl|rc|nc|rg|dg)$/.test(stem) || SILENT_E_STEMS.has(stem)) {
            if (!stem.endsWith("sh") && !stem.endsWith("ch") && !stem.endsWith("th") && !stem.endsWith("ng") && !stem.endsWith("lg") && !stem.endsWith("align") && !stem.endsWith("assign") && !stem.endsWith("design") && !stem.endsWith("implement") && !stem.endsWith("launch")) {
                return `${stem}ed`;
            }
        }
    }
    return `${stem}ed`;
}

function capitalizeFirst(word: string): string {
    return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * Deterministically tightens a single résumé bullet without inventing any facts or numbers:
 * - Converts passive duty openers ("Responsible for managing...", "Tasked with building...") into direct past-tense action verbs ("Managed...", "Built...").
 * - Removes leading filler adverbs ("Successfully ", "Effectively ") and vague multi-modifiers ("various ", "multiple ").
 */
export function tightenResumeBullet(line: string): string {
    let out = line;

    // 1. Convert passive duty opener + gerund to direct past-tense verb
    const dutyMatch = out.match(CONVERTIBLE_DUTY_RE);
    if (dutyMatch) {
        const prefix = dutyMatch[1] ?? "";
        const gerund = dutyMatch[2]!;
        const past = gerundToPastTense(gerund);
        if (past) {
            out = `${prefix}${capitalizeFirst(past)}${out.slice(dutyMatch[0].length)}`;
        }
    }

    // 2. Strip leading filler adverb ("Successfully led..." -> "Led...")
    out = out.replace(
        /^(\s*(?:[•\-*▪]\s*)?)(?:successfully|effectively)\s+([A-Za-z])/i,
        (_, prefix: string, nextChar: string) => `${prefix}${nextChar.toUpperCase()}`,
    );

    // 3. Strip mid-sentence filler adverbs/adjectives ("successfully ", "effectively ", "various ", "multiple ")
    out = out
        .replace(/\b(?:successfully|effectively)\s+/gi, "")
        .replace(/\b(?:various|multiple)\s+(?=[a-z]{3,})/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();

    return out;
}

const WORD_TOKEN_RE = /\p{L}[\p{L}\p{N}'’.-]*/gu;
const MAX_CONCISE_BULLET_WORDS = 35;

/**
 * Evaluates a `ResumeData` object against the 4-part ATS & recruiter scan diagnostics:
 * 1. Action-verb openers (flags "Responsible for", "Helped with", "Assisted in", "Worked on")
 * 2. Quantified impact / XYZ formula (flags experience bullets with no numbers/metrics)
 * 3. Filler words & generic clichés ("various", "multiple", "successfully", "results-driven", "team player")
 * 4. Concise bullet length (flags bullets over 35 words / >2 lines)
 */
export function analyzeResumeDiagnostics(data: ResumeData): ResumeDiagnosticsReport {
    const weakOpeners: BulletDiagnosticItem[] = [];
    const unquantifiedBullets: BulletDiagnosticItem[] = [];
    const fillerAndBuzzwords: BulletDiagnosticItem[] = [];
    const overlongBullets: BulletDiagnosticItem[] = [];

    let totalBullets = 0;
    let quantifiedBullets = 0;
    let tightenableCount = 0;

    const entries = [
        ...(data.experience ?? []).map((e) => ({ ...e, isExp: true })),
        ...(data.projects ?? []).map((p) => ({ ...p, isExp: false })),
    ];

    for (const entry of entries) {
        const roleTitle = [entry.role, entry.company].filter(Boolean).join(" · ") || "Untitled role";
        const bullets = descriptionToBullets(entry.description ?? "");
        for (const rawBullet of bullets) {
            const bullet = rawBullet.trim();
            if (!bullet) continue;
            totalBullets++;

            if (tightenResumeBullet(bullet) !== bullet) {
                tightenableCount++;
            }

            const weakMatch = bullet.match(WEAK_OPENER_RE);
            if (weakMatch) {
                weakOpeners.push({
                    entryId: entry.id,
                    roleTitle,
                    bullet,
                    detail: weakMatch[1],
                });
            }

            const hasMetric = QUANTIFIED_SIGNAL_RE.test(bullet);
            if (hasMetric) {
                quantifiedBullets++;
            } else if (entry.isExp) {
                unquantifiedBullets.push({
                    entryId: entry.id,
                    roleTitle,
                    bullet,
                });
            }

            const fillerMatch = bullet.match(FILLER_WORDS_RE) ?? bullet.match(BUZZWORDS_RE);
            if (fillerMatch) {
                fillerAndBuzzwords.push({
                    entryId: entry.id,
                    roleTitle,
                    bullet,
                    detail: fillerMatch[1],
                });
            }

            const words = bullet.match(WORD_TOKEN_RE)?.length ?? 0;
            if (words > MAX_CONCISE_BULLET_WORDS) {
                overlongBullets.push({
                    entryId: entry.id,
                    roleTitle,
                    bullet,
                    detail: `${words} words`,
                });
            }
        }
    }

    const summary = (data.generatedSummary ?? "").trim();
    if (summary) {
        const sumFiller = summary.match(BUZZWORDS_RE) ?? summary.match(FILLER_WORDS_RE);
        if (sumFiller) {
            fillerAndBuzzwords.push({
                entryId: "summary",
                roleTitle: "Summary",
                bullet: summary,
                detail: sumFiller[1],
            });
        }
        if (tightenResumeBullet(summary) !== summary) {
            tightenableCount++;
        }
    }

    return {
        totalBullets,
        quantifiedBullets,
        weakOpeners,
        unquantifiedBullets,
        fillerAndBuzzwords,
        overlongBullets,
        tightenableCount,
    };
}

/**
 * Applies `tightenResumeBullet` across all experience entries, project entries, and the summary.
 */
export function tightenResumeData(data: ResumeData): { data: ResumeData; fixedCount: number } {
    let fixedCount = 0;

    const tightenBlock = (desc: string): string => {
        if (!desc) return desc;
        const lines = desc.split("\n");
        const nextLines = lines.map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            const after = tightenResumeBullet(line);
            if (after !== line) fixedCount++;
            return after;
        });
        return nextLines.join("\n");
    };

    const nextExperience = (data.experience ?? []).map((exp) => ({
        ...exp,
        description: tightenBlock(exp.description),
    }));

    const nextProjects = (data.projects ?? []).map((proj) => ({
        ...proj,
        description: tightenBlock(proj.description),
    }));

    let nextSummary = data.generatedSummary ?? "";
    if (nextSummary) {
        const tightenedSummary = tightenResumeBullet(nextSummary);
        if (tightenedSummary !== nextSummary) {
            fixedCount++;
            nextSummary = tightenedSummary;
        }
    }

    return {
        data: {
            ...data,
            experience: nextExperience,
            projects: nextProjects,
            generatedSummary: nextSummary,
        },
        fixedCount,
    };
}
