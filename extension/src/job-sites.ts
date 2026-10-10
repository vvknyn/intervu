/**
 * Where the Velai card shows on its own: the job boards and applicant-
 * tracking sites in job-sites.json (build.mjs writes them into the manifest's
 * content_scripts), plus any site the person turned it on for (an optional
 * host permission, granted one site at a time).
 */
import sites from "../job-sites.json";

export const JOB_SITE_MATCHES: readonly string[] = sites.matches;

/** Pure: whether `url` falls under a Chrome match pattern such as
 *  "https://*.indeed.com/*" (scheme, host with an optional "*." prefix, path glob). */
export function matchesPattern(url: string, pattern: string): boolean {
    const m = /^(https?|\*):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/.exec(pattern);
    if (!m) return false;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    const [, scheme, host, path] = m;
    if (scheme !== "*" && u.protocol !== `${scheme}:`) return false;
    const hostname = u.hostname.toLowerCase();
    if (host !== "*") {
        if (host.startsWith("*.")) {
            const base = host.slice(2).toLowerCase();
            if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
        } else if (hostname !== host.toLowerCase()) {
            return false;
        }
    }
    const glob = new RegExp(`^${path.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return glob.test(`${u.pathname}${u.search}`);
}

/** Pure: whether the card already shows on its own at `url` (the built-in job sites). */
export function isKnownJobSite(url: string): boolean {
    return JOB_SITE_MATCHES.some((pattern) => matchesPattern(url, pattern));
}

/** The optional-permission pattern that turns the card on for one site: "https://careers.acme.com/*". */
export function sitePattern(url: string): string | null {
    try {
        const u = new URL(url);
        return u.protocol === "https:" ? `https://${u.hostname}/*` : null;
    } catch {
        return null;
    }
}
