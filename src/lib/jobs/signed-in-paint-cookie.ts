/**
 * First-paint hint for exact `/jobs`. The WorkOS session cookie is httpOnly,
 * so the blocking head script cannot see it. This cookie is not a credential:
 * it only tells that script to skip the Step 1 poster. Middleware stamps it
 * from `session.user` and clears it when the session is gone.
 *
 * GET only. A Set-Cookie on a server-action POST makes Next report
 * `x-action-revalidated` and refresh the route (same constraint as
 * `sb_jobs_visitor`).
 */
export const JOBS_SIGNED_IN_PAINT_COOKIE = "velai_jobs_signed_in";
export const JOBS_SIGNED_IN_PAINT_COOKIE_VALUE = "1";
export const JOBS_SIGNED_IN_PAINT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function shouldTouchJobsSignedInPaintCookie(input: {
    method: string;
    pathname: string;
}): boolean {
    return input.method === "GET" && input.pathname === "/jobs";
}

/** True only for an exact `name=1` pair. A lookalike suffix must not match. */
export function cookieHeaderHasJobsSignedInPaintHint(cookieHeader: string): boolean {
    const prefix = `${JOBS_SIGNED_IN_PAINT_COOKIE}=`;
    return cookieHeader.split(";").some((part) => {
        const trimmed = part.trim();
        return trimmed.startsWith(prefix) && trimmed.slice(prefix.length) === JOBS_SIGNED_IN_PAINT_COOKIE_VALUE;
    });
}
