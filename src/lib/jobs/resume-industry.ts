/**
 * Résumé → the industry of the candidate's profession, which picks the pack
 * tiles they see (`industry-tiles.ts`). A nurse and a product manager slice
 * their packs differently: "Part-time & per diem" means something to one,
 * "Artificial intelligence" to the other.
 *
 * It reads what the person does, not where they did it: a software engineer
 * at a hospital is tech, a nurse at a software company is health. Evidence,
 * strongest first: the headline they wrote, their current role, earlier
 * roles, degrees and skill-group names. Each phrase belongs to the first
 * industry whose words it uses (`PHRASE_RULES`, order matters); the industry
 * with the most weight wins, and too little evidence is "general".
 *
 * Pure: no React, no I/O. Must not import resume-match.ts, which imports this.
 */
import type { ResumeData } from "@/types/resume";

export const INDUSTRY_IDS = [
    "tech",
    "health",
    "education",
    "finance",
    "logistics",
    "trades",
    "service",
    "business",
    "office",
    "general",
] as const;

export type IndustryId = (typeof INDUSTRY_IDS)[number];

/**
 * One rule per industry, checked in this order; a phrase takes the first that
 * matches. Health professions named outright come before tech, so "Nurse
 * Informaticist" stays health, and tech before the rest, so "Software
 * Engineer, Logistics" stays tech. `null` claims a phrase for no industry
 * (engineering disciplines that aren't software), so the weak rules below
 * can't pull "Mechanical Engineer" into tech.
 */
const PHRASE_RULES: ReadonlyArray<readonly [IndustryId | null, RegExp]> = [
    [
        "health",
        /\b(nurs(?:e|es|ing)|rn|rpn|lpn|lvn|cna|np|midwi(?:fe|ves|fery)|physicians?|doctor|surgeon|md|psychiatr\w*|physiotherap\w*|physical therap\w*|occupational therap\w*|respiratory therap\w*|speech[- ]language|kinesiolog\w*|athletic therap\w*|chiropract\w*|massage therap\w*|pharmacists?|pharmacy|pharmd|phlebotom\w*|radiolog\w*|radiograph\w*|sonograph\w*|ultrasound|mri|paramedics?|emt|dental|dentists?|hygienists?|orthodont\w*|dietitians?|nutritionists?|optometr\w*|opticians?|audiolog\w*|epidemiolog\w*|biostatistic\w*|public health|health promot\w*|community health|clinical research|research coordinator|medical (?:laboratory|lab|technologist|assistant|office|receptionist|coder|coding|billing|scribe)|clinical laborator\w*|laboratory technologist|lab(?:oratory)? technician|caregivers?|care aide|personal support worker|psw|health care aide|patient care|veterinar\w*|vet tech|psychologists?|mental health|social workers?|therapists?)\b/i,
    ],
    [
        "tech",
        /\b(software|developers?|programmers?|devops|sre|site reliability|full[- ]?stack|front[- ]?end|back[- ]?end|web (?:developer|engineer)|mobile (?:developer|engineer)|ios|android|machine learning|ml engineer|ai engineer|data (?:scientist|engineer|analyst|architect)|analytics engineer|cloud (?:engineer|architect)|platform engineer|security engineer|cyber ?security|information security|it (?:support|specialist|manager|administrator|analyst|technician)|systems? (?:administrator|engineer|analyst)|network (?:engineer|administrator)|database|dba|qa engineer|quality assurance engineer|test (?:engineer|automation)|sdet|support engineer|product (?:manager|owner|designer|lead|director|management)|technical program manager|scrum master|ux|ui|user experience|interaction designer|engineering manager|cto|solutions architect|computer science|computer engineering|information technology|tech lead)\b/i,
    ],
    [
        null,
        /\b(civil|mechanical|structural|chemical|process|industrial|electrical|electronics|mining|petroleum|environmental|geotechnical|aerospace|biomedical|manufacturing) engineer/i,
    ],
    [
        "education",
        /\b(teach(?:er|ers|ing)|educators?|instructors?|professors?|lecturers?|faculty|tutors?|early childhood|ece|child ?care|daycare|kindergarten|preschool|librarians?|curriculum|(?:school |vice[- ]|assistant )principal|dean|registrar|academic (?:advisor|adviser|coordinator)|teaching assistant|educational assistant|special education|esl|tesol|b\.?ed|m\.?ed\.)\b/i,
    ],
    [
        "finance",
        /\b(accountants?|accounting|accounts (?:payable|receivable)|bookkeep\w*|auditors?|audit|tax|cpa|cga|cma|cfa|acca|controller|comptroller|financial (?:analyst|advisor|adviser|planner|planning|reporting)|finance|fp&a|treasury|actuar\w*|underwrit\w*|loan officer|mortgage|credit (?:analyst|officer)|investment|bankers?|banking|tellers?|wealth|portfolio manager|equity research|risk analyst|claims (?:adjuster|examiner)|insurance)\b/i,
    ],
    [
        "logistics",
        /\b(drivers?|cdl|truck(?:ing)?|delivery (?:driver|associate|person|courier)|local delivery|couriers?|dispatch(?:er)?|warehouse|forklift|pickers?|packers?|material handler|shipping|receiving|logistics|supply chain|inventory|fulfil?lment|distribution cent(?:er|re)|freight|fleet|transportation|bus operator|transit operator|chauffeur|movers?)\b/i,
    ],
    [
        "trades",
        /\b(electricians?|plumb(?:er|ers|ing)|pipefitters?|steamfitters?|welders?|welding|machinists?|carpent(?:er|ers|ry)|hvac|refrigeration|mechanics?|millwrights?|apprentice\w*|journeyman|journeyperson|red seal|construction|labou?rers?|foreman|forewoman|superintendent|painters?|roofers?|masons?|bricklayers?|drywall|concrete|heavy equipment|equipment operator|crane operator|cnc|fabricators?|assemblers?|production (?:worker|associate|operator|supervisor)|manufacturing|machine operator|maintenance|facilities|installers?|lineman|lineworker|landscap\w*|groundskeeper|technicians?)\b/i,
    ],
    [
        "service",
        /\b(retail|cashiers?|sales associate|store (?:manager|associate|supervisor)|shift (?:lead|manager|supervisor)|keyholder|baristas?|servers?|waiter|waitress|bartenders?|cooks?|chefs?|kitchen|dishwasher|hosts?|hostess|housekeep\w*|hotel|hospitality|front desk agent|guest services|concierge|customer service|call cent(?:er|re)|contact cent(?:er|re)|customer support|support (?:agent|representative|specialist)|customer care|restaurant|food service|merchandis\w*|stock (?:associate|clerk)|crew member|beauty advisor|stylists?)\b/i,
    ],
    [
        "business",
        /\b(sales|account (?:executive|manager|director)|business development|bdr|sdr|marketing|marketer|brand|growth|seo|sem|content (?:strategist|marketing|manager)|communications|public relations|social media|copywriter|customer success|client success|csm|technical account manag\w*|account management|implementation (?:manager|consultant|specialist)|solutions consultant|sales engineer|partnerships?|alliances|revenue operations|revops|go-to-market|gtm|operations (?:manager|director|lead)|business operations|business administration|program manager|project manager|consultants?|consulting|strategy|chief of staff|general manager|mba|bcom|commerce)\b/i,
    ],
    [
        "office",
        /\b(administrative|admin(?:istrative)? assistant|office (?:manager|administrator|assistant|coordinator|clerk)|receptionist|front desk|executive assistant|personal assistant|secretary|clerk|data entry|scheduler|human resources|hr|recruit(?:er|ers|ing|ment)|talent acquisition|people (?:operations|partner|ops)|payroll|legal assistant|paralegal|law clerk|records)\b/i,
    ],
    // Weak words: counted only when nothing above named the phrase.
    ["health", /\b(clinical|clinic|medical|medicine|patients?|hospital|health ?care|health sciences?|health|biology|biomedical|life sciences?)\b/i],
    ["tech", /\b(engineer|engineering|developer|technical|technology|computer)\b/i],
];

