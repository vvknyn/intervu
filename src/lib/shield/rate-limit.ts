/**
 * Per-IP sliding-window rate limit for the jobs search chokepoint
 * (`searchJobsAction`). In-memory, module-scope store — correct for this
 * deployment: docker-compose.yml runs exactly one `intervu` container
 * behind Caddy (deploy/docker-compose.yml), so there's only ever one
 * process to hold the window. If this ever runs multi-instance, a single
 * instance's map only sees its own traffic and the window needs a shared
 * store (Redis, etc.) instead — noted here, not solved here.
 */

export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Generous on purpose: real usage (typing, filter/facet changes, the
 *  ghost-hidden-count probe, infinite-scroll load-more) can fire well over
 *  a dozen debounced searches a minute from one visitor. This is sized to
 *  never bite that pattern and only catch a sustained bulk-fetch loop. */
export const RATE_LIMIT_MAX_REQUESTS = 40;

export interface RateLimitWindowResult {
  allowed: boolean;
  retained: number[];
}

/**
 * Pure decision: prune timestamps that have aged out of the window, then
 * admit the new request if the remaining count is under the cap. Unit
 * testable without touching the module-scope store — same
 * pure-decision/thin-I/O split as `resolveDegradedServe`/`getDegradedServe`
 * in `lib/jobs/search-cache.ts`.
 */
export function checkRateLimitWindow(
  timestamps: readonly number[],
  now: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
): RateLimitWindowResult {
  const cutoff = now - windowMs;
  const retained = timestamps.filter((t) => t > cutoff);
  const allowed = retained.length < maxRequests;
  if (allowed) retained.push(now);
  return { allowed, retained };
}

/** Once a store holds this many IPs, opportunistically sweep entries that
 *  have fully aged out — otherwise an idle IP's array lingers forever.
 *  Not on every call (that would be O(n) per request); only once growth
 *  suggests it's worth the pass. Shared threshold: it's a generic "is this
 *  map big enough to bother pruning" judgment, not tied to any one chokepoint. */
const SWEEP_THRESHOLD = 5_000;

/** Prune timestamps that have aged out of the window from every entry in
 *  `log`, dropping IPs left with none. Takes the map as a parameter so each
 *  chokepoint's store gets swept without duplicating this loop per caller. */
function sweepStale(log: Map<string, number[]>, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [ip, timestamps] of log) {
    const retained = timestamps.filter((t) => t > cutoff);
    if (retained.length === 0) log.delete(ip);
    else log.set(ip, retained);
  }
}

/** Every store handed out by `createIpRateLimiter`, in creation order — the
 *  one list `clearRateLimitStateForTests` walks. A limiter that forgets to
 *  go through the factory is the only way to fall out of this reset, and
 *  that would also mean it skipped the sweep/window logic below, not just
 *  the test reset. */
const registeredStores: Array<Map<string, number[]>> = [];

/**
 * Factory for a per-IP sliding-window rate limiter with its own
 * module-scope store. Every `allow*Request` chokepoint below is one call to
 * this rather than hand-copying the same six lines (size-check against
 * `SWEEP_THRESHOLD`, `sweepStale`, read the map, `checkRateLimitWindow`,
 * write back, return) per chokepoint — that copy-paste is how a 6th limiter
 * could previously be added without also remembering to wire it into
 * `clearRateLimitStateForTests`. The store this returns is pushed onto
 * `registeredStores`, so that reset covers every limiter by construction.
 */
function createIpRateLimiter(windowMs: number, maxRequests: number) {
  const store = new Map<string, number[]>();
  registeredStores.push(store);

  return function allow(ip: string, now: number = Date.now()): boolean {
    if (store.size > SWEEP_THRESHOLD) sweepStale(store, now, windowMs);
    const existing = store.get(ip) ?? [];
    const { allowed, retained } = checkRateLimitWindow(existing, now, windowMs, maxRequests);
    store.set(ip, retained);
    return allowed;
  };
}

/** Test-only reset so cases don't leak state across each other — mirrors
 *  `clearSearchCacheForTests` in `lib/jobs/search-cache.ts`. Walks every
 *  store `createIpRateLimiter` has ever handed out, so a limiter added later
 *  is covered automatically instead of needing to be named here by hand. */
