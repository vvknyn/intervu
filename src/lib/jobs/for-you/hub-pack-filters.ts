/**
 * Client-side pack membership for hub count pills.
 * Filters scored fit-probe hits into each pack tile.
 * Honest predicates only — never invent membership.
 *
 * `BROWSE_HUB_PACK_IDS` are the tiles a visitor without a résumé sees
 * (`DEFAULT_CATEGORY_HUBS`), counted across the corpus (hub-pack-corpus.ts).
 * A résumé visitor sees the tiles of their profession's industry
 * (`industry-tiles.ts`); the industry tiles below are row tiles, each a
 * predicate over the fields a search hit carries (title, company, work and
 * employment type), so a tile's count and the list it opens always agree.
 */
import type { PublicJob } from "@/lib/jobs/types";

export const BROWSE_HUB_PACK_IDS = [
    "all",
    "ai",
    "remote",
    "fresh",
    "salary",
    "apply",
    "lead",
    "good",
] as const;

export type BrowseHubPackId = (typeof BROWSE_HUB_PACK_IDS)[number];

/** Row tiles that only an industry's résumé visitors see. */
export const INDUSTRY_HUB_PACK_IDS = [
    "part_time",
    "contract",
    "senior_lead",
    "health_lead",
    "health_part_time",
    "health_research",
    "health_community",
    "health_remote",
    "health_new_grad",
    "edu_k12",
    "edu_higher",
    "edu_special",
    "edu_lead",
    "edu_part_time",
    "edu_online",
    "biz_enterprise",
    "biz_lead",
    "biz_partnerships",
    "fin_accounting",
    "fin_fpa",
    "fin_banking",
    "fin_lead",
    "office_hr",
    "office_exec",
    "office_health",
    "trades_apprentice",
    "trades_licensed",
    "trades_lead",
    "trades_construction",
    "trades_maintenance",
    "trades_manufacturing",
    "log_cdl",
    "log_local",
    "log_warehouse",
    "log_lead",
    "service_lead",
    "service_food",
    "service_retail",
    "service_support",
] as const;

export type IndustryHubPackId = (typeof INDUSTRY_HUB_PACK_IDS)[number];

export const HUB_PACK_IDS = [...BROWSE_HUB_PACK_IDS, ...INDUSTRY_HUB_PACK_IDS] as const;

export type HubPackId = (typeof HUB_PACK_IDS)[number];

/** Short labels for removal cues (Swiss/Klein, pack identity). */
export const HUB_PACK_SHORT_LABELS: Record<HubPackId, string> = {
    all: "All your matches",
    ai: "Artificial intelligence",
    remote: "Fully remote",
    fresh: "Added this week",
    salary: "Pay listed",
    apply: "1-Click tailored apply",
    lead: "Lead & principal",
    good: "Tech for good",
    part_time: "Part-time",
    contract: "Contract & temporary",
    senior_lead: "Senior & lead",
    health_lead: "Leadership & charge roles",
    health_part_time: "Part-time & per diem",
    health_research: "Research & labs",
    health_community: "Community & public health",
    health_remote: "Remote & telehealth",
    health_new_grad: "New grad & residency",
    edu_k12: "Schools & K–12",
    edu_higher: "Colleges & universities",
    edu_special: "Special education & support",
    edu_lead: "Leadership & administration",
    edu_part_time: "Part-time & substitute",
    edu_online: "Online & tutoring",
    biz_enterprise: "Enterprise & strategic",
    biz_lead: "Director & VP",
    biz_partnerships: "Partnerships & channel",
    fin_accounting: "Accounting & audit",
    fin_fpa: "FP&A & analysis",
    fin_banking: "Banking & investments",
    fin_lead: "Manager & controller",
    office_hr: "HR & recruiting",
    office_exec: "Executive assistant",
    office_health: "Clinics & healthcare offices",
    trades_apprentice: "Apprenticeships",
    trades_licensed: "Licensed & journeyman",
    trades_lead: "Foreman & supervisor",
    trades_construction: "Construction",
    trades_maintenance: "Maintenance & facilities",
    trades_manufacturing: "Manufacturing & plant",
    log_cdl: "CDL & long haul",
    log_local: "Local delivery",
    log_warehouse: "Warehouse & forklift",
    log_lead: "Dispatch & supervisor",
    service_lead: "Shift lead & manager",
    service_food: "Restaurants & hotels",
    service_retail: "Retail stores",
    service_support: "Customer support",
};

