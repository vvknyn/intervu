/**
 * The signed-out front door rendered on the server (`/jobs` with no search).
 *
 * /jobs is a static page whose content mounts in the browser, and its front
 * door waits for sign-in state as well: a signed-out visitor saw only the
 * header until the page's code had run, asked the server who is signed in
 * (/api/auth/session) and heard back. Only then did the masthead and the
 * résumé band paint, and the band is the largest thing on a phone's first
 * screen. On a 4x-throttled phone profile that put Largest Contentful Paint
 * at 6.2-6.5 s in Lighthouse (an outside scan of velai.app measured 5.0 s).
 *
 * The middleware has already read the session for this request, so a
 * signed-out document load of the bare page is rewritten to
 * `FRONT_DOOR_PATH`, a dynamic copy of /jobs that renders the front door on
 * the server with sign-in state settled as signed out. The browser hydrates
 * it and checks the session as before. Signed-in visitors (whose /jobs can
 * be For you), searches (`?q=`, served by server-first-rows.ts on phones),
 * and in-app navigations and prefetches keep the prerendered page.
 * Crawlers get it too: it is the same page, with its words in the HTML.
 *
 * Edge-safe and import-free: the middleware imports this.
 */

/** The dynamic page a qualifying request is rewritten to. Not a job slug (no id). */
export const FRONT_DOOR_PATH = "/jobs/front-door";

/**
 * Query keys that only say where a visit came from. Nothing on /jobs reads
 * them, so a link carrying them still lands on the front door.
 */
const CAMPAIGN_PARAM = /^(utm_[a-z0-9_]+|ref|gclid|gbraid|wbraid|fbclid|msclkid|ttclid|twclid|li_fat_id|mc_cid|mc_eid)$/i;

export interface FrontDoorRequest {
    method: string;
    pathname: string;
    searchParams: URLSearchParams;
    headers: Headers;
    signedIn: boolean;
}

/** Whether this request gets the server-rendered signed-out front door. */
export function shouldServeFrontDoor(req: FrontDoorRequest): boolean {
    if (req.method !== "GET" || req.pathname !== "/jobs" || req.signedIn) return false;
    const h = req.headers;
    // A document load only. Client navigations, prefetches and server
    // actions carry these and keep the prerendered page.
    if (h.has("rsc") || h.has("next-router-prefetch") || h.has("next-action")) return false;
    const dest = h.get("sec-fetch-dest");
    if (dest && dest !== "document") return false;
    // At rest: nothing in the address asks for a search, a job, a view or a filter.
    for (const key of req.searchParams.keys()) {
        if (!CAMPAIGN_PARAM.test(key)) return false;
    }
    return true;
}
