"use server";

import { z } from "zod";
import { validate } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebase/admin";
import { PACKS, type PackId } from "@/lib/pricing";

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
}): Promise<WaitlistValidation> {
  if (input.honeypot.trim() !== "") {
    return { kind: "silent-drop" };
  }

  const parsed = validate(waitlistInputSchema, { email: input.email, packId: input.packId });
  if (!parsed.ok) return { kind: "invalid", error: parsed.error };

  return { kind: "valid", email: parsed.data.email, packId: parsed.data.packId };
}

/**
 * Waitlist form submission. Mirrors submitFeedback's shape (`{success:true}`
 * / `{error}`) — a silent-drop returns the SAME success shape as a genuine
 * submission, without touching Firestore, so a bot can't distinguish
 * "accepted" from "dropped".
 */
export async function submitWaitlistAction(input: {
  email: string;
  packId: string;
  honeypot: string;
}): Promise<{ success: true } | { error: string }> {
  const result = await validateWaitlistInput(input);

  if (result.kind === "invalid") return { error: result.error };
  if (result.kind === "silent-drop") return { success: true };

  try {
    const db = getAdminDb();
    await db.collection("waitlist").add({
      email: result.email,
      packId: result.packId,
      ts: new Date().toISOString(),
    });
    return { success: true };
  } catch (error) {
    console.error("Error submitting waitlist entry:", error);
    return { error: "Failed to join the waitlist. Please try again." };
  }
}
