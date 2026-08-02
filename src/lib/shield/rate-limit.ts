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
/** Once the store holds this many IPs, opportunistically sweep entries that
 *  have fully aged out — otherwise an idle IP's array lingers forever.
 *  Not on every call (that would be O(n) per search); only once growth
 *  suggests it's worth the pass. */
const SWEEP_THRESHOLD = 5_000;

function sweepStale(now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [ip, timestamps] of ipLog) {
    const retained = timestamps.filter((t) => t > cutoff);
    if (retained.length === 0) ipLog.delete(ip);
    else ipLog.set(ip, retained);
  }
}

/** Thin I/O wrapper: `checkRateLimitWindow` wired to the module-scope store. */
export function allowSearchRequest(ip: string, now: number = Date.now()): boolean {
  if (ipLog.size > SWEEP_THRESHOLD) sweepStale(now, RATE_LIMIT_WINDOW_MS);
  const existing = ipLog.get(ip) ?? [];
  const { allowed, retained } = checkRateLimitWindow(existing, now);
  ipLog.set(ip, retained);
  return allowed;
}

/** Test-only reset so cases don't leak state across each other — mirrors
 *  `clearSearchCacheForTests` in `lib/jobs/search-cache.ts`. */
export function clearRateLimitStateForTests(): void {
  ipLog.clear();
}