/** The industry a title, degree or skill-group name belongs to; null when it names none. */
export function phraseIndustry(phrase: string): IndustryId | null {
    const text = (phrase ?? "").trim();
    if (!text) return null;
    for (const [industry, rule] of PHRASE_RULES) {
        if (rule.test(text)) return industry;
    }
    return null;
}

/** Below this much evidence the résumé is "general": the headline alone is enough, one skill group is not. */
const MIN_INDUSTRY_WEIGHT = 2;

type Evidence = { phrase: string; weight: number };

function resumeEvidence(resume: ResumeData): Evidence[] {
    const out: Evidence[] = [];
    const headline = (resume?.profile?.profession ?? "").trim();
    if (headline) {
        headline.split(/\s*[|·/,]\s*/).filter(Boolean).forEach((part, index) => out.push({ phrase: part, weight: index === 0 ? 3 : 2 }));
    }
    for (const [index, entry] of (resume?.experience ?? []).slice(0, 3).entries()) {
        const role = (entry?.role ?? "").trim();
        if (role) out.push({ phrase: role, weight: index === 0 ? 3 : 1 });
    }
    for (const education of resume?.education ?? []) {
        const degree = (education?.degree ?? "").trim();
        if (degree) out.push({ phrase: degree, weight: 1 });
    }
    for (const group of (resume?.competencies ?? []).slice(0, 4)) {
        const category = (group?.category ?? "").trim();
        if (category) out.push({ phrase: category, weight: 1 });
    }
    return out;
}

/**
 * The industry of the candidate's profession. A tie goes to the industry
 * named first: the headline's, then the current role's.
 */
export function resumeIndustry(resume: ResumeData | null | undefined): IndustryId {
    if (!resume) return "general";
    const evidence = resumeEvidence(resume);
    const weights = new Map<IndustryId, number>();
    const firstSeen: IndustryId[] = [];
    for (const { phrase, weight } of evidence) {
        const industry = phraseIndustry(phrase);
        if (!industry) continue;
        if (!weights.has(industry)) firstSeen.push(industry);
        weights.set(industry, (weights.get(industry) ?? 0) + weight);
    }
    let best: IndustryId = "general";
    let bestWeight = 0;
    for (const industry of firstSeen) {
        const weight = weights.get(industry) ?? 0;
        if (weight > bestWeight) {
            best = industry;
            bestWeight = weight;
        }
    }
    return bestWeight >= MIN_INDUSTRY_WEIGHT ? best : "general";
}
