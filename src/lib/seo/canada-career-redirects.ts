/**
 * Retired Canada-focused career hub slugs (removed from `CAREER_HUBS`).
 * Permanent redirects in `next.config.ts` send these to a live hub.
 */
export const REMOVED_CANADA_CAREER_SLUGS = [
  "canada-jobs",
  "toronto-jobs",
  "vancouver-jobs",
  "montreal-jobs",
  "calgary-jobs",
  "ottawa-jobs",
  "remote-jobs-canada",
] as const;

/** Destination when `/careers/remote-jobs` remains in `CAREER_HUBS`. */
export const CANADA_CAREER_REDIRECT_DESTINATION = "/careers/remote-jobs";
