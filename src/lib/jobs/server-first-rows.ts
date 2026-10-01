/**
 * First rows rendered on the server for a phone opening a search link
 * (`/jobs?q=nurse`).
 *
 * /jobs is a static page whose list mounts in the browser, so a search link
 * shows rows only once the page's code has run and its search has come back:
 * about 2.7 s on a 4x-throttled phone profile, most of it running code. For
 * that one case the middleware rewrites the document request to
 * `FIRST_ROWS_PATH`, a dynamic copy of the page that runs the same first
 * search on the server and renders the list with its rows; the browser then
 * hydrates it and takes that result instead of searching again
 * (early-first-search.ts). Everything else keeps the static page: desktops
 * (the board's split layout depends on the viewport, which the server can't
 * see, and they already show rows in ~0.5 s), signed-in visitors, crawlers,
 * and in-app navigations and prefetches, which go on using the prerendered
 * page.
 *
 * Edge-safe and import-free: the middleware imports this.
 */

/** The dynamic page a qualifying request is rewritten to. Not a job slug (no id). */
export const FIRST_ROWS_PATH = "/jobs/first-rows";

/** Longest the server waits for the search before sending the page without rows. */
export const FIRST_ROWS_SEARCH_BUDGET_MS = 1_000;

const PHONE_UA = /Mobi|iPhone|iPod|Android.*Mobile/i;

/** A phone, by its client hint or user agent. Tablets don't count: they get the wide layout. */
export function isPhoneRequest(headers: Headers): boolean {
    return headers.get("sec-ch-ua-mobile") === "?1" || PHONE_UA.test(headers.get("user-agent") ?? "");
}

export interface FirstRowsRequest {
    method: string;
    pathname: string;
    searchParams: URLSearchParams;
    headers: Headers;
    signedIn: boolean;
    isBot: boolean;
}

/** Whether this request gets the server-rendered first rows. */
export function shouldServeFirstRows(req: FirstRowsRequest): boolean {
    if (req.method !== "GET" || req.pathname !== "/jobs" || req.signedIn || req.isBot) return false;
    const h = req.headers;
    // A document load only. Client navigations, prefetches and server
    // actions carry these and keep the prerendered page.
    if (h.has("rsc") || h.has("next-router-prefetch") || h.has("next-action")) return false;
    const dest = h.get("sec-fetch-dest");
    if (dest && dest !== "document") return false;
    // A typed search landing; a shared job link opens that job first.
    if (!req.searchParams.get("q")?.trim() || req.searchParams.has("job")) return false;
    return isPhoneRequest(h);
}

/**
 * Whether the visitor's browser writes numbers the way the server does.
 * The board prints counts with `toLocaleString()`, so a server render for a
 * browser that formats them differently ("1.234" against "1,234") would not
 * match its own hydration; such visitors get the page without rows.
 */
export function formatsNumbersLikeServer(acceptLanguage: string | null): boolean {
    const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();
    if (!first || first === "*") return false;
    const sample = 1234567.5;
    try {
        return new Intl.NumberFormat(first).format(sample) === sample.toLocaleString();
    } catch {
        return false;
    }
}

/** A search answer worth rendering: real rows, not an outage, a rate limit or a gate. */
export function isUsableFirstRows(result: { hits: unknown[]; unavailable?: boolean; meta?: { gated?: boolean } } | null): boolean {
    return !!result && !result.unavailable && !result.meta?.gated && result.hits.length > 0;
}
