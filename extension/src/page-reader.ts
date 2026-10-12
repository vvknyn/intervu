/**
 * Reading the job off the page the person clicked the Velai button on.
 *
 * `readJobPage` is injected into that one tab (`activeTab` + `scripting`, on
 * the click only) and runs there, so it must stay self-contained: no imports,
 * no outer variables. It returns the page's schema.org JobPosting when the
 * page publishes one (most careers sites and job boards do, for Google Jobs),
 * plus the title, URL and a capped slice of the page's text as a fallback.
 *
 * `jobFromPage` turns that into the job shape Velai's fit score and résumé
 * tailor take, using only what the page states; anything it doesn't state is
 * left unknown rather than guessed.
 */
import type { PublicJob } from "@/lib/jobs/types";
import { resumeCountriesFromLocation } from "@/lib/jobs/resume-location";
import { ISO3_COUNTRY } from "@/lib/geo/iso3-countries";
import { queryFromPage } from "./page-query";

/** Page text past this is not needed to score or tailor against. */
export const PAGE_TEXT_CAP = 20_000;

export interface JobPostingLd {
    title?: unknown;
    description?: unknown;
    datePosted?: unknown;
    validThrough?: unknown;
    employmentType?: unknown;
    hiringOrganization?: unknown;
    jobLocation?: unknown;
    jobLocationType?: unknown;
    applicantLocationRequirements?: unknown;
    baseSalary?: unknown;
}

export interface PageRead {
    url: string;
    title: string;
    posting: JobPostingLd | null;
    text: string;
    /** The page's main heading (its first visible h1), for pages that publish no JobPosting. */
    heading?: string;
    /** Whether the page has an "Apply" button or link. */
    applyControl?: boolean;
}

/** Runs in the page. Self-contained on purpose (see the file comment). */
export function readJobPage(): PageRead {
    const isPosting = (node: unknown): boolean => {
        if (!node || typeof node !== "object") return false;
        const type = (node as { "@type"?: unknown })["@type"];
        return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
    };
    const findPosting = (node: unknown): unknown => {
        if (!node || typeof node !== "object") return null;
        if (isPosting(node)) return node;
        const list = Array.isArray(node) ? node : (node as { "@graph"?: unknown })["@graph"];
        if (Array.isArray(list)) {
            for (const item of list) {
                const found = findPosting(item);
                if (found) return found;
            }
        }
        return null;
    };
    let posting: unknown = null;
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
        try {
            posting = findPosting(JSON.parse(script.textContent ?? ""));
        } catch {
            posting = null;
        }
        if (posting) break;
    }
    const main = document.querySelector("main, article, [role=main]") ?? document.body;
    const text = (main as HTMLElement | null)?.innerText ?? "";
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || (el as HTMLElement).getClientRects().length > 0;
    const h1 = Array.from(document.querySelectorAll("h1")).find((el) => visible(el) && (el as HTMLElement).innerText.trim());
    // An apply control: a short button or link whose words say apply ("Apply now", "Apply for this job", "Easy Apply").
    const applyControl = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')).some((el) => {
        const label = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim();
        return label.length > 0 && label.length <= 40 && /\bapply\b/i.test(label) && visible(el);
    });
    return {
        url: location.href,
        title: document.title,
        posting: posting as PageRead["posting"],
        text: text.slice(0, 20_000), // PAGE_TEXT_CAP, written out: this runs in the page
        heading: ((h1 as HTMLElement | undefined)?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        applyControl,
    };
}

function str(value: unknown): string | null {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number") return String(value);
    return null;
}

function first(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
}

/** Plain text from a JobPosting description, which is usually HTML. */
export function htmlToText(html: string): string {
    return html
        .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n")
        .trim();
}

function orgName(org: unknown): string | null {
    const one = first(org);
    if (typeof one === "string") return str(one);
    if (one && typeof one === "object") return str((one as { name?: unknown }).name);
    return null;
}

interface Place {
    city: string | null;
    region: string | null;
    country: string | null;
}

function placeOf(jobLocation: unknown): Place {
    const loc = first(jobLocation);
    const address = loc && typeof loc === "object" ? (loc as { address?: unknown }).address : null;
    const a = (address && typeof address === "object" ? address : {}) as Record<string, unknown>;
    const country = a.addressCountry;
    return {
        city: str(a.addressLocality),
        region: str(a.addressRegion),
        country: str(country && typeof country === "object" ? (country as { name?: unknown }).name : country),
    };
}

interface Pay {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: string | null;
}

