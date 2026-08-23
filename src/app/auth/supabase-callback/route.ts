import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase OAuth code-exchange callback — ported from interview-os
// (subspace)'s src/app/auth/callback/route.ts.
//
// PATH DEVIATION FROM THE PORT SPEC: the source lives at
// src/app/auth/callback/route.ts, but that exact path already exists in
// intervu today as a Firebase-era stub (kept only so old links don't 404 —
// see that file). Overwriting it would violate this phase's "purely
// additive, nothing wired in, app still authenticates exactly as it does
// today" constraint, so this port lives at a sibling path instead. Whoever
// does the real cutover should point Supabase's OAuth redirect URI at
// /auth/supabase-callback (or retire the old stub and move this file over
// it, deliberately, in that phase).
//
// Also stripped from the source: the post-exchange "does a `profiles` row
// exist, else redirect to /onboarding" check. That's a subspace-only table
// and a subspace-only redirect target — intervu has neither today.
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? '/'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host')
            const isLocalEnv = process.env.NODE_ENV === 'development'
            if (isLocalEnv) {
                return NextResponse.redirect(`${origin}${next}`)
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${next}`)
            } else {
                return NextResponse.redirect(`${origin}${next}`)
            }
        }
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
