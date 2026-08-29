/**
 * Contact-form submission chokepoint, behind `POST /api/contact` (see
 * `src/app/api/contact/route.ts`). Previously a server action
 * (`src/actions/contact.ts`) — moved to a route handler because a server
 * action's ID is build-specific: a visitor whose tab predates a deploy gets
 * "Failed to find Server Action" and the message is lost forever. A route
 * path is deploy-stable, so this is now the app's only unauthenticated form
 * carrying unrecoverable third-party input.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { validate, contactMessageSchema, isHoneypotTripped, type ValidateResult } from "@/lib/validation";
import { sendEmail } from "@/lib/email/send";
import { verifyTurnstile, type TurnstileResult } from "@/lib/shield/turnstile";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

export interface ContactSubmitInput {
  name?: string;
  email: string;
  message: string;
  honeypot: string;
  turnstileToken?: string;
  path: string;
}

export type ContactSubmitResult = { success: true } | { error: string };

type ContactData = { name?: string; email: string; message: string };

/**
 * Pure decision core: given the turnstile outcome and the schema-validation
 * result (both already computed — no I/O in here), decides whether the
 * submission proceeds to Firestore and what to tell the client if it
 * doesn't. Honeypot is checked by the caller *before* this runs (see
 * `submitContact`) so a bot fill never even triggers the Turnstile network
 * call. Split out so this branching — the actual security/UX decision — is
 * unit-testable without a Firestore connection.
 */
export function resolveContactGate(input: {
  turnstile: TurnstileResult;
  validated: ValidateResult<ContactData>;
}): { proceed: true; data: ContactData } | { proceed: false; result: ContactSubmitResult } {
  if (input.turnstile.status === "reject") {
    return { proceed: false, result: { error: "Verification failed — please try again." } };
  }
  if (!input.validated.ok) {
    return { proceed: false, result: { error: input.validated.error } };
  }
  return { proceed: true, data: input.validated.data };
}

/**
 * Thin I/O wrapper around `sendEmail`, which never throws. The contact
 * message is already persisted in Firestore by the time this runs, so a
 * notification-send failure must never surface as a submission failure to
 * the visitor — it only gets logged, which is the one thing the prior
 * server-action version failed to do (a lost notification looked identical
 * to a sent one).
 */
export async function notifyContactSubmission(data: ContactData, path: string): Promise<void> {
  const result = await sendEmail({
    to: "hello@thesubspace.io",
    subject: `[Velai Contact] Message from ${data.name ? `${data.name} (${data.email})` : data.email}`,
    text: `New contact form submission on Velai:\n\nName: ${data.name || "Not provided"}\nEmail: ${data.email}\nSubmitted from: ${path}\nTime: ${new Date().toISOString()}\n\nMessage:\n${data.message}\n`,
    kind: "transactional",
  });
  if (!result.sent) {
    console.error("[Contact] notification email failed:", result.reason);
  }
}

export async function submitContact(input: ContactSubmitInput): Promise<ContactSubmitResult> {
  if (isHoneypotTripped(input.honeypot)) {
    // Bot fill — accept-and-drop silently so it doesn't retry with a
    // different pattern. Never hits Turnstile or Firestore, never surfaces
    // an error.
    return { success: true };
  }

  const turnstile = await verifyTurnstile(input.turnstileToken);
  const validated = validate(contactMessageSchema, {
    name: input.name,
    email: input.email,
    message: input.message,
  });

  const gate = resolveContactGate({ turnstile, validated });
  if (!gate.proceed) return gate.result;

  const db = getAdminDb();

  try {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const recentSnapshot = await db
      .collection("contact_messages")
      .where("email", "==", gate.data.email)
      .where("ts", ">=", since)
      .get();

    if (recentSnapshot.size >= RATE_LIMIT_MAX) {
      return { error: "Too many messages from this email in the last hour. Try again later." };
    }
  } catch (error) {
    // Best-effort only (e.g. missing composite index) — never block a
    // legitimate submission because the rate-limit check itself failed.
    console.error("[Contact] Rate limit check error:", error);
  }

  try {
    await db.collection("contact_messages").add({
      email: gate.data.email,
      message: gate.data.message,
      name: gate.data.name ?? null,
      ts: new Date().toISOString(),
      path: input.path,
    });

    await notifyContactSubmission(gate.data, input.path);

    return { success: true };
  } catch (error) {
    console.error("[Contact] Submit error:", error);
    return { error: "Failed to send your message. Please try again." };
  }
}
