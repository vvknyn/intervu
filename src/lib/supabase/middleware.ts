import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicSupabaseUrlAndKey } from '@/lib/supabase/public-env'
import { crossDomainCookieOptions } from '@/lib/supabase/cookie-config'
import { isAuthGatedProductPath } from '@/lib/auth/product-routes'

/**
 * Max time to wait for the per-request auth check before failing closed.
 * getUser() is normally <200ms; this only trips when the auth backend is
 * unreachable/saturated. Ported from interview-os (subspace)'s
 * lib/supabase/middleware.ts, which exists BECAUSE of a real incident
 * (2026-06-15: a Postgres pileup starved GoTrue and hung every request) —
 * carried over verbatim rather than re-derived, so intervu doesn't have to
 * relearn that lesson in production.
 */
export const AUTH_CHECK_TIMEOUT_MS = 2500

/**
 * Race supabase.auth.getUser() against a timeout so a slow/unreachable auth
 * backend can't hang every request. On timeout OR error we fail CLOSED —
 * return { user: null, timedOut: true } — so the caller's gate sends
 * protected paths to /login fast instead of hanging ~19s. Generic over the
 * user shape so no @supabase type import is needed; the late settle of the
 * losing promise is swallowed (.catch) to avoid unhandled rejections when
 * the timeout wins.
 */
export async function getUserWithTimeout<U>(
    client: { auth: { getUser: () => Promise<{ data: { user: U | null } }> } },
    timeoutMs: number,
): Promise<{ user: U | null; timedOut: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<{ user: U | null; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ user: null, timedOut: true }), timeoutMs)
    })
    const userPromise: Promise<{ user: U | null; timedOut: boolean }> = client.auth
        .getUser()
        .then((r) => ({ user: r?.data?.user ?? null, timedOut: false }))
        .catch(() => ({ user: null, timedOut: true }))
    try {
        return await Promise.race([userPromise, timeoutPromise])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

/**
 * Refreshes the Supabase auth session for `request` and gates intervu's
 * protected paths (product-routes.ts's AUTH_GATED_PRODUCT_PREFIXES —
 * /settings, /account). Replaces the old cookie-presence check in
 * src/middleware.ts, which only proved a cookie existed, not that GoTrue
 * still considered it valid.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
    let supabaseResponse = NextResponse.next({ request })

    const xsubCookie = crossDomainCookieOptions(request.headers.get('host'))
    const { url: supabaseUrl, key: supabaseAnonKey } = getPublicSupabaseUrlAndKey()

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                supabaseResponse = NextResponse.next({ request })
                cookiesToSet.forEach(({ name, value, options }) => {
                    const merged = xsubCookie ? { ...options, ...xsubCookie } : options
                    supabaseResponse.cookies.set(name, value, merged)
                })
            },
        },
    })

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to
    // debug issues with users being randomly logged out.
    const { user, timedOut } = await getUserWithTimeout(supabase, AUTH_CHECK_TIMEOUT_MS)
    if (timedOut) {
        console.warn('[middleware] auth getUser timed out/failed — failing closed (guest)')
    }

    if (!user) {
        const path = request.nextUrl.pathname
        if (isAuthGatedProductPath(path)) {
            const url = request.nextUrl.clone()
            url.pathname = '/login'
            url.search = ''
            url.searchParams.set('next', `${path}${request.nextUrl.search}`)
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}
