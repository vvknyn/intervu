/**
 * Cross-subdomain auth-cookie attributes — ported from interview-os
 * (subspace)'s src/lib/supabase/cookie-config.ts.
 *
 * In subspace, a session minted on www.thesubspace.io must also be valid on
 * jobs.thesubspace.io, so the Supabase auth cookie there is scoped to the
 * registrable parent domain `.thesubspace.io`, keyed off the actual request
 * host (not an env flag — see the source file for the incident that fix
 * addressed).
 *
 * intervu is a single-domain product (intervuhq.com; intervu.cc now only
 * 301s there) with no sibling subdomain that needs to share the auth
 * session, so there is nothing to key this decision off today. This
 * intentionally returns undefined unconditionally — callers fall back to
 * Supabase's default host-only cookies, which matches today's behavior. The
 * seam is kept (rather than deleted) so a future second intervu subdomain
 * can reactivate it the same way subspace did, without re-deriving the
 * mechanism. Flagged for review in the port report — it is currently inert.
 */
export type CrossDomainCookieOptions = {
    domain: string
    secure: true
    sameSite: 'lax'
}

/**
 * Returns cross-subdomain cookie attributes for `host`, or undefined to let
 * the caller fall back to host-only cookies. `host` may carry a :port
 * (stripped). Always undefined today — see file comment.
 */
export function crossDomainCookieOptions(
    host: string | null | undefined,
): CrossDomainCookieOptions | undefined {
    void host
    return undefined
}

/** Current browser hostname, or undefined during SSR / non-browser. */
export function browserHost(): string | undefined {
    return typeof window !== 'undefined' ? window.location.hostname : undefined
}
