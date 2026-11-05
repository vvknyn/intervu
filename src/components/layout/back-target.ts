/**
 * Where a drill-down page's Back control goes on a phone (Apple HIG, Toolbars: "Use the standard Back
 * and Close buttons"). The phone top bar is the brand bar on every page; on a page one level below a
 * section it also carries a Back button to that section. Keyed on the first path segment, so every
 * page under a section gets it by construction (a new /yours/... page included); a section with no
 * page of its own (/research, /watch) has no entry and its pages show no Back.
 */
export interface BackTarget {
    href: string;
    /** The section's name, read out as "Back to <label>". */
    label: string;
}

const SECTION_PARENTS: Record<string, BackTarget> = {
    jobs: { href: "/jobs", label: "Jobs" },
    careers: { href: "/jobs", label: "Jobs" },
    blog: { href: "/blog", label: "Blog" },
    co: { href: "/co", label: "Companies" },
    companies: { href: "/co", label: "Companies" },
    connect: { href: "/connect", label: "Connect" },
    yours: { href: "/yours", label: "Tracker" },
};

/** The Back target for `pathname`, or null on a section's own page and on top-level pages. */
export function backTarget(pathname: string): BackTarget | null {
    const segments = pathname.split("?")[0].split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return SECTION_PARENTS[segments[0]] ?? null;
}

/** Set once the visitor has moved between pages inside the app this session; until then Back
 *  is a link to the section (a shared link opened cold has no app page behind it). */
let movedInsideApp = false;
let lastPathname: string | null = null;

/** Called by the top bar on every route change. */
export function notePathname(pathname: string): void {
    if (lastPathname !== null && lastPathname !== pathname) movedInsideApp = true;
    lastPathname = pathname;
}

/** True when Back should return to the previous screen, as iOS's Back does. */
export function canGoBackInApp(): boolean {
    return movedInsideApp && typeof window !== "undefined" && window.history.length > 1;
}
