import { matchBand, matchBandLabel, type MatchScore } from "@/lib/match/score";
import type { MatchQualityAnalyticsProps } from "@/lib/analytics/events";

/**
 * Optional match-quality fields for product analytics events. Returns `{}`
 * when there is no score — callers spread into `captureEvent` payloads so
 * PostHog never receives null or fabricated zeros.
 */
export function matchAnalyticsProps(
  score: MatchScore | null | undefined,
): MatchQualityAnalyticsProps | Record<string, never> {
  if (score == null) return {};

  const band = matchBand(score.total);
  return {
    match_label: matchBandLabel(band),
    match_score: score.total,
    match_band: band,
  };
}
