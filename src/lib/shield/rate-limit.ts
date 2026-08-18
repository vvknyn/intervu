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

const ipLog = new Map<string, number[]>();
/** Once a store holds this many IPs, opportunistically sweep entries that
 *  have fully aged out — otherwise an idle IP's array lingers forever.
 *  Not on every call (that would be O(n) per request); only once growth
 *  suggests it's worth the pass. Shared threshold: it's a generic "is this
 *  map big enough to bother pruning" judgment, not tied to any one chokepoint. */
const SWEEP_THRESHOLD = 5_000;

/** Prune timestamps that have aged out of the window from every entry in
 *  `log`, dropping IPs left with none. Takes the map as a parameter so each
 *  chokepoint's store (search's `ipLog`, the waitlist's own map, ...) gets
 *  swept without duplicating this loop per caller. */
function sweepStale(log: Map<string, number[]>, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [ip, timestamps] of log) {
    const retained = timestamps.filter((t) => t > cutoff);
    if (retained.length === 0) log.delete(ip);
    else log.set(ip, retained);
  }
}

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the module-scope store. */
export function allowSearchRequest(ip: string, now: number = Date.now()): boolean {
  if (ipLog.size > SWEEP_THRESHOLD) sweepStale(ipLog, now, RATE_LIMIT_WINDOW_MS);
  const existing = ipLog.get(ip) ?? [];
  const { allowed, retained } = checkRateLimitWindow(existing, now);
  ipLog.set(ip, retained);
  return allowed;
}

/** Test-only reset so cases don't leak state across each other — mirrors
 *  `clearSearchCacheForTests` in `lib/jobs/search-cache.ts`. */
export function clearRateLimitStateForTests(): void {
  ipLog.clear();
  connectWaitlistIpLog.clear();
  jobsSuggestIpLog.clear();
  authSessionIpLog.clear();
  authSignupIpLog.clear();
}

/**
 * Per-IP sliding-window rate limit for the /connect waitlist chokepoint
 * (`joinConnectWaitlist`). Deliberately its own module-scope map, not
 * `ipLog` above — sharing that store would mix two unrelated counters
 * (search volume vs. waitlist signups) under one meaning. Stricter than
 * search's 40/60s: a real visitor signs up once, maybe retries a typo'd
 * email a couple times — 5 per 10 minutes is generous for that and tight
 * against a submit-loop.
 */
export const CONNECT_WAITLIST_WINDOW_MS = 600_000;
export const CONNECT_WAITLIST_MAX_REQUESTS = 5;
const connectWaitlistIpLog = new Map<string, number[]>();

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the waitlist's own store. */
export function allowConnectWaitlistRequest(ip: string, now: number = Date.now()): boolean {
  if (connectWaitlistIpLog.size > SWEEP_THRESHOLD) {
    sweepStale(connectWaitlistIpLog, now, CONNECT_WAITLIST_WINDOW_MS);
  }
  const existing = connectWaitlistIpLog.get(ip) ?? [];
  const { allowed, retained } = checkRateLimitWindow(
    existing,
    now,
    CONNECT_WAITLIST_WINDOW_MS,
    CONNECT_WAITLIST_MAX_REQUESTS,
  );
  connectWaitlistIpLog.set(ip, retained);
  return allowed;
}

/**
 * Per-IP sliding-window rate limit for the jobs typeahead chokepoint
 * (`GET /api/jobs/suggest`). Its own module-scope map, not `ipLog` above —
 * same reasoning as the waitlist's own store: a route handler's traffic is
 * a different counter than the search action's. Sized higher than search's
 * 40/60s on purpose: a typeahead fires on (debounced) every keystroke, not
 * once per submit, so real single-visitor usage burns through a search-sized
 * budget in a few words typed.
 */
export const JOBS_SUGGEST_WINDOW_MS = 60_000;
export const JOBS_SUGGEST_MAX_REQUESTS = 90;
const jobsSuggestIpLog = new Map<string, number[]>();

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the suggest route's own store. */
export function allowJobsSuggestRequest(ip: string, now: number = Date.now()): boolean {
  if (jobsSuggestIpLog.size > SWEEP_THRESHOLD) {
    sweepStale(jobsSuggestIpLog, now, JOBS_SUGGEST_WINDOW_MS);
  }
  const existing = jobsSuggestIpLog.get(ip) ?? [];
  const { allowed, retained } = checkRateLimitWindow(existing, now, JOBS_SUGGEST_WINDOW_MS, JOBS_SUGGEST_MAX_REQUESTS);
  jobsSuggestIpLog.set(ip, retained);
  return allowed;
}

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
const authSessionIpLog = new Map<string, number[]>();

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the session route's own store. */
export function allowAuthSessionRequest(ip: string, now: number = Date.now()): boolean {
  if (authSessionIpLog.size > SWEEP_THRESHOLD) {
    sweepStale(authSessionIpLog, now, AUTH_SESSION_WINDOW_MS);
  }
  const existing = authSessionIpLog.get(ip) ?? [];
  const { allowed, retained } = checkRateLimitWindow(existing, now, AUTH_SESSION_WINDOW_MS, AUTH_SESSION_MAX_REQUESTS);
  authSessionIpLog.set(ip, retained);
  return allowed;
}

/**
 * Per-IP sliding-window rate limit for `signUp` (actions/auth.ts) — its own
 * store, not `authSessionIpLog` above: creating a brand-new account and
 * minting a session for an existing one are different concerns even though
 * they can come from the same IP (a successful signup calls
 * `/api/auth/session` right after, client-side). A real visitor creates an
 * account once; retrying a taken username or a typo a couple times is
 * normal — 5 per 600s mirrors the connect-waitlist budget's reasoning for a
 * rare, one-shot action, and stays tight against a scripted account-creation
 * loop (each hit is a Firebase Auth user plus a Firestore profile write).
 */
export const AUTH_SIGNUP_WINDOW_MS = 600_000;
export const AUTH_SIGNUP_MAX_REQUESTS = 5;
const authSignupIpLog = new Map<string, number[]>();

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the signup action's own store. */
export function allowAuthSignupRequest(ip: string, now: number = Date.now()): boolean {
  if (authSignupIpLog.size > SWEEP_THRESHOLD) {
    sweepStale(authSignupIpLog, now, AUTH_SIGNUP_WINDOW_MS);
  }
  const existing = authSignupIpLog.get(ip) ?? [];
  const { allowed, retained } = checkRateLimitWindow(existing, now, AUTH_SIGNUP_WINDOW_MS, AUTH_SIGNUP_MAX_REQUESTS);
  authSignupIpLog.set(ip, retained);
  return allowed;
}
