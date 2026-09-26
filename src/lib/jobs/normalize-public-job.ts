import type { PublicJob } from "./types";
import { toValueArray } from "./types";
import { applyTrustCorrections } from "./trust-corrections";

/** Meili documents may carry `url` (Ashby/Greenhouse posting URL) instead of
 *  `apply_url`, or omit both — coerce to the `PublicJob.apply_url` string
 *  field so downstream zod validation never sees `undefined`. */
export function resolvePublicJobApplyUrl(
  hit: { apply_url?: string | null; url?: string | null },
): string {
  const apply = hit.apply_url?.trim();
  if (apply) return apply;
  const url = hit.url?.trim();
  if (url) return url;
  return "";
}

/** Coerce `location` to `string | null` — never `undefined`. When the raw
 *  `location` field is absent, compose from structured city/state/country. */
export function resolvePublicJobLocation(
  hit: Pick<PublicJob, "location" | "location_city" | "location_state" | "location_country">,
): string | null {
  const raw = hit.location?.trim();
  if (raw) return raw;

  const country = Array.from(new Set(toValueArray(hit.location_country)))
    .map((v) => v.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [hit.location_city, hit.location_state, country]
    .map((v) => v?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Raw Meili hit → wire-safe `PublicJob`. Search hits are cast straight
 *  through today; this is the ONE boundary that fills gaps sparse documents
 *  leave (`apply_url`, `location`) and applies read-path trust corrections
 *  (`company_domain`, salary min/max/period/currency from zone tables). */
export function normalizePublicJob(
  hit: PublicJob & { url?: string | null },
): PublicJob {
  return applyTrustCorrections({
    ...hit,
    apply_url: resolvePublicJobApplyUrl(hit),
    location: resolvePublicJobLocation(hit),
  });
}

export function normalizePublicJobs(hits: (PublicJob & { url?: string | null })[]): PublicJob[] {
  return hits.map(normalizePublicJob);
}
