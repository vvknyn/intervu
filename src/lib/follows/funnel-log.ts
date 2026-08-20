/**
 * The follow funnel's telemetry — five steps from "clicked Follow" to
 * "unsubscribed," read back by /admin (see metrics.ts's "Follow funnel"
 * group). Pure builder + thin I/O, mirroring the house pattern
 * `lib/jobs/search-log.ts` already establishes: everything worth testing
 * (the stored shape, the unknown-step guard) is a plain function; the only
 * I/O is one `add()` call, wrapped so a write failure never breaks the flow
 * it's observing.
 */
import { getAdminDb } from "@/lib/firebase/admin";

export type FollowFunnelStep = "follow_click" | "cta_click" | "email_submitted" | "email_verified" | "unsubscribed";

/** The same five steps as `FollowFunnelStep`, kept as a runtime array so
 *  `buildFollowFunnelEntry` can guard against a caller that bypassed the
 *  type (a raw fetch to the action, or an `as any`) — an unknown step
 *  landing in Firestore would silently corrupt every /admin funnel count,
 *  since none of the five registered metrics filter on it and none would
 *  ever report the mismatch. Also what metrics.ts iterates to register one
 *  counter per step, so a new step is one edit here, not two. */
export const FOLLOW_FUNNEL_STEPS: readonly FollowFunnelStep[] = [
  "follow_click",
  "cta_click",
  "email_submitted",
  "email_verified",
  "unsubscribed",
];

export interface FollowFunnelEntry {
  step: FollowFunnelStep;
  companyDomain?: string;
  createdAt: string;
}

/** Pure: the stored shape of one funnel event, or null when `step` isn't
 *  one of `FOLLOW_FUNNEL_STEPS`. */
export function buildFollowFunnelEntry(
  entry: { step: FollowFunnelStep; companyDomain?: string },
  now: number = Date.now(),
): FollowFunnelEntry | null {
  if (!FOLLOW_FUNNEL_STEPS.includes(entry.step)) return null;
  return {
    step: entry.step,
    ...(entry.companyDomain ? { companyDomain: entry.companyDomain } : {}),
    createdAt: new Date(now).toISOString(),
  };
}

const COLLECTION = "follow_funnel_events";

/** The only I/O in this module — same swallow-and-log posture as
 *  search-log.ts's `write`: telemetry must never throw into a request path. */
async function write(entry: FollowFunnelEntry): Promise<void> {
  try {
    await getAdminDb().collection(COLLECTION).add(entry);
  } catch (err) {
    console.error(`[follow-funnel] write failed:`, err);
  }
}

export async function recordFollowFunnelStep(entry: { step: FollowFunnelStep; companyDomain?: string }): Promise<void> {
  const built = buildFollowFunnelEntry(entry);
  if (!built) {
    console.error(`[follow-funnel] refusing to record unknown step: ${String(entry.step)}`);
    return;
  }
  await write(built);
}
