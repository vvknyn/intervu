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
 *  map big enough to bother pruning" judgment, not tied to any one chokepoint.
 *  Exported so other in-process, per-key stores (e.g. `lib/telemetry/rate-limit.ts`)
 *  reuse this sweep instead of a second copy of the same threshold-and-prune
 *  logic. */
export const SWEEP_THRESHOLD = 5_000;

/** Prune timestamps that have aged out of the window from every entry in
 *  `log`, dropping IPs left with none. Takes the map as a parameter so each
 *  chokepoint's store gets swept without duplicating this loop per caller.
 *  Exported for the same reason as `SWEEP_THRESHOLD` above. */
export function sweepStale(log: Map<string, number[]>, now: number, windowMs: number): void {
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

/** Retry-After value (seconds) for jobs typeahead 429 responses. */
export function typeaheadRetryAfterHeader(windowMs: number): Record<string, string> {
  return { "Retry-After": String(Math.ceil(windowMs / 1000)) };
}

/**
 * Per-IP sliding-window rate limit for `signUp` (actions/auth.ts) — its own
 * store: creating a brand-new account is a different concern from every
 * other chokepoint in this file, even from the same IP. A real visitor
 * creates an account once; retrying a taken username or a typo a couple
 * times is normal — 5 per 600s mirrors the connect-waitlist budget's
 * reasoning for a rare, one-shot action, and stays tight against a scripted
 * account-creation loop (each hit is a WorkOS user plus a Firestore profile
 * write).
 */
export const AUTH_SIGNUP_WINDOW_MS = 600_000;
export const AUTH_SIGNUP_MAX_REQUESTS = 5;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the signup action's own store. */
export const allowAuthSignupRequest = createIpRateLimiter(AUTH_SIGNUP_WINDOW_MS, AUTH_SIGNUP_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for `signIn` (actions/auth.ts) — its own
 * store, not `allowAuthSignupRequest`'s above: signing in to an existing
 * account and creating a new one are different concerns, and a scripted
 * password-guessing loop against one username is exactly the traffic shape
 * signup's 5-per-600s budget is too generous for (guessing needs many tries
 * against one account, not one try against many). 10 per 60s covers a real
 * person mistyping a password a few times in a row while staying tight
 * against a credential-stuffing loop (each hit is a WorkOS
 * `authenticateWithPassword` call).
 */
export const AUTH_SIGNIN_WINDOW_MS = 60_000;
export const AUTH_SIGNIN_MAX_REQUESTS = 10;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the sign-in action's own store. */
export const allowAuthSignInRequest = createIpRateLimiter(AUTH_SIGNIN_WINDOW_MS, AUTH_SIGNIN_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for the password-reset request action
 * (`ForgotPasswordForm`) — its own store: unlike sign-in/signup, every hit
 * here sends an email (`createPasswordReset` + Resend), so this is also a
 * mailbox-flooding control, not just an account-guessing one. Mirrors the
 * connect-waitlist budget's reasoning for a rare, one-shot action a real
 * visitor uses once or twice.
 */
export const AUTH_RESET_REQUEST_WINDOW_MS = 600_000;
export const AUTH_RESET_REQUEST_MAX_REQUESTS = 5;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the reset-request action's own store. */
export const allowAuthResetRequest = createIpRateLimiter(AUTH_RESET_REQUEST_WINDOW_MS, AUTH_RESET_REQUEST_MAX_REQUESTS);

/**
 * Per-IP sliding-window rate limit for POST /api/search-alerts — its own
 * store. Same budget as connect-waitlist: a real visitor submits once, maybe
 * retries a typo — 5 per 10 minutes is generous for that and tight against a
 * submit-loop that sends verification mail.
 */
export const SEARCH_ALERT_WINDOW_MS = 600_000;
export const SEARCH_ALERT_MAX_REQUESTS = 5;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the search-alert route's own store. */
export const allowSearchAlertRequest = createIpRateLimiter(SEARCH_ALERT_WINDOW_MS, SEARCH_ALERT_MAX_REQUESTS);
