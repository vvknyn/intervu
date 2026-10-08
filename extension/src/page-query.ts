/**
 * The search a job page asks for, read from the tab the person clicked the
 * Velai button on: the role (and the company, when the title carries it), with
 * the site's own name and boilerplate dropped.
 *
 * Only the tab's title and host are read, and only for the tab the person
 * clicked on (`activeTab`). The side panel shows the result in an editable
 * box, so a title this reads imperfectly costs one edit, never a silent wrong
 * search.
 */

export interface PageQuery {
    /** What to search Velai for; empty when nothing usable was in the title. */
    q: string;
    /** The first part of that search, which is the role when the title names one. */
    role: string;
    /** The second part, often the employer ("Acme" in "Engineer | Acme"); "" when there's none. */
    paired: string;
    /** The page's host without `www.`, shown as where the search came from. */
    site: string | null;
}

/** Session-storage key the service worker hands the search to the panel under. */
export const PAGE_QUERY_KEY = "pageQuery";

/** Longest query we send; a page title past this is not a job title. */
export const MAX_QUERY_CHARS = 100;

/** Segments that name a job site or a page type, never the role or employer. */
const SITE_SEGMENT =
    /^(linkedin|indeed|glassdoor|ziprecruiter|monster|wellfound|otta|welcome to the jungle|greenhouse|lever|ashby|workday|workable|smartrecruiters|bamboohr|jobvite|icims|careers?|jobs?|job board|job details?|job description|apply|home)$/i;

/** A segment that is a domain, such as "Indeed.com". */
const DOMAIN_SEGMENT = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** "Toronto, ON", "Austin, TX, United States" and bare remote/country tags. */
const PLACE_SEGMENT = /^([A-Z][\w .'-]*,\s*[A-Z]{2}\b.*|remote|hybrid|on-?site|united states|canada|united kingdom)$/i;

/** Glassdoor: "Acme hiring Senior Engineer Job in Toronto, ON". */
const HIRING_TITLE = /^(.+?)\s+hiring\s+(.+?)(?:\s+job)?(?:\s+in\s+.+)?$/i;

/** Lead-ins ATS pages put before the role. */
const LEAD_IN = /^(job application for|application for|apply(?: now)? for|careers at|jobs at|job:)\s+/i;

/** Separators between title segments. */
const SEPARATOR = /\s+[|–—·•:]\s+|\s*\|\s*|\s+@\s+|\s+at\s+/i;

/** A spaced hyphen: a separator ("Nurse - Indeed.com") or part of the role
 *  ("Registered Nurse - ICU"), so it splits only a title with no other separator. */
const HYPHEN = /\s+-\s+/;

export function hostOf(url: string): string | null {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host ? host.replace(/^www\./, "") : null;
    } catch {
        return null;
    }
}

function cleanSegment(segment: string): string {
    return segment
        .replace(/\s+(careers|jobs)$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function keepSegment(segment: string): boolean {
    if (!segment) return false;
    if (SITE_SEGMENT.test(segment)) return false;
    if (DOMAIN_SEGMENT.test(segment)) return false;
    if (PLACE_SEGMENT.test(segment)) return false;
    return true;
}

/** Pure: the Velai search for a tab with this title and URL. */
export function queryFromPage(title: string, url: string): PageQuery {
    const site = hostOf(url);
    let text = title.replace(/^\(\d+\+?\)\s*/, "").replace(LEAD_IN, "").trim();

    const hiring = HIRING_TITLE.exec(text);
    if (hiring && !SEPARATOR.test(hiring[1])) {
        text = `${hiring[2]} | ${hiring[1]}`;
    }

    // Each segment keeps its hyphenated parts, minus any that name the site or a place.
    let kept = text
        .split(SEPARATOR)
        .map((segment) => segment.split(HYPHEN).map(cleanSegment).filter(keepSegment).join(" - "))
        .filter(Boolean);
    if (kept.length === 1) kept = kept[0].split(HYPHEN);
    kept = kept.slice(0, 2);
    const q = kept.join(" ").replace(/\s+-\s+/g, " ").slice(0, MAX_QUERY_CHARS).trim();
    return { q, role: (kept[0] ?? "").slice(0, MAX_QUERY_CHARS).trim(), paired: (kept[1] ?? "").slice(0, MAX_QUERY_CHARS).trim(), site };
}

/** Pure: the Velai search for text the person selected on a page. */
export function queryFromSelection(selection: string, url: string): PageQuery {
    const q = selection.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS).trim();
    return { q, role: q, paired: "", site: hostOf(url) };
}