const AI_RE =
    /\b(artificial intelligence|\bai\b|machine learning|\bml\b|deep learning|llm|large language|gen(?:erative)?\s*ai|neural|nlp|computer vision|transformer|pytorch|tensorflow)\b/i;

const LEAD_TITLE_RE =
    /\b(lead|principal|staff(?:\s+|$)|director|head of|vp\b|vice president|chief)\b/i;

const GOOD_RE =
    /\b(nonprofit|non-profit|not-for-profit|climate|sustainab|social impact|tech for good|civic|public interest|clean energy|renewable|education equity|healthcare access|conservation|humanitarian|mission[- ]driven)\b/i;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function haystack(job: PublicJob): string {
    const tags = (job.tags ?? []).join(" ");
    return `${job.title ?? ""} ${tags} ${job.occupation ?? ""} ${job.company ?? ""}`;
}

export function isRemoteJob(job: PublicJob): boolean {
    return /remote/i.test(job.work_type ?? "");
}

export function isFreshJob(job: PublicJob, nowMs = Date.now()): boolean {
    const ts = job.posted_ts;
    if (ts != null && Number.isFinite(ts)) {
        return nowMs - ts <= WEEK_MS && nowMs - ts >= 0;
    }
    if (job.posted_at) {
        const t = Date.parse(job.posted_at);
        if (Number.isFinite(t)) return nowMs - t <= WEEK_MS && nowMs - t >= 0;
    }
    return false;
}

export function hasListedSalary(job: PublicJob): boolean {
    return (
        (job.salary_min != null && Number.isFinite(job.salary_min)) ||
        (job.salary_max != null && Number.isFinite(job.salary_max)) ||
        (job.normalized_salary_min != null && Number.isFinite(job.normalized_salary_min)) ||
        (job.normalized_salary_max != null && Number.isFinite(job.normalized_salary_max))
    );
}

export function isTailorApplyJob(job: PublicJob): boolean {
    return Boolean(job.apply_url?.trim());
}

export function isAiJob(job: PublicJob): boolean {
    return AI_RE.test(haystack(job));
}

export function isLeadJob(job: PublicJob): boolean {
    if (LEAD_TITLE_RE.test(job.title ?? "")) return true;
    const level = (job.experience_level ?? "").toLowerCase();
    return level === "lead" || level === "principal" || level === "staff" || level === "director";
}

export function isTechForGoodJob(job: PublicJob): boolean {
    return GOOD_RE.test(haystack(job));
}

export function isPartTimeJob(job: PublicJob): boolean {
    return /part[_ -]?time/i.test(job.employment_type ?? "") || /\bpart[- ]time\b/i.test(job.title ?? "");
}

export function isContractJob(job: PublicJob): boolean {
    return (
        /contract|temporary|temp\b|seasonal/i.test(job.employment_type ?? "") ||
        /\b(contract|contractor|temporary|temp|interim|fixed[- ]term|seasonal|locum)\b/i.test(job.title ?? "")
    );
}

/**
 * One industry row tile: `title` matches the job title, `company` the
 * employer's name, and `also` any other field a hit carries. A job is in the
 * tile when any of them matches and `exclude` does not match its title.
 */
type IndustryRowTile = {
    title?: RegExp;
    company?: RegExp;
    exclude?: RegExp;
    also?: (job: PublicJob) => boolean;
};

const isRemote = (job: PublicJob) => isRemoteJob(job);

