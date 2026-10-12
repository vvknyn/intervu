/**
 * POST /api/email/daily-picks — the daily picks run (lib/daily-picks/send.ts),
 * called once a day by the host cron (deploy/run-daily-picks.sh). Same guard
 * as the weekly digest's route: `EMAIL_DIGEST_CRON_SECRET` as a bearer, and
 * no secret configured means this always 503s, so a bulk-send trigger is
 * never open on the public internet.
 *
 * Body `{ uid?: string, dryRun?: boolean }`: a uid runs one account (it still
 * has to have daily picks turned on); `dryRun` builds every email and sends
 * none, records nothing. Accounts run one after another, a few at a time, so
 * the run never crowds the site's own searches.
 *
 * The answer is counts only, never a uid or an address: the cron writes it to
 * a log file on the host.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validate } from "@/lib/validation";
import { listDailyPicksUids } from "@/lib/daily-picks/state";
import { previewDailyPicksForUser, sendDailyPicksForUser } from "@/lib/daily-picks/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
    uid: z.string().trim().min(1).optional(),
    dryRun: z.boolean().optional(),
});

/** Accounts in flight at once. */
const CONCURRENCY = 2;

export async function POST(request: Request): Promise<NextResponse> {
    const secret = process.env.EMAIL_DIGEST_CRON_SECRET;
    if (!secret) {
        console.error("[daily picks] EMAIL_DIGEST_CRON_SECRET not set — refusing to run.");
        return NextResponse.json({ error: "not configured" }, { status: 503 });
    }
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = validate(bodySchema, raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const nowMs = Date.now();
    const uids = parsed.data.uid ? [parsed.data.uid] : await listDailyPicksUids();
    const outcomes: Record<string, number> = {};
    let sent = 0;
    let picks = 0;

    const runOne = async (uid: string) => {
        try {
            if (parsed.data.dryRun) {
                const preview = await previewDailyPicksForUser(uid, { nowMs });
                const outcome = "skipped" in preview ? preview.skipped : "would-send";
                if (!("skipped" in preview)) picks += preview.picks.length;
                outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
                return;
            }
            const result = await sendDailyPicksForUser(uid, { nowMs });
            const outcome = result.sent ? "sent" : result.reason;
            if (result.sent) sent += 1;
            outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        } catch (error) {
            console.error("[daily picks] one account failed:", error);
            outcomes.error = (outcomes.error ?? 0) + 1;
        }
    };

    const queue = [...uids];
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            for (let uid = queue.shift(); uid !== undefined; uid = queue.shift()) await runOne(uid);
        }),
    );

    return NextResponse.json({
        eligible: uids.length,
        ...(parsed.data.dryRun ? { dryRun: true, picks } : { sent }),
        outcomes,
    });
}
