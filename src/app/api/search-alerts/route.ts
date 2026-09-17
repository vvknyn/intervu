/**
 * POST /api/search-alerts — submit half of anonymous weekly search alerts.
 * Thin route: decision-making lives in submitSearchAlert (lib/identity/submit-search-alert.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validate, nonEmptyString } from "@/lib/validation";
import { getIntervuPg } from "@/lib/pg/pool";
import { getSiteUrl } from "@/lib/seo/constants";
import { verifyTurnstile } from "@/lib/shield/turnstile";
import { resolveClientIpFromHeaders } from "@/lib/shield/client-ip";
import { allowSearchAlertRequest } from "@/lib/shield/rate-limit";
import { sendVerifySearchAlertEmail } from "@/lib/email/verify-search-alert";
import { submitSearchAlert, type SubmitSearchAlertResult } from "@/lib/identity/submit-search-alert";
import { captureServerEvent } from "@/lib/analytics/server-capture";

const bodySchema = z.object({
  email: nonEmptyString(320),
  name: nonEmptyString(200),
  href: nonEmptyString(2048),
  redirectPath: z.string().trim().max(2048).default("/"),
  turnstileToken: z.string().trim().min(1).nullable().optional(),
  distinctId: z.string().trim().min(1).max(200).nullable().optional(),
  surface: z.enum(["zero_results", "results"]),
  queryLength: z.number().int().min(0),
  filterCount: z.number().int().min(0),
  hasResults: z.boolean(),
});

const STATUS_CODE: Record<SubmitSearchAlertResult["status"], number> = {
  accepted: 200,
  rejected: 400,
  unavailable: 503,
};

export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.json().catch(() => null);
  const parsed = validate(bodySchema, raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const requestIp = resolveClientIpFromHeaders(request.headers);
  const result = await submitSearchAlert(
    {
      q: getIntervuPg(),
      verifyTurnstile: async (token, remoteIp) => {
        const outcome = await verifyTurnstile(token, remoteIp);
        return { success: outcome.status !== "reject" };
      },
      sendVerifyEmail: sendVerifySearchAlertEmail,
      baseUrl: getSiteUrl(),
      allowRequest: allowSearchAlertRequest,
    },
    {
      email: parsed.data.email,
      name: parsed.data.name,
      href: parsed.data.href,
      redirectPath: parsed.data.redirectPath,
      turnstileToken: parsed.data.turnstileToken ?? null,
      requestIp,
      distinctId: parsed.data.distinctId ?? null,
      analytics: {
        surface: parsed.data.surface,
        query_length: parsed.data.queryLength,
        filter_count: parsed.data.filterCount,
        has_results: parsed.data.hasResults,
      },
    },
  );

  // Server-side: the only place this event can't be dropped by the
  // browser closing/redirecting before a client-side capture would fire —
  // see src/lib/analytics/server-capture.ts. Skipped (not fabricated) when
  // the client had no distinct id to send.
  if (parsed.data.distinctId) {
    captureServerEvent("search_alert_submitted", parsed.data.distinctId, {
      surface: parsed.data.surface,
      query_length: parsed.data.queryLength,
      filter_count: parsed.data.filterCount,
      has_results: parsed.data.hasResults,
      outcome: result.status === "accepted" ? "accepted" : "rejected",
    });
  }

  return NextResponse.json({ status: result.status }, { status: STATUS_CODE[result.status] });
}
