/**
 * POST /api/retention/resumes — the résumé retention run
 * (lib/retention/resume-retention.ts), called daily by the host cron
 * (deploy/run-resume-retention.sh). Guard:
 * `RESUME_RETENTION_CRON_SECRET` (its own secret, compared in constant time) as a bearer; unset means always 503.
 *
 * Body `{ apply?: boolean }`: dry run unless `apply` is true. The answer is
 * counts only. Any per-account error makes the status 500 so the cron log
 * says FAIL (the run still finishes every account).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerMatches } from "@/lib/retention/bearer";
import { runResumeRetention } from "@/lib/retention/resume-retention";
import { validate } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ apply: z.boolean().optional() });

export async function POST(request: Request): Promise<NextResponse> {
    const secret = process.env.RESUME_RETENTION_CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
    if (!bearerMatches(request.headers.get("authorization"), secret)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const parsed = validate(bodySchema, await request.json().catch(() => ({})));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const apply = parsed.data.apply === true;
    const counts = await runResumeRetention({ apply });
    return NextResponse.json({ apply, ...counts }, { status: counts.errors + counts.send_failed > 0 ? 500 : 200 });
}
