"use server";

/**
 * The one door client components use to record a follow-funnel step —
 * `funnel-log.ts` imports firebase-admin, which client bundles cannot
 * carry. Fire-and-forget: `recordFollowFunnelStep` already swallows its
 * own write failures (see funnel-log.ts), so this wrapper never throws to
 * the caller either — a click handler awaiting this must never surface a
 * telemetry error as a broken UI.
 */
import { recordFollowFunnelStep, type FollowFunnelStep } from "@/lib/follows/funnel-log";

export async function recordFollowFunnelAction(step: FollowFunnelStep, companyDomain?: string): Promise<void> {
  await recordFollowFunnelStep({ step, companyDomain });
}
