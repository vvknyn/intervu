/**
 * The no-signal lane: what a reader who saved nothing, follows nobody and
 * tracks nothing gets — if it is switched on at all.
 *
 * Ships OFF, by product decision (2026-08-17): the welcome email is meant to
 * drive real saved searches first, and a generic weekly send to people who
 * never asked for one is the fastest way to spend a sending domain's
 * reputation on nothing. `isDefaultDigestEnabled` is the single gate; both
 * eligibility (who the run walks) and content (whether this section is
 * built) read it, so there is no way to half-enable the lane.
 *
 * The section is deliberately not a new search mechanism. A default digest
 * IS a saved search the reader never got around to saving, so it goes
 * through `listNewRolesForSavedSearch` with a `JobsUrlState` built here —
 * the same code path, the same cursor semantics, and a `seeAllHref` that is
 * a real /jobs URL the reader can open and then actually save.
 */
import { DEFAULT_URL_STATE, type JobsUrlState } from "@/lib/jobs/url-state";
import { parseWorkTypeTokens } from "@/lib/jobs/query-understanding";
import type { SearchPreferences } from "@/lib/agent/preferences";

/** Env var, not a config file: this has to be flippable on the box without
 *  a rebuild, and it gates outbound email to people who did not ask for it. */
export const DEFAULT_DIGEST_FLAG = "DIGEST_DEFAULT_ENABLED";

/**
 * Strict equality with `"true"`, not truthiness: `DIGEST_DEFAULT_ENABLED=0`
 * and `=false` are both non-empty strings and would otherwise switch the
 * lane ON, which is the wrong direction to be wrong in for a mail send.
 */
export function isDefaultDigestEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[DEFAULT_DIGEST_FLAG] === "true";
}

/** Heading for the lane. Phrased as an offer, not as a claim about fit —
 *  nothing here ranked these against the reader. */
export const DEFAULT_SECTION_NAME = "New roles this week";

/**
 * Pure: the reader's stated preferences, as a board state.
 *
 * Only `query`, `salaryMin` and `remoteOnly` are carried across, and the
 * omissions are the point:
 *
 * - `location` has no free-text counterpart in `JobsUrlState` — the board
 *   filters location by a `location_country` facet, and turning "London"
 *   into a country is a guess that silently returns the wrong continent.
 * - `experienceLevel` / `employmentType` are closed facet vocabularies, but
 *   these values arrive as arbitrary strings over the MCP wire
 *   (`set_preferences`). An unmatched facet value doesn't error, it filters
 *   to zero — so a typo would produce a permanently empty digest with
 *   nothing anywhere to explain why.
 * - `postedWithinDays` is redundant and can only do harm: the digest is
 *   already bounded to "since your last digest" by the cursor, and a
 *   narrower window would drop roles the reader has genuinely not seen.
 *
 * `remoteOnly` is safe because `parseWorkTypeTokens` is the corpus's own
 * canonicalizer — the facet value comes from the vocabulary itself rather
 * than from a literal spelled out here.
 */
export function defaultDigestSearchState(preferences: SearchPreferences | undefined): JobsUrlState {
  const salaryMin = preferences?.salaryMin;
  const workTypes =
    preferences?.workMode === "remote" || preferences?.remoteOnly
      ? parseWorkTypeTokens("remote").workTypes
      : [];

  return {
    ...DEFAULT_URL_STATE,
    q: preferences?.query?.trim() ?? "",
    salaryMin: typeof salaryMin === "number" && salaryMin > 0 ? salaryMin : DEFAULT_URL_STATE.salaryMin,
    facets: workTypes.length > 0 ? { work_type: workTypes } : {},
  };
}
