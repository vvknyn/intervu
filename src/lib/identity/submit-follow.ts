/**
 * `submitFollowEmail` — the pure(ish), deps-injected core behind
 * POST /api/follow-email. Deps-injected (same pattern as `resolveSendPreflight`
 * in email/send.ts) so the decision ladder — email shape, PG availability,
 * Turnstile, the per-address send cap — is unit-testable without a real
 * database, Cloudflare call, or Resend send. The route (route.ts) supplies
 * the real deps and does nothing else.
 */
import { z } from "zod";
import type { Queryable } from "../pg/pool";
import { upsertIdentityForEmail, countRecentVerifyTokens, createVerifyToken } from "./store";
import { turnstileRejectMessage, type TurnstileVerdict } from "../shield/turnstile";

export interface SubmitFollowDeps {
  q: Queryable | null;
  verifyTurnstile(token: string | null | undefined, remoteIp?: string): Promise<TurnstileVerdict>;
  sendVerifyEmail(input: { email: string; companyName: string; verifyUrl: string }): Promise<void>;
  baseUrl: string;
}

/** `message` is set only when the human check refused it — what the visitor can do about that. */
export type SubmitFollowResult = { status: "accepted" } | { status: "unavailable" } | { status: "rejected"; message?: string };

/** Every address gets at most this many verification sends per rolling day —
 *  above the cap the response still says "accepted" (never reveals the cap
 *  was hit) but nothing is sent. */
const MAX_VERIFY_SENDS_PER_DAY = 3;
const RECENT_WINDOW_HOURS = 24;

const emailSchema = z.string().trim().toLowerCase().email();

/**
 * Response shape is intentionally the SAME `{ status: "accepted" }` whether
 * the address is brand new, already verified, or currently rate-limited —
 * an attacker probing which addresses exist in our identity store must not
 * be able to tell from the response alone (enumeration guard, spec Guards
 * section).
 */
export async function submitFollowEmail(
  deps: SubmitFollowDeps,
  input: {
    email: string;
    companyDomain: string;
    displayName: string;
    redirectPath: string;
    turnstileToken: string | null;
    requestIp?: string;
  },
): Promise<SubmitFollowResult> {
  const parsedEmail = emailSchema.safeParse(input.email);
  if (!parsedEmail.success) return { status: "rejected" };

  // Honest absence: no PG connection configured means the feature cannot
  // durably record anything, so it must say so rather than fabricate an
  // "accepted" that nothing behind it will ever act on.
  if (deps.q === null) return { status: "unavailable" };

  const turnstile = await deps.verifyTurnstile(input.turnstileToken, input.requestIp);
  if (!turnstile.success) return { status: "rejected", message: turnstileRejectMessage(turnstile.reason) };

  const email = parsedEmail.data;
  const recentSends = await countRecentVerifyTokens(deps.q, email, RECENT_WINDOW_HOURS);
  if (recentSends >= MAX_VERIFY_SENDS_PER_DAY) return { status: "accepted" };

  const identity = await upsertIdentityForEmail(deps.q, email);
  const rawToken = await createVerifyToken(deps.q, {
    identityId: identity.id,
    redirectPath: input.redirectPath,
    requestIp: input.requestIp,
  });
  const verifyUrl = `${deps.baseUrl}/api/follow-email/verify?token=${rawToken}`;

  await deps.sendVerifyEmail({ email: identity.email, companyName: input.displayName, verifyUrl });

  return { status: "accepted" };
}
