/**
 * POST /api/follow-email — the submit half of the verified email follow
 * flow (docs/specs/2026-08-19-verified-email-follow-design.md). Thin: all
 * the real decision-making (email shape, PG availability, Turnstile, the
 * per-address send cap) lives in `submitFollowEmail`
 * (lib/identity/submit-follow.ts), unit-tested there without a database or
 * network call. This route only parses the body and wires the real deps.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validate, nonEmptyString } from "@/lib/validation";
import { getIntervuPg } from "@/lib/pg/pool";
import { getSiteUrl } from "@/lib/seo/constants";
import { verifyTurnstile } from "@/lib/shield/turnstile";
import { resolveClientIpFromHeaders } from "@/lib/shield/client-ip";
import { sendVerifyFollowEmail } from "@/lib/email/verify-follow";
import { submitFollowEmail, type SubmitFollowResult } from "@/lib/identity/submit-follow";

const bodySchema = z.object({
  email: nonEmptyString(320),
  companyDomain: nonEmptyString(255),
  displayName: nonEmptyString(200),
  redirectPath: z.string().trim().max(2048).default("/"),
  turnstileToken: z.string().trim().min(1).nullable().optional(),
});

const STATUS_CODE: Record<SubmitFollowResult["status"], number> = {
  accepted: 200,
  // Turnstile reject and a malformed email both come back as "rejected" —
  // both are the caller's request being refused, not a server problem.
  rejected: 400,
  // No INTERVU_PG_URL configured: the feature genuinely cannot do anything
  // durable here, so this is a service-unavailable, not a fabricated 200.
  unavailable: 503,
};

export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.json().catch(() => null);
  const parsed = validate(bodySchema, raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const requestIp = resolveClientIpFromHeaders(request.headers);
  const result = await submitFollowEmail(
    {
      q: getIntervuPg(),
      verifyTurnstile: async (token, remoteIp) => {
        const outcome = await verifyTurnstile(token, remoteIp);
        // "not-configured" (no TURNSTILE_SECRET_KEY, e.g. local dev) passes
        // by the same fail-open posture every other Turnstile caller uses
        // (lib/contact/submit.ts, actions/auth.ts) — only an explicit
        // "reject" refuses.
        return { success: outcome.status !== "reject" };
      },
      sendVerifyEmail: sendVerifyFollowEmail,
      baseUrl: getSiteUrl(),
    },
    {
      email: parsed.data.email,
      companyDomain: parsed.data.companyDomain,
      displayName: parsed.data.displayName,
      redirectPath: parsed.data.redirectPath,
      turnstileToken: parsed.data.turnstileToken ?? null,
      requestIp,
    },
  );

  return NextResponse.json({ status: result.status }, { status: STATUS_CODE[result.status] });
}
