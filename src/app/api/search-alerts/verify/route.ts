/**
 * GET /api/search-alerts/verify?token=... — verify half of anonymous weekly
 * search alerts. Intent lives on the token (no query params for search).
 */
import { NextResponse } from "next/server";
import { getIntervuPg } from "@/lib/pg/pool";
import { validateNextParam } from "@/lib/auth/product-routes";
import { consumeAndSaveSearchAlert, setContactCookie } from "@/lib/identity/contact-cookie";
import { relativeRedirect } from "@/lib/http/relative-redirect";

const FAILURE_PATH = "/jobs?search_alert=0";
const FALLBACK_PATH = "/jobs";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  const q = getIntervuPg();
  if (!token || !q) {
    return relativeRedirect(FAILURE_PATH);
  }

  const consumed = await consumeAndSaveSearchAlert(q, token);
  if (!consumed) {
    return relativeRedirect(FAILURE_PATH);
  }

  await setContactCookie(consumed.contactToken);
  const safePath = validateNextParam(consumed.redirectPath) ?? FALLBACK_PATH;
  const separator = safePath.includes("?") ? "&" : "?";
  return relativeRedirect(`${safePath}${separator}search_alert=1`);
}
