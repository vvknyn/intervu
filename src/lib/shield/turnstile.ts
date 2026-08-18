/**
 * Server-side Cloudflare Turnstile verification, ahead of Cloudflare going
 * in front of intervuhq.com. Wired into every form that can absorb an
 * automated-submission cost (signup, contact, waitlist, connect-waitlist) —
 * never the Google OAuth path, which Google itself already gates.
 *
 * CRITICAL SEAM: while `TURNSTILE_SECRET_KEY` is unset, verification is
 * deliberately inert (`"not-configured"`, treated as a pass by every
 * caller) so the app deploys and works before Turnstile keys exist. The
 * moment a secret key IS set, a missing, empty, or Cloudflare-rejected token
 * is always refused — this never fabricates a pass once configured.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult =
  | { status: "not-configured" }
  | { status: "pass" }
  | { status: "reject"; reason: string };

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Pure decision: given whether a secret key is configured, the token a
 * caller supplied, and (if a verify call was made) Cloudflare's raw
 * response, decide pass/reject/not-configured. Split out from the network
 * call below so the branch logic — the actual security decision — is
 * unit-testable without stubbing `fetch`.
 */
export function decideTurnstileResult(
  hasSecretKey: boolean,
  token: string | null | undefined,
  apiResponse: SiteverifyResponse | null,
): TurnstileResult {
  if (!hasSecretKey) return { status: "not-configured" };
  if (!token || !token.trim()) return { status: "reject", reason: "missing-token" };
  if (!apiResponse) return { status: "reject", reason: "verify-request-failed" };
  if (!apiResponse.success) {
    return { status: "reject", reason: (apiResponse["error-codes"] ?? []).join(",") || "invalid-token" };
  }
  return { status: "pass" };
}

/**
 * Thin I/O wrapper: reads `TURNSTILE_SECRET_KEY` itself (so callers don't
 * each have to plumb it), POSTs the token to Cloudflare's siteverify
 * endpoint when configured, and folds the result through the pure decision
 * above. A network failure or non-JSON response is treated as `apiResponse:
 * null` — reject, never a silent pass.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return decideTurnstileResult(false, token, null);
  if (!token || !token.trim()) return decideTurnstileResult(true, token, null);

  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const json = (await res.json()) as SiteverifyResponse;
    return decideTurnstileResult(true, token, json);
  } catch (error) {
    console.error("[Turnstile] siteverify request failed:", error);
    return decideTurnstileResult(true, token, null);
  }
}
