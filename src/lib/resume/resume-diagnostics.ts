import type { ResumeData } from "@/types/resume";
import { hasHybridTechnicalCustomerProfile, roleEndYear, STALE_ROLE_YEARS } from "@/lib/jobs/resume-match";
import { matchResumeLinks } from "./links";
import { BULLET_MARKER_RE, descriptionToBullets } from "./merge-bullet-lines";

export interface BulletDiagnosticItem {
    entryId: string;
    roleTitle: string;
    bullet: string;
    detail?: string;
}

export interface ResumeStrategicRecommendation {
    id: "consolidate_older_roles" | "hybrid_role_targeting" | "emphasize_founder_build" | "clickable_project_links";
    category: "structure" | "positioning" | "formatting";
    title: string;
    detail: string;
}

export interface ResumeDiagnosticsReport {
    totalBullets: number;
    quantifiedBullets: number;
    weakOpeners: BulletDiagnosticItem[];
    unquantifiedBullets: BulletDiagnosticItem[];
    fillerAndBuzzwords: BulletDiagnosticItem[];
    overlongBullets: BulletDiagnosticItem[];
    tightenableCount: number;
    consolidatableOlderBulletsCount: number;
    recommendations: ResumeStrategicRecommendation[];
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

    const { recommendations, consolidatableOlderBulletsCount } = buildStrategicRecommendations(data);

    return {
        totalBullets,
        quantifiedBullets,
        weakOpeners,
        unquantifiedBullets,
        fillerAndBuzzwords,
        overlongBullets,
        tightenableCount,
        consolidatableOlderBulletsCount,
        recommendations,
    };
}

function isOlderExperienceRole(index: number, dates: string, nowYear: number): boolean {
    if (index === 0) return false;
    const ended = roleEndYear(dates ?? "", nowYear);
    if (ended !== null) return nowYear - ended >= STALE_ROLE_YEARS;
    return index >= 2;
}

function formatNameList(names: string[]): string {
    if (names.length === 0) return "";
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Generates high-level career positioning, structure, and formatting recommendations
 * from the résumé's overall career arc (10+ YoE older-role consolidation, compound
 * technical + customer-facing role targeting, founder/live-platform emphasis, and
 * clickable live project hyperlinks).
 */
