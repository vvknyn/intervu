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

  function allow(ip: string, now: number = Date.now()): boolean {
    if (store.size > SWEEP_THRESHOLD) sweepStale(store, now, windowMs);
    const existing = store.get(ip) ?? [];
    const { allowed, retained } = checkRateLimitWindow(existing, now, windowMs, maxRequests);
    store.set(ip, retained);
    return allowed;
  }

  /** How long until `ip` gets a slot back (0 when it has one now) — read-only, never counts as a hit. */
  allow.retryAfterMs = (ip: string, now: number = Date.now()): number =>
    msUntilSlotFrees(store.get(ip) ?? [], now, windowMs, maxRequests);

  return allow;
}

/**
 * Pure: how long until a window holding `timestamps` admits one more request
 * — 0 when it already would. The oldest hit that still counts has to age out
 * (strict `t > cutoff`, as in `checkRateLimitWindow`), so a refusal can say
 * "try again in N minutes" instead of a vague "a few".
 */
export function msUntilSlotFrees(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
  maxRequests: number,
): number {
  const live = timestamps.filter((t) => t > now - windowMs).sort((a, b) => a - b);
  if (live.length < maxRequests) return 0;
  return live[live.length - maxRequests] + windowMs - now;
}

/** Pure: a wait in ms, as the whole minutes a person reads ("1 minute", "7 minutes"), rounded up. */
export function minutesLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
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
 * Per-IP limits for the two one-shot email forms: the /connect and /openclaw
 * waitlist (`joinConnectWaitlist`) and the founding-seat reservation on
 * /pricing (`reserveFoundingSeat`). Each form has its own stores, never
 * `allowSearchRequest`'s above, so unrelated counters don't share a meaning.
 *
 * Split the way `signUp`'s budget is (below): until 2026-10-03 each form had
 * one 5-per-600s limit counted on every submit before Turnstile, so a person
 * whose first tries were refused for another reason could spend it and then
 * read "Too many attempts".
 *
 * - SUBMIT (30 per 600s): every submit with a well-formed email, counted
 *   before Turnstile — a flood guard for the siteverify call, sized so a
 *   person retrying, or several people behind one carrier NAT, never meets it.
 * - REQUEST (5 per 600s): only submits that passed Turnstile and are about to
 *   write a row and maybe send a confirmation email. A person makes one.
 */
export const EMAIL_FORM_SUBMIT_WINDOW_MS = 600_000;
export const EMAIL_FORM_SUBMIT_MAX_REQUESTS = 30;
export const CONNECT_WAITLIST_WINDOW_MS = 600_000;
export const CONNECT_WAITLIST_MAX_REQUESTS = 5;

/** The waitlist's flood guard (before Turnstile). */
export const allowConnectWaitlistSubmit = createIpRateLimiter(EMAIL_FORM_SUBMIT_WINDOW_MS, EMAIL_FORM_SUBMIT_MAX_REQUESTS);

/** The waitlist's write budget (after Turnstile). */
export const allowConnectWaitlistRequest = createIpRateLimiter(CONNECT_WAITLIST_WINDOW_MS, CONNECT_WAITLIST_MAX_REQUESTS);

/** The founding-seat reservation's flood guard (before Turnstile). */
export const allowFoundingReserveSubmit = createIpRateLimiter(EMAIL_FORM_SUBMIT_WINDOW_MS, EMAIL_FORM_SUBMIT_MAX_REQUESTS);

/** The founding-seat reservation's write budget (after Turnstile): the waitlist's size, its own store. */
export const allowFoundingReserveRequest = createIpRateLimiter(CONNECT_WAITLIST_WINDOW_MS, CONNECT_WAITLIST_MAX_REQUESTS);

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
 * Per-IP limit for anonymous "Report listing" (`reportJobAction`) — its own
 * store. Every accepted report lowers a job's ghost score, so an unauthenticated
 * write gets a tight per-IP budget on top of the flags endpoint's per-key cap.
 */
export const REPORT_LISTING_WINDOW_MS = 600_000;
export const REPORT_LISTING_MAX_REQUESTS = 5;

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the report action's own store. */
export const allowReportListingRequest = createIpRateLimiter(REPORT_LISTING_WINDOW_MS, REPORT_LISTING_MAX_REQUESTS);

/**
 * Per-account limit for the packs home's "Needs you" read
 * (`listNeedsYouAction`, keyed by uid): one read fans out to a search per
 * followed company and saved search. The home memoises it, so a real visitor
 * makes a few a minute at most.
 */
export const NEEDS_YOU_WINDOW_MS = 60_000;
export const NEEDS_YOU_MAX_REQUESTS = 6;

export const allowNeedsYouRequest = createIpRateLimiter(NEEDS_YOU_WINDOW_MS, NEEDS_YOU_MAX_REQUESTS);

/** Retry-After value (seconds) for jobs typeahead 429 responses. */
export function typeaheadRetryAfterHeader(windowMs: number): Record<string, string> {
  return { "Retry-After": String(Math.ceil(windowMs / 1000)) };
}

/**
 * Two per-IP limits on `signUp` (actions/auth.ts), each in its own store.
 *
 * Until 2026-10-01 there was one: 5 per 600s, counted on EVERY submit before
 * anything else ran. A visitor whose first try failed for another reason (a
 * password WorkOS refused, shown only as "Failed to create account") spent
 * the whole budget retrying and was then told "Too many attempts" — after
 * never once creating an account (replay 01a0f6b4, India, /jobs?q=Remote
 * Frontend Developer). So the budget now splits by what it protects:
 *
 * - SUBMIT (30 per 600s): every submit that passes the free local checks,
 *   counted before Turnstile. A flood guard for the Turnstile siteverify call
 *   and the Firestore/DNS checks behind it — sized so a person fixing typos,
 *   or several people behind one carrier NAT, never meets it.
 * - CREATE (5 per 600s): only attempts that passed Turnstile and every local
 *   and lookup check, i.e. that are about to call WorkOS `createUser`. Each is
 *   a real account (plus a Firestore profile) or a WorkOS refusal; a person
 *   makes one or two. Tight against a scripted account-creation loop that has
 *   bought its way past Turnstile.
 */
export const AUTH_SIGNUP_SUBMIT_WINDOW_MS = 600_000;
export const AUTH_SIGNUP_SUBMIT_MAX_REQUESTS = 30;

/** Thin I/O wrapper: the signup flood guard's own store. */
export const allowAuthSignupSubmit = createIpRateLimiter(AUTH_SIGNUP_SUBMIT_WINDOW_MS, AUTH_SIGNUP_SUBMIT_MAX_REQUESTS);

export const AUTH_SIGNUP_CREATE_WINDOW_MS = 600_000;
export const AUTH_SIGNUP_CREATE_MAX_REQUESTS = 5;

/** Thin I/O wrapper: the account-creation budget's own store. */
export const allowAuthAccountCreate = createIpRateLimiter(AUTH_SIGNUP_CREATE_WINDOW_MS, AUTH_SIGNUP_CREATE_MAX_REQUESTS);

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