const INDUSTRY_ROW_TILES: Record<Exclude<IndustryHubPackId, "part_time" | "contract">, IndustryRowTile> = {
    senior_lead: { title: /\b(senior|sr\.?|lead|principal|manager|director|head of|supervisor|vp|vice president|chief)\b/i },

    // A case or care manager is a bedside/community nurse role, not a manager of people.
    health_lead: {
        title: /\b(charge|manager|management|director|supervisor|head of|chief|lead|leader|administrator|superintendent)\b/i,
        exclude: /\b(case|care) manag/i,
    },
    health_part_time: {
        title: /\b(part[- ]time|per[- ]diem|prn|casual|relief|float pool|weekend)\b/i,
        also: isPartTimeJob,
    },
    health_research: {
        title: /\b(research|laborator(?:y|ies)|lab|scientists?|clinical trials?|study (?:coordinator|nurse)|biobank)\b/i,
    },
    health_community: {
        title: /\b(public health|community|home (?:care|health)|homecare|outpatient|ambulatory|clinic|primary care|hospice|long[- ]term care|school)\b/i,
        company: /\b(public health|county|city of|region of|regional municipality|department of (?:public )?health|ministry of health|health unit|home (?:care|health)|hospice)\b/i,
    },
    health_remote: {
        title: /\b(telehealth|telemedicine|telephonic|virtual (?:care|nurse|clinic)|remote)\b/i,
        also: isRemote,
    },
    health_new_grad: {
        title: /\b(new grad(?:uate)?s?|graduate (?:nurse|pharmacist|practical nurse)|nurse residen\w*|residency|transition to practice|entry[- ]level|internship)\b/i,
    },

    edu_k12: {
        title: /\b(elementary|secondary|high school|middle school|primary school|k-?12|kindergarten|grade \d+)\b/i,
        company: /\b(school|schools|district|isd|usd|academy|board of education|catholic|charter)\b/i,
    },
    edu_higher: {
        title: /\b(professor|lecturer|faculty|adjunct|postdoc\w*|dean)\b/i,
        company: /\b(university|college|polytechnic|institute of technology)\b/i,
    },
    edu_special: {
        title: /\b(special (?:education|needs)|learning support|resource teacher|educational assistant|behaviou?r (?:technician|therapist)|autism|aba|inclusion)\b/i,
    },
    edu_lead: {
        title: /\b(principal|vice[- ]principal|head (?:of|teacher)|director|dean|department (?:head|chair)|superintendent|manager|chair)\b/i,
    },
    edu_part_time: {
        title: /\b(substitute|supply|occasional|part[- ]time|casual|on[- ]call)\b/i,
        also: isPartTimeJob,
    },
    edu_online: {
        title: /\b(online|virtual|remote|e-?learning|tutor\w*)\b/i,
        also: isRemote,
    },

    biz_enterprise: { title: /\b(enterprise|strategic|key accounts?|global accounts?|major accounts?|named accounts?)\b/i },
    biz_lead: { title: /\b(director|head of|vp|vice president|chief|cmo|cro|coo|senior manager|group manager)\b/i },
    biz_partnerships: { title: /\b(partners?|partnerships?|channel|alliances?|business development|ecosystem)\b/i },

    fin_accounting: {
        title: /\b(accountants?|accounting|accounts (?:payable|receivable)|bookkeep\w*|audit\w*|tax|payroll|controller|reconciliation|cpa)\b/i,
    },
    fin_fpa: {
        title: /\b(fp&a|financial (?:analyst|planning|analysis)|planning|forecast\w*|budget\w*|finance business partner|strategic finance)\b/i,
    },
    fin_banking: {
        title: /\b(bank(?:ing|er)?|capital markets|investments?|wealth|asset management|securities|lending|loans?|mortgage|trading|portfolio)\b/i,
        company: /\b(bank|banque|capital|credit union|securities|asset management|investments?|wealth|financial group)\b/i,
    },
    fin_lead: { title: /\b(controller|director|head of|vp|vice president|cfo|chief|manager)\b/i },

    office_hr: { title: /\b(hr|human resources|people|recruit\w*|talent|payroll|benefits|compensation)\b/i },
    office_exec: { title: /\b(executive assistant|chief of staff|personal assistant|executive coordinator|assistant to the)\b/i },
    office_health: {
        title: /\b(medical|health|healthcare|dental|clinic|hospital|patient)\b/i,
        company: /\b(medical|health|healthcare|dental|clinic|hospital)\b/i,
    },

    trades_apprentice: { title: /\b(apprentice\w*|pre-apprentice\w*|trainee|helper|entry[- ]level)\b/i },
    trades_licensed: { title: /\b(journeyman|journeyperson|licensed|master|red seal|certified|309a|ticketed)\b/i },
    trades_lead: { title: /\b(foreman|forewoman|foremen|supervisor|superintendent|lead|manager)\b/i },
    trades_construction: {
        title: /\b(construction|site|civil|residential|commercial)\b/i,
        company: /\b(construction|builders?|contractors?|contracting|homes)\b/i,
    },
    trades_maintenance: {
        title: /\b(maintenance|facilities|facility|building|property|service technician|field service|repair)\b/i,
    },
    trades_manufacturing: {
        title: /\b(manufactur\w*|production|plant|machinist|cnc|assembl\w*|fabricat\w*|factory|operator)\b/i,
        company: /\b(manufactur\w*|industries|fabrication)\b/i,
    },

    log_cdl: {
        title: /\b(cdl|class a|class 1|az|dz|long[- ]haul|otr|over the road|regional driver|truck driver|tractor[- ]trailer|semi)\b/i,
    },
    log_local: { title: /\b(delivery|courier|route|local|van driver|parcel|last[- ]mile|home daily)\b/i },
    log_warehouse: {
        title: /\b(warehouse|forklift|picker|packer|material handler|shipping|receiving|fulfil?lment|distribution|inventory|loader|order selector)\b/i,
    },
    log_lead: { title: /\b(supervisor|dispatch\w*|lead|manager|coordinator|planner|foreman)\b/i },

    service_lead: {
        title: /\b(lead|supervisor|keyholder|key holder|assistant manager|manager|team lead|captain|head)\b/i,
    },
    service_food: {
        title: /\b(restaurant|cafe|café|coffee|baristas?|servers?|waiter|waitress|bartenders?|cooks?|chefs?|kitchen|dishwasher|hosts?|hostess|food|catering|bakery|baker|hotel|hospitality|housekeep\w*|front desk|guest)\b/i,
    },
    service_retail: { title: /\b(retail|store|sales associate|cashiers?|merchandis\w*|stock|visual|beauty|boutique)\b/i },
    service_support: {
        title: /\b(customer service|customer support|call cent(?:er|re)|contact cent(?:er|re)|customer care|support (?:agent|representative|specialist)|client services|help ?desk)\b/i,
    },
};

function matchesIndustryRowTile(job: PublicJob, tile: IndustryRowTile): boolean {
    const title = job.title ?? "";
    if (tile.exclude?.test(title)) return false;
    if (tile.title?.test(title)) return true;
    if (tile.company?.test(job.company ?? "")) return true;
    return tile.also ? tile.also(job) : false;
}

/** True when `job` belongs in the named hub pack. */
export function jobMatchesHubPack(job: PublicJob, packId: HubPackId, nowMs = Date.now()): boolean {
    switch (packId) {
        case "all":
            return true;
        case "ai":
            return isAiJob(job);
        case "remote":
            return isRemoteJob(job);
        case "fresh":
            return isFreshJob(job, nowMs);
        case "salary":
            return hasListedSalary(job);
        case "apply":
            return isTailorApplyJob(job);
        case "lead":
            return isLeadJob(job);
        case "good":
            return isTechForGoodJob(job);
        case "part_time":
            return isPartTimeJob(job);
        case "contract":
            return isContractJob(job);
        default: {
            const tile = INDUSTRY_ROW_TILES[packId];
            return tile ? matchesIndustryRowTile(job, tile) : false;
        }
    }
}