function payOf(baseSalary: unknown): Pay {
    const none = { min: null, max: null, currency: null, period: null };
    if (!baseSalary || typeof baseSalary !== "object") return none;
    const salary = baseSalary as { currency?: unknown; value?: unknown };
    const value = (salary.value && typeof salary.value === "object" ? salary.value : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
    const min = num(value.minValue) ?? num(value.value);
    const max = num(value.maxValue) ?? num(value.value);
    if (min == null && max == null) return none;
    const unit = str(value.unitText)?.toLowerCase() ?? null;
    return { min, max, currency: str(salary.currency), period: unit };
}

/** schema.org employmentType values as Velai's `employment_type`. */
function employmentOf(value: unknown): string {
    const raw = (str(first(value)) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
    if (["full_time", "part_time", "contract", "temporary", "internship"].includes(raw)) return raw;
    if (raw === "contractor") return "contract";
    if (raw === "intern") return "internship";
    return "";
}

/** Words a job description uses and other pages rarely put together with an Apply button and a heading. */
const JOB_TEXT = /\b(responsibilities|qualifications|requirements|what you('|’)ll do|about the role|about the job|job description|job details|who you are|what we('|’)re looking for|what you bring|you will)\b/i;

/**
 * Pure: whether a page that publishes no JobPosting still reads as one job:
 * a main heading, an Apply button or link, and the words of a job
 * description. Lets the card and panel work on careers sites that don't
 * publish structured job details.
 */
export function looksLikeJob(read: PageRead): boolean {
    if (read.posting) return true;
    return Boolean(read.heading) && read.applyControl === true && JOB_TEXT.test(read.text);
}

/** A comma piece that names a country or a region: "CAN", "Canada", "BC", "Ontario", "TX". */
function namesCountry(piece: string): boolean {
    const raw = piece.trim();
    return Boolean(ISO3_COUNTRY[raw]) || resumeCountriesFromLocation(raw).length > 0;
}

/**
 * Pure: the place a job title or heading states, for pages that publish no
 * location: "Senior TAM - Vancouver, CAN , AWS Enterprise Support" →
 * "Vancouver, CAN"; "Nurse | Toronto, ON" → "Toronto, ON". A segment counts
 * when it starts with a place name and a later comma piece names a country
 * or region; the pieces after that (a team, a department) are left out.
 * `null` when the text names no place this way.
 */
export function placeFromTitle(text: string): string | null {
    for (const segment of text.split(/\s+[|–—·•:-]\s+|\s*\|\s*/)) {
        const pieces = segment.split(",").map((piece) => piece.trim());
        if (pieces.length < 2 || !/^[A-Z][\p{L} .'-]{1,40}$/u.test(pieces[0])) continue;
        const last = pieces.findIndex((piece, i) => i > 0 && namesCountry(piece));
        if (last > 0) return pieces.slice(0, last + 1).join(", ");
    }
    return null;
}

/**
 * Pure: the page's job as the shape Velai scores and tailors against. Fields
 * the page doesn't state stay unknown (`""` / `null`), the same way an
 * unparsed field reads on a Velai job; nothing is filled in by guessing.
 */
export function jobFromPage(read: PageRead): PublicJob {
    const posting = read.posting ?? {};
    const fromTitle = queryFromPage(read.title, read.url).role;
    const title = str(posting.title) ?? (fromTitle || read.title.trim());
    const description = str(posting.description) ? htmlToText(str(posting.description)!) : read.text.trim() || null;
    const place = placeOf(posting.jobLocation);
    const pay = payOf(posting.baseSalary);
    const remote = str(posting.jobLocationType)?.toUpperCase() === "TELECOMMUTE";
    const locationParts = [place.city, place.region, place.country].filter(Boolean);
    // No stated location: the place the heading or title names, when it names one.
    if (!locationParts.length) {
        const named = placeFromTitle(read.heading || "") ?? placeFromTitle(read.title);
        if (named) locationParts.push(named);
    }
    const posted = str(posting.datePosted);
    return {
        id: `page:${read.url}`,
        title,
        company: orgName(posting.hiringOrganization),
        company_domain: null,
        location: locationParts.length ? locationParts.join(", ") : null,
        location_city: place.city,
        location_state: place.region,
        location_country: place.country,
        work_type: remote ? "remote" : "",
        description,
        employment_type: employmentOf(posting.employmentType),
        experience_level: "",
        salary_min: pay.min,
        salary_max: pay.max,
        salary_currency: pay.currency,
        salary_period: pay.period,
        visa_sponsorship: null,
        tags: [],
        apply_url: read.url,
        source: "page",
        posted_at: posted,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "",
        ghost_badge: "unscored",
    };
}

/** The page's own "apply by" date when it states one, for the job checks. */
export function validThrough(read: PageRead): string | null {
    return str(read.posting?.validThrough);
}

/** A URL without its query, hash, `www.` or trailing slash, for "is this the same posting". */
export function postingKey(url: string): string | null {
    try {
        const u = new URL(url);
        return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
        return null;
    }
}
