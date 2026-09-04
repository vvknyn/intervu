"use server";

import { verifyUnsubscribeToken, type UnsubscribeScope } from "@/lib/email/unsubscribe-token";
import { suppress, unsuppress } from "@/lib/email/suppression";
import { forgetIdentity } from "@/lib/identity/forget";
import { getIntervuPg, getTelemetryForgetPg } from "@/lib/pg/pool";

export type UnsubscribeActionResult =
  | { ok: true; email: string; kind: UnsubscribeScope }
  | { ok: false; error: string };

const INVALID_TOKEN_ERROR = "This unsubscribe link is invalid or has expired. Contact us if you keep getting emails you didn't ask for.";

/**
 * Suppresses the token's (email, kind) pair. Called directly from the
 * `/unsubscribe` page on load — a "one-click" unsubscribe takes effect the
 * moment the link is opened, not on some further confirmation click.
 * Idempotent by construction: `suppress` is a Firestore `set(..., {merge})`,
 * so opening the same link twice just re-writes the same entry.
 */
export async function processUnsubscribeAction(token: string): Promise<UnsubscribeActionResult> {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) return { ok: false, error: INVALID_TOKEN_ERROR };

    await suppress(payload.email, payload.kind, "unsubscribed");
    return { ok: true, email: payload.email, kind: payload.kind };
}

/** The confirmation page's "wasn't me" undo — re-subscribes the same
 *  (email, kind) pair the token describes. */
export async function undoUnsubscribeAction(token: string): Promise<UnsubscribeActionResult> {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) return { ok: false, error: INVALID_TOKEN_ERROR };

    await unsuppress(payload.email, payload.kind);
    return { ok: true, email: payload.email, kind: payload.kind };
}

/**
 * The `/unsubscribe?...&forget=1` variant — same signed token as a normal
 * unsubscribe (no new auth surface: the token already proves control of
 * the address), but routes through `forgetIdentity` instead of a
 * kind-scoped `suppress`. That always suppresses globally ("all", not
 * whatever kind the token happened to be signed for) and deletes any PG
 * identity for the address — deletion is not undoable, unlike a plain
 * unsubscribe, so the result is always reported under the "all" scope
 * regardless of the token's own kind.
 */
export async function processForgetAction(token: string): Promise<UnsubscribeActionResult> {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) return { ok: false, error: INVALID_TOKEN_ERROR };

    await forgetIdentity(getIntervuPg(), getTelemetryForgetPg(), payload.email);
    return { ok: true, email: payload.email, kind: "all" };
}
