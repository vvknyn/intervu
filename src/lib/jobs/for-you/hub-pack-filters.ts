/**
 * Client-side pack membership for hub count pills.
 * Filters scored fit-probe hits into each DEFAULT_CATEGORY_HUBS pack.
 * Honest predicates only — never invent membership.
 */
import type { PublicJob } from "@/lib/jobs/types";

export const HUB_PACK_IDS = [
    "all",
    "ai",
    "remote",
    "fresh",
    "salary",
    "apply",
    "lead",
    "good",
] as const;

export type HubPackId = (typeof HUB_PACK_IDS)[number];

/** Short labels for removal cues (Swiss/Klein, pack identity). */
export const HUB_PACK_SHORT_LABELS: Record<HubPackId, string> = {
    all: "All your matches",
    ai: "Artificial intelligence",
    remote: "Fully remote",
    fresh: "Added this week",
    salary: "Jobs with salaries",
    apply: "1-Click tailored apply",
    lead: "Lead & principal",
    good: "Tech for good",
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
        default:
            return false;
    }
}
