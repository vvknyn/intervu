/**
 * POST /api/jobs/place-notes — where a few postings' descriptions say the
 * person must be ("must be based in India"), for a ranked list that only has
 * the rows' place fields (`readPlaceNotes`). Today asks for its first picks
 * whose rows name no country, so a role for people in another country never
 * reads as workable (2026-10-02).
 *
 * A route handler, not a Server Action, for the same reason as the search
 * and description routes: it must not queue behind the page's other actions.
 * Charged to the same per-IP store as one search, so it opens no wider door.
 */
import { NextResponse } from "next/server";
import { isValidJobId } from "@/app/api/jobs/[id]/description/route";
import { readPlaceNotes } from "@/lib/jobs/place-notes";
import { PLACE_NOTES_MAX_IDS } from "@/lib/jobs/place-restriction";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowSearchRequest } from "@/lib/shield/rate-limit";

export const dynamic = "force-dynamic";

/** Pure: the request body's ids, or null when it isn't `{ ids: [...] }` with a sane number of sane ids. */
export function parsePlaceNotesBody(raw: string): string[] | null {
  if (raw.length > 16_384) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const ids = (parsed as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > PLACE_NOTES_MAX_IDS) return null;
    return ids.every((id): id is string => isValidJobId(id as string)) ? ids : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const ids = parsePlaceNotesBody(await request.text());
  if (!ids) return NextResponse.json({ error: "invalid ids" }, { status: 400 });

  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  try {
    return NextResponse.json({ notes: await readPlaceNotes(ids) });
  } catch (e) {
    console.error("[place-notes] read failed:", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
