/**
 * `submitSearchAlert` — deps-injected core behind POST /api/search-alerts.
 * Mirrors submit-follow.ts: email shape, href validation, Turnstile, PG null
 * check, IP rate limit, per-address verify send cap, enumeration-safe status.
 */
import { z } from "zod";
import type { Queryable } from "../pg/pool";
import {
  upsertIdentityForEmail,
  countRecentVerifyTokensForPurpose,
  createSearchAlertVerifyToken,
  type SearchAlertAnalytics,
} from "./store";
import { validateSearchAlertHref } from "./validate-search-href";
import { turnstileRejectMessage, type TurnstileVerdict } from "../shield/turnstile";

export interface SubmitSearchAlertDeps {
  q: Queryable | null;
  verifyTurnstile(token: string | null | undefined, remoteIp?: string): Promise<TurnstileVerdict>;
  sendVerifyEmail(input: { email: string; searchName: string; verifyUrl: string }): Promise<void>;
  baseUrl: string;
  allowRequest(ip: string): boolean;
}

export type SubmitSearchAlertResult =
  | { status: "accepted" }
  | { status: "unavailable" }
  /** `message` is set only when the human check refused it — what the visitor can do about that. */
  | { status: "rejected"; message?: string };

const MAX_VERIFY_SENDS_PER_DAY = 3;
const RECENT_WINDOW_HOURS = 24;

const emailSchema = z.string().trim().toLowerCase().email();

export async function submitSearchAlert(
  deps: SubmitSearchAlertDeps,
  input: {
    email: string;
    name: string;
    href: string;
    redirectPath: string;
    turnstileToken: string | null;
    requestIp?: string;
    distinctId: string | null;
    analytics: SearchAlertAnalytics;
  },
): Promise<SubmitSearchAlertResult> {
  const parsedEmail = emailSchema.safeParse(input.email);
  if (!parsedEmail.success) return { status: "rejected" };

  const hrefCheck = validateSearchAlertHref(input.href);
  if (!hrefCheck.ok) return { status: "rejected" };

  const trimmedName = input.name.trim();
  if (!trimmedName) return { status: "rejected" };

  if (deps.q === null) return { status: "unavailable" };

  if (input.requestIp && !deps.allowRequest(input.requestIp)) return { status: "rejected" };

  const turnstile = await deps.verifyTurnstile(input.turnstileToken, input.requestIp);
  if (!turnstile.success) return { status: "rejected", message: turnstileRejectMessage(turnstile.reason) };

  const email = parsedEmail.data;
  const recentSends = await countRecentVerifyTokensForPurpose(
    deps.q,
    email,
    "verify_search_alert",
    RECENT_WINDOW_HOURS,
  );
  if (recentSends >= MAX_VERIFY_SENDS_PER_DAY) return { status: "accepted" };

  const identity = await upsertIdentityForEmail(deps.q, email);
  const rawToken = await createSearchAlertVerifyToken(deps.q, {
    identityId: identity.id,
    redirectPath: input.redirectPath,
    requestIp: input.requestIp,
    name: trimmedName,
    href: hrefCheck.href,
    searchHash: hrefCheck.searchHash,
    distinctId: input.distinctId,
    analytics: input.analytics,
  });
  const verifyUrl = `${deps.baseUrl}/api/search-alerts/verify?token=${rawToken}`;

  await deps.sendVerifyEmail({
    email: identity.email,
    searchName: trimmedName,
    verifyUrl,
  });

  return { status: "accepted" };
}
