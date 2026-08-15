/**
 * GET /api/jobs/suggest?q=... — typeahead: title/company suggestions for the
 * jobs search box.
 *
 * A route handler, not a Server Action (2026-08-14 — this replaces
 * `suggestJobsAction`, deleted from actions/jobs.ts). Next serializes a
 * client's Server Action calls per request, and the jobs page's main search
 * (`searchJobsAction`) is itself an action — so a typeahead action fired on
 * every keystroke was queuing behind whatever full search was already in
 * flight. A route handler has its own connection and no such head-of-line
 * block, and can carry a `Cache-Control` header a Server Action response
 * cannot.
 *
 * Rate-limited per-IP with its OWN store (`allowJobsSuggestRequest` —
 * `lib/shield/rate-limit.ts`'s docblock: each chokepoint gets its own
 * window, never a shared counter with the search action's).
 *
 * Never surfaces a 5xx: `suggestJobs` (lib/jobs/search.ts) already degrades
 * to `{ titles: [], companies: [] }` on any backend failure — suggestions
 * are an accelerant, never a source of user-visible error.
 */
import { NextResponse } from "next/server";
import { suggestJobs } from "@/lib/jobs/search";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowJobsSuggestRequest } from "@/lib/shield/rate-limit";
import type { JobSuggestions } from "@/lib/jobs/types";

const EMPTY_SUGGESTIONS: JobSuggestions = { titles: [], companies: [] };

/**
 * Pure: parse + cap the raw `q` search param. Same posture toward
 * user-controlled query text reaching a search call as `suggestJobsAction`
 * carried (200-char cap) — trimmed first so whitespace alone doesn't count
 * toward the cap or reach `suggestJobs` as a non-empty query.
 */
export function resolveSuggestQuery(raw: string | null): string {
  return (raw ?? "").trim().slice(0, 200);
}

export async function GET(request: Request): Promise<NextResponse> {
  const q = resolveSuggestQuery(new URL(request.url).searchParams.get("q"));
  if (!q) return NextResponse.json(EMPTY_SUGGESTIONS);

  const ip = await getClientIp();
  if (!allowJobsSuggestRequest(ip)) {
    return NextResponse.json(EMPTY_SUGGESTIONS, { status: 429 });
  }

  const suggestions = await suggestJobs(q);
  return NextResponse.json(suggestions, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
}
