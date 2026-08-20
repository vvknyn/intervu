/**
 * POST /api/email/digest/run — the digest endpoint the brief asks for.
 * Deliberately NOT wired to a cron in this PR (Vivek reviews real dry-run
 * output first — see scripts/digest-dry-run.mts — before anything triggers
 * this on a schedule). `EMAIL_DIGEST_CRON_SECRET` absent means this route
 * always 503s: an unauthenticated bulk-send trigger sitting on the public
 * internet is not a state this endpoint should ever be reachable in.
 *
 * Body `{ uid?: string }`: a single uid targets just that user (manual
 * verification); omitted runs every digest-eligible user. Each user's own
 * suppression state is still the final gate — `sendEmail` (send.ts) checks
 * it before ever calling Resend, so a "digest off" toggle (E5) or an
 * unsubscribe always wins regardless of what this endpoint is told to run.
 *
 * When the identity store is configured, a second recipient lane runs
 * after the account-uid loop: verified email-only follows (no Firebase
 * account) from `sendEmailFollowDigests`. Its `sinceIso` boundary is
 * derived the same "no cursor yet" way `getDigestCursor` falls back for a
 * brand-new account, because the PG schema carries no per-identity digest
 * cursor (see pg-lane.ts). `excludeEmails` is every account-lane uid's own
 * email (via the same `digestEmailForUid` lookup `previewDigestForUser`
 * uses) — an address with a Firebase account never also gets the
 * email-only lane's send, so nobody is double-mailed.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validate } from "@/lib/validation";
import { listDigestEligibleUids } from "@/lib/email/digest/eligible-users";
import { sendDigestForUser, digestEmailForUid } from "@/lib/email/digest/send";
import { sendEmailFollowDigests } from "@/lib/email/digest/pg-lane";
import { normalizeEmail } from "@/lib/email/normalize-email";
import { getIntervuPg, isIdentityStoreEnabled } from "@/lib/pg/pool";
import { defaultVisitCursor } from "@/lib/jobs/visit-cursor";

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

  let pgLane: Awaited<ReturnType<typeof sendEmailFollowDigests>> | undefined;
  const q = getIntervuPg();
  if (isIdentityStoreEnabled() && q) {
    const accountEmails = await Promise.all(uids.map(digestEmailForUid));
    const excludeEmails = new Set(
      accountEmails.filter((email): email is string => email !== null).map(normalizeEmail),
    );
    pgLane = await sendEmailFollowDigests({ q, sinceIso: defaultVisitCursor(), excludeEmails });
  }

  return NextResponse.json({ eligible: uids.length, sent, results, ...(pgLane ? { pgLane } : {}) });
}
