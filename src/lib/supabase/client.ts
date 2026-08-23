import { createBrowserClient } from '@supabase/ssr'
import { type SupabaseClient } from '@supabase/supabase-js'
import { getPublicSupabaseUrlAndKey } from '@/lib/supabase/public-env'
import { crossDomainCookieOptions, browserHost } from '@/lib/supabase/cookie-config'

let client: SupabaseClient | undefined

// Cross-subdomain auth cookie attributes — single source of truth in
// ./cookie-config, keyed off the real hostname. Currently a no-op for
// intervu (single-domain product); see cookie-config.ts.

// Why a custom no-op lock (ported verbatim from interview-os/subspace):
//
// @supabase/auth-js wraps EVERY auth call (getUser / getSession /
// signInWithPassword / refreshSession / the auto-refresh tick) in
// `_acquireLock(lockAcquireTimeout=10_000, …)`. In the browser, with
// persistSession + navigator.locks present (all modern browsers), it picks
// `navigatorLock`, which acquires `lock:sb-<ref>-auth-token` via the
// Navigator LockManager. If that lock isn't granted within 10s — e.g. a
// prior holder (on-mount _recoverAndRefresh / autoRefresh tick) stalls on a
// refresh fetch, or iOS Safari's WebKit Web Locks misbehaves under a
// registered Service Worker + ITP/storage-partitioning — auth-js calls
// `AbortController.abort()` with NO reason and `navigator.locks.request()`
// rejects with `DOMException('AbortError')`, whose WebKit default message is
// verbatim "The operation was aborted." That surfaced on subspace's /login
// as a 100% sign-in failure on iPhone Safari (prod-only: SW + cross-subdomain
// cookie path only exist in prod). Carried over here defensively even though
// intervu has no cross-subdomain cookie path today — the underlying
// single-browser-client + navigator.locks failure mode is not subspace-
// specific, it's a @supabase/ssr + Safari interaction.
//
// We run a single browser client (module singleton + @supabase/ssr's own
// cachedBrowserClient), so the only thing the lock buys us — cross-tab
// refresh-token serialization — is moot here, and Supabase's refresh-token
// reuse grace window already tolerates the rare multi-tab race. Passing a
// no-op lock makes GoTrueClient take the `settings.lock` branch and never
// touch navigator.locks. This mirrors auth-js's own internal `lockNoOp`
// and Supabase's documented remediation for the Safari AbortError class.
// Reversible in one line if a cross-tab issue ever surfaces.
async function noopLock<R>(
    _name: string,
    _acquireTimeout: number,
    fn: () => Promise<R>,
): Promise<R> {
    return await fn()
}

export function createClient(): SupabaseClient {
    if (client) return client

    const { url, key } = getPublicSupabaseUrlAndKey()
    const cookieOptions = crossDomainCookieOptions(browserHost())
    client = createBrowserClient(url, key, {
        ...(cookieOptions ? { cookieOptions } : {}),
        auth: { lock: noopLock },
    })

    return client
}
