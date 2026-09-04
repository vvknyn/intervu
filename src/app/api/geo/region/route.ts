/**
 * GET /api/geo/region — the ONE endpoint the telemetry client
 * (lib/telemetry/client.ts) asks to decide where `visitor_id` may live
 * (SPEC §5: EU/UK visitors must not get a durable `localStorage` id until a
 * consent choice exists). Reuses the SAME mmdb-backed country lookup +
 * client-IP resolver the /jobs search action already uses for its IP-based
 * location default (geo/ip-country.ts, shield/client-ip.ts) — no new
 * geolocation dependency, and no client-side IP lookup: the IP itself is
 * read here, transiently, and never returned to the browser.
 *
 * Fails CLOSED (`euUk: true`) on any error or an unresolved IP. This is the
 * opposite posture from the existing IP-default feature (which fails open
 * to "no default" — a UX-only consequence): getting a visitor's storage
 * jurisdiction wrong is a legal-risk decision, so "treat as EU/UK" is the
 * conservative default when the region can't be determined.
 */
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/shield/client-ip";
import { createMmdbCountryLookup } from "@/lib/geo/ip-country";
import { isEuOrUkIso2 } from "@/lib/geo/eu-uk-jurisdiction";

export interface RegionResponse {
  euUk: boolean;
}

// Lazily-opened, memoized for the life of the process — same pattern
// actions/jobs.ts uses for this same lookup (its own `countryLookup`).
const lookupCountry = createMmdbCountryLookup();

export async function GET(): Promise<NextResponse<RegionResponse>> {
  try {
    const ip = await getClientIp();
    const iso2 = await lookupCountry(ip);
    const euUk = iso2 === null ? true : isEuOrUkIso2(iso2);
    return NextResponse.json({ euUk }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ euUk: true });
  }
}
