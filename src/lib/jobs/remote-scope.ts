/**
 * Where a remote role says it is open, for a role whose place fields name no country: "Remote" beside
 * a posting that reads "Remote - US or Canada" or "must be based in India" becomes "Remote (United States or
 * Canada)" or "Remote (India)", so the row says what the posting says (CareerHound borrow list, 2026-10-21:
 * their cards separate Remote Canada from Remote North America from Remote US).
 *
 * It is read from the description (`place_restriction`, place-restriction.ts), so a scope always has the
 * posting's own sentence (`quote`) and a role whose posting names nowhere keeps plain "Remote". A role whose
 * fields already name a country, or whose title does, is left as it is; so is a welcome ("Canadians
 * welcome"), which says where a role hires, not where it is open. Pure and isomorphic.
 */
import { jobCountries, titlePlace } from "./resume-location";
import type { PublicJob } from "./types";

export interface RemoteScope {
    /** The place as the posting wrote it ("Canada", "North America", "United States or Canada"). */
    label: string;
    /** The posting's own sentence that says it. */
    quote: string;
}

/** The scope a remote role's description gives, or `null` (not remote, a country already named, no limit stated). */
export function remoteScope(job: PublicJob): RemoteScope | null {
    const place = job.place_restriction;
    if (!place || place.open || !place.quote || place.countries.length === 0) return null;
    if (!/remote/i.test(job.work_type ?? "")) return null;
    if (jobCountries(job).length > 0 || titlePlace(job.title)) return null;
    return { label: place.label, quote: place.quote };
}

/** `location` as the row shows it: a plain "Remote" reads "Remote (Canada)"; anything else is left alone. */
export function withRemoteScope(location: string, scope: RemoteScope | null): string {
    return scope && /^remote$/i.test(location.trim()) ? `Remote (${scope.label})` : location;
}
