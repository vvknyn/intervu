/**
 * GET /api/follow-email/verify?token=...&domain=...&name=... — the verify
 * half of the verified email follow flow. Single-use token → `email_verified_at`,
 * optionally adds the in-flight company follow, sets the contact cookie,
 * and redirects back into the product. Never leaks WHY a token failed (no
 * detail beyond `followed=0`) — expired, already-consumed, and simply
 * malformed all land on the exact same redirect.
 *
 * `redirectPath` came from the submit form (`redirectPath: window.location.pathname`,
 * see submit-follow.ts) and was persisted with the token, so it is
 * caller-influenced input by the time it reaches here — `validateNextParam`
 * (auth/product-routes.ts) is the SAME same-origin-path guard the sign-in
 * flow already trusts, reused rather than re-implemented.
 */
import { NextResponse, after } from "next/server";
import { getIntervuPg } from "@/lib/pg/pool";
import { validateNextParam } from "@/lib/auth/product-routes";
import { consumeAndFollow, setContactCookie } from "@/lib/identity/contact-cookie";
import { recordFollowFunnelStep } from "@/lib/follows/funnel-log";
import { establishSessionForVerifiedEmail } from "@/lib/auth/verified-email-session";
import { relativeRedirect } from "@/lib/http/relative-redirect";

const FAILURE_PATH = "/jobs?followed=0";
const FALLBACK_PATH = "/jobs";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const domain = url.searchParams.get("domain");
  const name = url.searchParams.get("name");

  const q = getIntervuPg();
  if (!token || !q) {
    return relativeRedirect(FAILURE_PATH);
  }

  const follow = domain && name ? { companyDomain: domain, displayName: name } : null;
  const consumed = await consumeAndFollow(q, token, follow);
  if (!consumed) {
    return relativeRedirect(FAILURE_PATH);
  }

  await establishSessionForVerifiedEmail(consumed.email);
  await setContactCookie(consumed.contactToken);
  after(() => recordFollowFunnelStep({ step: "email_verified", companyDomain: domain ?? undefined }));
  const safePath = validateNextParam(consumed.redirectPath) ?? FALLBACK_PATH;
  const separator = safePath.includes("?") ? "&" : "?";
  return relativeRedirect(`${safePath}${separator}followed=1`);
}
