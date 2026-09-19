/**
 * GET /api/jobs/[id]/description — on-demand job-description hydrate for a
 * single id.
 *
 * A route handler, not (only) the `searchJobsAction` Server Action every
 * id-scoped detail fetch ran through before this (2026-09-18,
 * `perf(jobs): hydrate descriptions via GET route`). Next's client Server
 * Action queue is strictly serial FIFO per client — see
 * `settle-guard.ts`'s (now-removed) `DETAIL_SETTLE_TIMEOUT_MS` doc comment
 * for the measured prod cost this caused: a detail lookup invoked at 5.4s
 * landed at 18.3s, most of it spent queued behind 14 unrelated actions, not
 * doing real work. A route handler has its own connection and no such
 * head-of-line block — the same reasoning `/api/jobs/suggest`'s own
 * action → route move already used (see that file's doc comment).
 *
 * Shares `hydrateJobDescription` (lib/jobs/hydrate-description.ts) with
 * `searchJobsAction`'s own id path — identical Meili lookup, identical fill
 * logic, identical payload shape — so this route is a transport change, not
 * a second implementation of the same behavior to keep in sync.
 *
 * Rate-limited with the id path's EXISTING store (`allowSearchRequest`), not
 * a fresh one. That's a deliberate departure from this codebase's usual
 * "every chokepoint gets its own store" convention (rate-limit.ts's own
 * docblock) — here, a fresh store would ADD budget on top of what
 * `searchJobsAction`'s id path already spends against this exact store for
 * the same IP, making this route a WIDER door than the code path it
 * replaces rather than just a faster one. The anonymous depth cap
 * (`resolveDepthCap`) is not replicated here: fixed at `limit: 1, offset:
 * 0`, it is a no-op for every caller regardless of auth (`ANON_MAX_OFFSET`
 * only gates `offset >= 90`), so skipping it changes nothing observable.
 *
 * `Cache-Control` is set only when the result is both complete (no
 * `descriptionPending`, or a retry within the 60s window would replay the
 * stale pending stub instead of re-checking) AND authoritative
 * (`isAuthoritativeResult`, lib/jobs/result-state.ts — the SAME predicate
 * `classifyExistenceCheck` uses, so this route and the client's own
 * existence-check classifier can never drift on what counts as a trustworthy
 * envelope). A Meili-outage envelope (`unavailable: true`) or a
 * served-from-cache degraded envelope (`meta.degraded`) both come back as a
 * 200 today; without this, the browser would cache and replay that failure
 * for 60s and the "try again" retry (jobs/page.tsx, yours/[id]/page.tsx)
 * would silently re-read it instead of re-checking.
 */
import { NextResponse } from "next/server";
import { hydrateJobDescription, type HydrateDescriptionResult } from "@/lib/jobs/hydrate-description";
import { isAuthoritativeResult } from "@/lib/jobs/result-state";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowSearchRequest } from "@/lib/shield/rate-limit";

export const dynamic = "force-dynamic";

const MAX_JOB_ID_LENGTH = 200;

/** Pure: a legal job id is a non-empty, sanely bounded string — same
 *  posture toward user-controlled input reaching a search call as
 *  `resolveSuggestQuery`'s 200-char cap (app/api/jobs/suggest/route.ts). */
export function isValidJobId(raw: string | undefined): raw is string {
  return typeof raw === "string" && raw.trim().length > 0 && raw.length <= MAX_JOB_ID_LENGTH;
}

/**
 * Pure: the `Cache-Control` decision for a hydrate result — set ONLY when
 * the result is both complete (`descriptionPending !== true`) AND
 * authoritative (`isAuthoritativeResult`). Split out so this decision is
 * directly unit-testable without a real Request/`next/headers()` scope —
 * same posture `resolveCountRouteTotal` (api/jobs/count/route.ts) and
 * `resolveSuggestQuery` (api/jobs/suggest/route.ts) already take for their
 * own routes' pure decisions.
 */
export function describeResponseInit(result: HydrateDescriptionResult): ResponseInit | undefined {
  const cacheable = isAuthoritativeResult(result) && result.descriptionPending !== true;
  return cacheable ? { headers: { "Cache-Control": "private, max-age=60" } } : undefined;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidJobId(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = await hydrateJobDescription(id, ip);
  return NextResponse.json(result, describeResponseInit(result));
}