export function clearRateLimitStateForTests(): void {
  for (const store of registeredStores) store.clear();
}

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the search action's own store. */
export const allowSearchRequest = createIpRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for the /connect waitlist chokepoint
 * (`joinConnectWaitlist`). Deliberately its own store, not `allowSearchRequest`'s
 * above — sharing that store would mix two unrelated counters (search volume
 * vs. waitlist signups) under one meaning. Stricter than search's 40/60s: a
 * real visitor signs up once, maybe retries a typo'd email a couple times —
 * 5 per 10 minutes is generous for that and tight against a submit-loop.
 */
export const CONNECT_WAITLIST_WINDOW_MS = 600_000;
export const CONNECT_WAITLIST_MAX_REQUESTS = 5;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the waitlist's own store. */
export const allowConnectWaitlistRequest = createIpRateLimiter(CONNECT_WAITLIST_WINDOW_MS, CONNECT_WAITLIST_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for the jobs typeahead chokepoint
 * (`GET /api/jobs/suggest`). Its own store, not search's above — same
 * reasoning as the waitlist's own store: a route handler's traffic is a
 * different counter than the search action's. Sized higher than search's
 * 40/60s on purpose: a typeahead fires on (debounced) every keystroke, not
 * once per submit, so real single-visitor usage burns through a search-sized
 * budget in a few words typed.
 */
export const JOBS_SUGGEST_WINDOW_MS = 60_000;
export const JOBS_SUGGEST_MAX_REQUESTS = 90;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the suggest route's own store. */
export const allowJobsSuggestRequest = createIpRateLimiter(JOBS_SUGGEST_WINDOW_MS, JOBS_SUGGEST_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for the location typeahead chokepoint
 * (`GET /api/jobs/locations`). Its own store for the same reason every entry
 * here has one: sharing a counter with `/api/jobs/suggest` would let a
 * searcher typing a job title exhaust the budget for typing a city, and the
 * two fire independently — they sit side by side in the same search bar.
 *
 * Sized like the title typeahead: same debounced-per-keystroke shape, and a
 * place name is if anything shorter to type than a job title.
 */
export const JOBS_LOCATION_WINDOW_MS = 60_000;
export const JOBS_LOCATION_MAX_REQUESTS = 90;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the location route's own store. */
export const allowJobsLocationRequest = createIpRateLimiter(JOBS_LOCATION_WINDOW_MS, JOBS_LOCATION_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for `POST /api/auth/session` — mints the
 * session cookie and fires the welcome email, and had NO rate limit before
 * this (verified 2026-08-16). Own store, not shared with `allowSearchRequest`
 * et al. above — same "one chokepoint, one meaning" reasoning as the
 * waitlist and suggest stores. A real human signs in a handful of times in
 * ten minutes, even switching devices or retrying a typo'd password — 10 per
 * 600s is generous against that and tight against a scripted mint loop
 * (each hit re-verifies a Firebase ID token and can trigger a Resend send).
 */
export const AUTH_SESSION_WINDOW_MS = 600_000;
export const AUTH_SESSION_MAX_REQUESTS = 10;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the session route's own store. */
export const allowAuthSessionRequest = createIpRateLimiter(AUTH_SESSION_WINDOW_MS, AUTH_SESSION_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for `signUp` (actions/auth.ts) — its own
 * store, not `allowAuthSessionRequest`'s above: creating a brand-new account
 * and minting a session for an existing one are different concerns even
 * though they can come from the same IP (a successful signup calls
 * `/api/auth/session` right after, client-side). A real visitor creates an
 * account once; retrying a taken username or a typo a couple times is
 * normal — 5 per 600s mirrors the connect-waitlist budget's reasoning for a
 * rare, one-shot action, and stays tight against a scripted account-creation
 * loop (each hit is a Firebase Auth user plus a Firestore profile write).
 */
export const AUTH_SIGNUP_WINDOW_MS = 600_000;
export const AUTH_SIGNUP_MAX_REQUESTS = 5;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the signup action's own store. */
export const allowAuthSignupRequest = createIpRateLimiter(AUTH_SIGNUP_WINDOW_MS, AUTH_SIGNUP_MAX_REQUESTS);

/** Exact segment match or a non-empty slug beneath it — `/jobs` (the list)
 *  and `/jobs/` (empty slug) are both false; `/jobs/foo` and
 *  `/jobs/foo/opengraph-image` are both true. Mirrors `isAtOrBeneath` in
 *  `suspicious-request.ts`, but that helper treats the base path itself as
 *  a match (`/api` counts) — here the base itself (the list/index) must
 *  stay OUT, so it can't be reused as-is. */
function hasNonEmptySlugBeneath(pathname: string, base: string): boolean {
  const prefix = `${base}/`;
  return pathname.startsWith(prefix) && pathname.length > prefix.length;
}

/**
 * True for a job or company DETAIL page — `/jobs/<slug>` or `/co/<slug>` —
 * never for the `/jobs` list itself or its `?job=`/query-param variants
 * (pathname never carries a query string, but this only matches a real path
 * segment regardless). This distinction is load-bearing: a plain click on a
 * `/jobs` list row opens the job in an in-page panel via native
 * `history.pushState` to `/jobs?job=<id>` (`app/jobs/page.tsx`'s
 * `applyUrlState`/`openJob` — zero HTTP requests, the list's own server
 * payload never depends on its search params), so limiting `/jobs` itself
 * would throttle ordinary browsing/filtering, not detail-page traffic. The
 * paths this DOES match are reached by real navigation: the row's `<Link
 * href={jobPath(job)}>` (crawlable/copy-link-able, `app/jobs/page.tsx`) and
 * the company link `router.push`'d from the open job panel.
 */
export function isDetailPagePath(pathname: string): boolean {
  return hasNonEmptySlugBeneath(pathname, "/jobs") || hasNonEmptySlugBeneath(pathname, "/co");
}

/**
 * Per-IP sliding-window rate limit for the `/jobs/<slug>` and `/co/<slug>`
 * detail pages, applied at the middleware seam (`isDetailPagePath` above) —
 * the one app-side backstop before this repo's IP+threshold Cloudflare rule
 * (free-plan-locked, no header/path awareness). One shared store for both
 * prefixes, not two: they're the same concern (an unauthenticated visitor
 * loading a public slug-keyed detail page), unlike the chokepoints above
 * that deliberately stay separate because they measure different things.
 *
 * Sized well above the keystroke-driven typeahead's 90/60s
 * (`JOBS_SUGGEST_MAX_REQUESTS`) because a single real "detail open" is not
 * one request here. Next's App Router `<Link>` (the jobs-list row uses one,
 * `jobPath(job)`) prefetches by default on viewport intersection, not just
 * on click — and the list loads `DEFAULT_BROWSE_LIMIT` (20, `actions/jobs.ts`)
 * rows per infinite-scroll batch, so a few seconds of continuous scrolling
 * can silently prefetch several batches' worth of distinct slugs before
 * anyone clicks anything. A real click can itself cost two hits on this
 * shape: a stale/re-titled slug 301s via `permanentRedirect` to the
 * canonical one (`app/jobs/[slug]/page.tsx`), and both the old and new URL
 * match this path. And `/jobs/<slug>/opengraph-image` matches too, so every
 * social-preview fetch shares this budget.
 *
 * 300/60s: the prefetch fan-out above means a fast continuous scroller can
 * viewport-intersect on the order of 100-200 rows in a minute — 150 sat
 * inside plausible real usage, and the cost of undersizing is the Aug 25
 * Cloudflare lockout replayed app-side (a real visitor 429'd mid-browse).
 * 300 keeps a >2x margin over that worst case while still capping a
 * sustained slug-walking scrape at ~5 req/s — weeks to walk a 2M+ corpus.
 */
export const DETAIL_PAGE_WINDOW_MS = 60_000;
export const DETAIL_PAGE_MAX_REQUESTS = 300;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the detail-page store. */
export const allowDetailPageRequest = createIpRateLimiter(DETAIL_PAGE_WINDOW_MS, DETAIL_PAGE_MAX_REQUESTS);
