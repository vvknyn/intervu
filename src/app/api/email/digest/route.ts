/**
 * POST /api/email/digest/run — the digest endpoint the brief asks for.
 * Deliberately NOT wired to a cron in this PR (Vivek reviews real dry-run
 * output first — see scripts/digest-dry-run.mjs — before anything triggers
 * this on a schedule). `EMAIL_DIGEST_CRON_SECRET` absent means this route
 * always 503s: an unauthenticated bulk-send trigger sitting on the public
 * internet is not a state this endpoint should ever be reachable in.
 *
 * Body `{ uid?: string }`: a single uid targets just that user (manual
 * verification); omitted runs every digest-eligible user. Each user's own
 * suppression state is still the final gate — `sendEmail` (send.ts) checks
 * it before ever calling Resend, so a "digest off" toggle (E5) or an
 * unsubscribe always wins regardless of what this endpoint is told to run.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validate } from "@/lib/validation";
import { listDigestEligibleUids } from "@/lib/email/digest/eligible-users";
import { sendDigestForUser } from "@/lib/email/digest/send";

const bodySchema = z.object({ uid: z.string().trim().min(1).optional() });

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.EMAIL_DIGEST_CRON_SECRET;
  if (!secret) {
    console.error("[email digest] EMAIL_DIGEST_CRON_SECRET not set — refusing to run.");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = validate(bodySchema, raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const uids = parsed.data.uid ? [parsed.data.uid] : await listDigestEligibleUids();

  const results = await Promise.all(
    uids.map(async (uid) => ({ uid, result: await sendDigestForUser(uid) })),
  );
  const sent = results.filter((r) => r.result.sent).length;

  return NextResponse.json({ eligible: uids.length, sent, results });
}