export function buildStrategicRecommendations(
    data: ResumeData,
    nowYear: number = new Date().getFullYear(),
): {
    recommendations: ResumeStrategicRecommendation[];
    consolidatableOlderBulletsCount: number;
} {
    const recommendations: ResumeStrategicRecommendation[] = [];
    const years = data.profile?.yearsOfExperience ?? 0;
    const experience = data.experience ?? [];
    const projects = data.projects ?? [];

    // 1. Consolidate older roles (10+ years of experience with multiple prior roles)
    let consolidatableOlderBulletsCount = 0;
    const olderRoles = experience.filter((exp, idx) => isOlderExperienceRole(idx, exp?.dates ?? "", nowYear));
    for (const oldExp of olderRoles) {
        const count = descriptionToBullets(oldExp.description ?? "").length;
        if (count > 2) consolidatableOlderBulletsCount += count - 2;
    }
    const recentBullets = experience[0] ? descriptionToBullets(experience[0].description ?? "").length : 0;
    if ((years >= 10 || experience.length >= 4) && olderRoles.length >= 2 && (recentBullets >= 4 || consolidatableOlderBulletsCount > 0)) {
        const companyNames = olderRoles
            .map((e) => (e.company || e.role || "").trim())
            .filter(Boolean)
            .slice(0, 3);
        const named = companyNames.length > 0 ? ` at ${formatNameList(companyNames)}` : "";
        recommendations.push({
            id: "consolidate_older_roles",
            category: "structure",
            title: "Consolidate older roles",
            detail: `With ${years >= 10 ? `${years}+` : "10+"} years of experience, keep older roles${named} to 1–2 'greatest hits' bullets to save space for your recent technical accomplishments.`,
        });
    }

    // 2. Compound technical + customer-facing role targeting (avoid standard Account Manager under-leveling)
    if (hasHybridTechnicalCustomerProfile(data) && (years >= 8 || experience.length >= 3)) {
        recommendations.push({
            id: "hybrid_role_targeting",
            category: "positioning",
            title: "Target hybrid technical-commercial roles",
            detail:
                "You are overqualified for a standard 'Account Manager' role. Target 'Head of Solutions', 'Founding Solutions Engineer', 'Forward Deployed Engineer', or 'Solutions Architect' roles where your ability to code and talk to customers simultaneously is the primary value prop.",
        });
    }

    // 3. Founder / live platform emphasis (especially vs MBA / credentials for startup roles)
    const founderProject = projects.find((p) => {
        const blob = `${p?.role ?? ""} ${p?.company ?? ""} ${p?.description ?? ""}`;
        return /\b(?:founder|co-founder|creator)\b/i.test(blob) || (matchResumeLinks(`${p?.role ?? ""} ${p?.company ?? ""}`).length > 0 && /\b\d+\s*[kmb]\+?\b/i.test(blob));
    });
    if (founderProject) {
        const projLinks = matchResumeLinks(`${founderProject.role ?? ""} ${founderProject.company ?? ""} ${founderProject.description ?? ""}`);
        const projLabel = projLinks[0]?.text || founderProject.role || founderProject.company || "your live platform";
        const scaleMatch = `${founderProject.role ?? ""} ${founderProject.company ?? ""} ${founderProject.description ?? ""}`.match(/\b\d+(?:\.\d+)?\s*[KMB]\+?\s*(?:postings|users|members|requests|records)?\b/i);
        const scaleNote = scaleMatch ? ` with ${scaleMatch[0].trim()}` : "";
        const hasMba = (data.education ?? []).some((e) => /\bmba\b|master of business/i.test(`${e?.degree ?? ""} ${e?.institution ?? ""}`));
        recommendations.push({
            id: "emphasize_founder_build",
            category: "positioning",
            title: "Emphasize your 'Founder' experience",
            detail: `Being the builder who shipped and operates a live platform (${projLabel}${scaleNote}) is a high-signal proof of execution${hasMba ? " — at startups, it often carries more weight than an MBA" : ""}.`,
        });
    }

    // 4. Clickable live project / portfolio domain in PDF
    const projectDomainLinks = projects.flatMap((p) =>
        matchResumeLinks(`${p?.role ?? ""} ${p?.company ?? ""} ${p?.description ?? ""}`).filter((l) => !l.url.startsWith("mailto:")),
    );
    const contactDomainLinks = matchResumeLinks(data.profile?.website ?? "").filter((l) => !l.url.startsWith("mailto:"));
    const primaryDomain = projectDomainLinks[0]?.text ?? contactDomainLinks[0]?.text ?? null;
    if (primaryDomain) {
        recommendations.push({
            id: "clickable_project_links",
            category: "formatting",
            title: `Make '${primaryDomain}' a clickable hyperlink`,
            detail: `'${primaryDomain}' is automatically embedded as a clickable PDF link annotation on export so founders and hiring managers can open it directly from the PDF.`,
        });
    }

    return { recommendations, consolidatableOlderBulletsCount };
}

function bulletSignalScore(bullet: string, index: number, total: number): number {
    let score = 0;
    if (QUANTIFIED_SIGNAL_RE.test(bullet)) score += 3;
    if (/[%$]|\b\d+\s*[x×kmb]\b/i.test(bullet)) score += 2;
    if (!WEAK_OPENER_RE.test(bullet)) score += 1;
    // Slight preference for earlier bullets on ties
    score -= total > 1 ? (index / (total - 1)) * 0.5 : 0;
    return score;
}

function detectMarker(description: string): string {
    for (const line of description.split("\n")) {
        const m = line.match(BULLET_MARKER_RE);
        if (m) return `${m[0].trim()} `;
    }
    return "• ";
}

/**
 * Compresses older experience roles (ended ≥5 years ago, after the current role) to at most
 * `maxBulletsPerOlderRole` (default 2) highest-signal 'greatest hits' bullets, preserving
 * original bullet order among the kept bullets.
 */
export function consolidateOlderRoles(
    data: ResumeData,
    maxBulletsPerOlderRole = 2,
    nowYear: number = new Date().getFullYear(),
): { data: ResumeData; removedCount: number } {
    let removedCount = 0;
    const nextExperience = (data.experience ?? []).map((exp, idx) => {
        if (!isOlderExperienceRole(idx, exp?.dates ?? "", nowYear)) return exp;
        const bullets = descriptionToBullets(exp.description ?? "");
        if (bullets.length <= maxBulletsPerOlderRole) return exp;
        const keepIndices = new Set(
            bullets
                .map((b, i) => ({ i, score: bulletSignalScore(b, i, bullets.length) }))
                .sort((a, b) => b.score - a.score || a.i - b.i)
                .slice(0, maxBulletsPerOlderRole)
                .map((x) => x.i),
        );
        const kept = bullets.filter((_, i) => keepIndices.has(i));
        removedCount += bullets.length - kept.length;
        const marker = detectMarker(exp.description ?? "");
        return {
            ...exp,
            description: kept.map((b) => `${marker}${b}`).join("\n"),
        };
    });

    return {
        data: {
            ...data,
            experience: nextExperience,
        },
        removedCount,
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
