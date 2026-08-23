import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { getPublicSupabaseUrlAndKey, getSupabaseProjectUrl } from '@/lib/supabase/public-env'
import { crossDomainCookieOptions } from '@/lib/supabase/cookie-config'

export async function createClient() {
    const cookieStore = await cookies()
    // Host-based cross-subdomain cookie attrs — single source of truth in
    // ./cookie-config, consistent with the browser client. Currently a
    // no-op for intervu (single-domain product); see cookie-config.ts.
    const xsubCookie = crossDomainCookieOptions((await headers()).get('host'))
    const { url, key } = getPublicSupabaseUrlAndKey()

    return createServerClient(
        url,
        key,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            const merged = xsubCookie
                                ? { ...options, ...xsubCookie }
                                : options
                            cookieStore.set(name, value, merged)
                        })
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    )
}

export async function createAdminClient() {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!key) {
        throw new Error(
            'SUPABASE_SERVICE_ROLE_KEY is required (run `supabase status -o env` for local keys)',
        )
    }
    // interview-os (subspace) wraps this in a table-routing fetch
    // (@/lib/db-router's createRoutingFetch) that can redirect PostgREST
    // calls to a self-hosted Postgres box per table. intervu has no such
    // box — Supabase here is auth-only, its Postgres never holds intervu's
    // application data (that stays in Firestore) — so there is nothing to
    // route to and this intentionally uses the plain default fetch.
    return createSupabaseClient(getSupabaseProjectUrl(), key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
}
