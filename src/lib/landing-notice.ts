/**
 * The one-line result of an emailed confirmation link, shown on the page the
 * link lands on. The verify routes (search alerts, email follows, account
 * email) redirect with a flag and no detail, so this is the only place the
 * visitor learns whether the click worked.
 *
 * Every failure reads the same way on purpose: the routes never say WHY a
 * token failed (expired, used, tampered), so the copy doesn't either.
 */

export type LandingNotice = {
    /** The query param that carried it, stripped from the URL once shown. */
    param: string;
    tone: "success" | "error";
    text: string;
};

/** The page a verify route lands on. Company pages read `followed=1` themselves (use-company-email-verified.ts), so they aren't one. */
export type LandingSurface = "jobs" | "settings";

type NoticeCopy = { param: string; ok: string; failed: string; surface: LandingSurface };

const NOTICES: NoticeCopy[] = [
    {
        param: "search_alert",
        surface: "jobs",
        ok: "Search alert confirmed. We'll email you new matches for this search each week.",
        failed: "That alert link has expired or was already used. Search again and choose Get alerts for a new one.",
    },
    {
        param: "followed",
        surface: "jobs",
        ok: "Email confirmed. You're following the company, and we'll email you when it posts or closes roles.",
        failed: "That follow link has expired or was already used. Open the company and choose Follow for a new one.",
    },
    {
        param: "email_confirmed",
        surface: "settings",
        ok: "Email confirmed and added to your account.",
        failed: "That confirmation link has expired or was already used. Add the email again for a new link.",
    },
];

/** Pure: the notice for a landing URL on `surface`, or null when it carries none. */
export function landingNoticeFor(surface: LandingSurface, params: URLSearchParams): LandingNotice | null {
    for (const n of NOTICES) {
        if (n.surface !== surface) continue;
        const value = params.get(n.param);
        if (value === "1") return { param: n.param, tone: "success", text: n.ok };
        if (value === "0") return { param: n.param, tone: "error", text: n.failed };
    }
    return null;
}

/** Pure: `search` without `param`, so a reload or a shared link doesn't repeat the notice. */
export function searchWithoutParam(search: string, param: string): string {
    const params = new URLSearchParams(search);
    params.delete(param);
    const rest = params.toString();
    return rest ? `?${rest}` : "";
}
