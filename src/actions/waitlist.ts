"use server";

import { z } from "zod";
import { validate } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebase/admin";
import { PACKS, type PackId } from "@/lib/pricing";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist-confirmation";
import { normalizeEmail } from "@/lib/email/normalize-email";
import { verifyTurnstile } from "@/lib/shield/turnstile";

// Derived from PACKS, not a hand-retyped "starter" | "hunt" | "deep" union —
// a fourth pack in pricing.ts is covered here automatically.
const packIds = PACKS.map((p) => p.id) as [PackId, ...PackId[]];

const waitlistInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("must be a valid email address").max(320),
  packId: z.enum(packIds),
});

export type WaitlistValidation =
  | { kind: "invalid"; error: string }
  | { kind: "silent-drop" }
  | { kind: "valid"; email: string; packId: string };

/**
 * Pure decision layer for the waitlist form — no Firestore, so it's
 * directly unit-testable. Honeypot is checked BEFORE shape validation: a
 * filled honeypot means "bot", and a bot should never learn anything about
 * why its submission was rejected (including a validation error), so it
 * short-circuits to the same silent-drop outcome regardless of what else it
 * sent. A human who mistyped their email (empty honeypot) still gets a real,
 * actionable "invalid" error.
 */
export async function validateWaitlistInput(input: {
  email: string;
  packId: string;
  honeypot: string;
  turnstileToken?: string;
}): Promise<WaitlistValidation> {
  if (input.honeypot.trim() !== "") {
    return { kind: "silent-drop" };
  }

  const turnstile = await verifyTurnstile(input.turnstileToken);
  if (turnstile.status === "reject") {
    return { kind: "invalid", error: "Verification failed — please try again." };
  }

  const parsed = validate(waitlistInputSchema, { email: input.email, packId: input.packId });
  if (!parsed.ok) return { kind: "invalid", error: parsed.error };

  return { kind: "valid", email: parsed.data.email, packId: parsed.data.packId };
}

/** Real, human name for the confirmation email — never invented copy, just
 *  what PACKS itself already knows about the pack. */
function packLabel(packId: string): string {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return "the waitlist";
  const name = pack.id.charAt(0).toUpperCase() + pack.id.slice(1);
  return `the ${name} pack ($${pack.usd}, ${pack.credits} credits)`;
}

/**
 * Waitlist form submission. Mirrors submitFeedback's shape (`{success:true}`
 * / `{error}`) — a silent-drop returns the SAME success shape as a genuine
 * submission, without touching Firestore, so a bot can't distinguish
 * "accepted" from "dropped".
 *
 * Doc id is `${email}::${packId}` (upsert, same idempotent shape
 * `connect_waitlist` already uses) rather than an auto-id — a resubmission
 * of the same email+pack re-merges the SAME doc instead of creating a
 * second one, which is what makes `confirmationSentAt` a meaningful guard:
 * with a fresh auto-id per submit there'd be no single doc to check it on.
 */
export async function submitWaitlistAction(input: {
  email: string;
  packId: string;
  honeypot: string;
  turnstileToken?: string;
}): Promise<{ success: true } | { error: string }> {
  const result = await validateWaitlistInput(input);

  if (result.kind === "invalid") return { error: result.error };
  if (result.kind === "silent-drop") return { success: true };

  try {
    const db = getAdminDb();
    const email = normalizeEmail(result.email);
    const ref = db.collection("waitlist").doc(`${email}::${result.packId}`);
    const existing = await ref.get();

    await ref.set(
      { email, packId: result.packId, ts: existing.exists ? existing.data()?.ts : new Date().toISOString() },
      { merge: true },
    );

    if (!existing.data()?.confirmationSentAt) {
      const sendResult = await sendWaitlistConfirmation(email, packLabel(result.packId));
      if (sendResult.sent) {
        await ref.set({ confirmationSentAt: new Date().toISOString() }, { merge: true });
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error submitting waitlist entry:", error);
    return { error: "Failed to join the waitlist. Please try again." };
  }
}
