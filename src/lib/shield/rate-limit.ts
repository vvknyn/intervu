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
