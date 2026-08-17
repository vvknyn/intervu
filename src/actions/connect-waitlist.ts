"use server";

import { z } from "zod";
import { validate } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebase/admin";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowConnectWaitlistRequest } from "@/lib/shield/rate-limit";
import { CONNECT_CLIENTS, CONNECT_CLIENT_IDS } from "@/lib/connect-clients";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist-confirmation";

/**
 * Waitlist capture for /connect (MCP pairing is live; this collects "notify
 * me" requests for surfaces that aren't yet — e.g. the OpenClaw local agent
 * on non-Mac platforms). Dedup is an idempotent upsert keyed on
 * the normalized email as the Firestore doc id, so resubmission just
 * re-merges the same doc instead of racing a query-then-write check.
 *
 * Shield: per-IP rate limited via `allowConnectWaitlistRequest` (its own
 * store, not shared with the jobs-search chokepoint's `allowSearchRequest`)
 * before this ever touches Firestore — same "fail before the backend" shape
 * as `searchJobsAction` in actions/jobs.ts.
 */
const connectWaitlistSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, "email is too long").email("must be a valid email"),
  // Derived from CONNECT_CLIENTS (src/lib/connect-clients.ts) — the /connect
  // tabs are the only valid values a submission can carry.
  client: z.enum(CONNECT_CLIENT_IDS),
});

export async function joinConnectWaitlist(input: {
  email: string;
  client: string;
}): Promise<{ error?: string; success?: true }> {
  const parsed = validate(connectWaitlistSchema, input);
  if (!parsed.ok) return { error: parsed.error };

  const ip = await getClientIp();
  if (!allowConnectWaitlistRequest(ip)) {
    return { error: "Too many attempts — try again in a few minutes." };
  }

  try {
    const db = getAdminDb();
    const ref = db.collection("connect_waitlist").doc(parsed.data.email);
    const existing = await ref.get();

    await ref.set(
      {
        email: parsed.data.email,
        client: parsed.data.client,
        created_at: new Date().toISOString(),
      },
      { merge: true },
    );

    // Idempotent: only the first submission for this email sends a
    // confirmation, regardless of how many times the form resubmits.
    if (!existing.data()?.confirmationSentAt) {
      const clientLabel = CONNECT_CLIENTS.find((c) => c.id === parsed.data.client)?.label ?? parsed.data.client;
      const sendResult = await sendWaitlistConfirmation(parsed.data.email, `${clientLabel} on /connect`);
      if (sendResult.sent) {
        await ref.set({ confirmationSentAt: new Date().toISOString() }, { merge: true });
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error joining connect waitlist:", error);
    return {
      error: "Couldn't save that — email us at hello@thesubspace.io and we'll add you.",
    };
  }
}
