/**
 * POST /api/jobs/search — the jobs list search, over a plain fetch.
 *
 * The same move the typeahead (2026-08-14, ../suggest) and detail lookups
 * (2026-09-18, ../[id]/description) made. Next runs a page's Server Action
 * calls one at a time, and the list search was one, so every click backed by
 * an action (Save search, Follow, a tracker write) waited behind whatever
 * search was still loading, and a page's searches ran one after another
 * instead of together (2026-10-01: a phone's Save search waited 5s behind
 * the signed-in search). A route handler has its own connection.
 *
 * It calls `searchJobsAction` itself, so the shield (per-IP limit, anonymous
 * depth cap), the search telemetry and the result shape stay in one place.
 */
import { NextResponse } from "next/server";
import { searchJobsAction } from "@/actions/jobs";
import type { JobSearchParams } from "@/lib/jobs/types";

/** A search's params are a few hundred bytes; far past that isn't a search. */
export const MAX_SEARCH_BODY_BYTES = 32_768;

/** Pure: the request body as search params, or null when it isn't a params object. */
export function parseSearchBody(raw: string): JobSearchParams | null {
  if (raw.length > MAX_SEARCH_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JobSearchParams) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const params = parseSearchBody(await request.text());
  if (!params) return NextResponse.json({ error: "Not a search" }, { status: 400 });
  const result = await searchJobsAction(params);
  // Per person (the depth cap reads the session) and per moment: never cached.
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store, private" } });
}
