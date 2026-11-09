/**
 * POST /api/csp-report — where the browser sends Content-Security-Policy
 * violation reports (`report-uri` / `report-to` in next.config.ts).
 *
 * Reading, redaction and the log budget live in lib/security/csp-report.ts;
 * this file reads the body (bounded) and logs. Always answers 204 with no body:
 * the sender is a browser that ignores the answer, and nothing here should tell
 * a caller whether a report parsed. To see what the policy would block:
 *
 *   docker logs <web container> 2>&1 | grep '\[csp-report\]'
 */
import { NextResponse } from "next/server";
import { createCspLogBudget, formatCspLogLine, readCspReports } from "@/lib/security/csp-report";

/** A violation report is a few hundred bytes; anything past this is not one. */
export const MAX_REPORT_BYTES = 16 * 1024;

const budget = createCspLogBudget();

export async function POST(request: Request): Promise<NextResponse> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REPORT_BYTES) return new NextResponse(null, { status: 413 });

  let payload: unknown;
  try {
    const text = (await request.text()).slice(0, MAX_REPORT_BYTES);
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  for (const violation of readCspReports(payload)) {
    const { allowed, droppedBefore } = budget.take(Date.now());
    if (droppedBefore > 0) console.warn(`[csp-report] ${droppedBefore} more reports in the last window were not logged`);
    if (allowed) console.warn(formatCspLogLine(violation));
  }
  return new NextResponse(null, { status: 204 });
}
