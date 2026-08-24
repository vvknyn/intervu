"use server";

/**
 * "Give us an address we can actually reach you at."
 *
 * Serves accounts created by the password flow before 2026-08-20, which were
 * registered under a synthesized `<username>@intervu.cc` identifier (see
 * `username-email.ts`). Those accounts are signed in, carry a truthy
 * `user.email`, and cannot receive a single message — `send.ts` drops every
 * one as `no-mailbox`. Nothing in the product could change that until now:
 * `actions/account.ts` only ever READ the address.
 *
 * The address is NOT written to the account here. It is held as a pending
 * value and only attached once the person clicks the link we send to it
 * (`/api/account/email/verify`). Writing it on submit would let anyone who
 * borrows a signed-in session point the account's identity — and its
 * password-reset mail — at an address they control.
 */
import { getServerUser } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveAccountEmailRequest, resolveEmailNudgeState, type EmailNudgeState } from "@/lib/auth/account-email";
import { isReachableEmail } from "@/lib/auth/username-email";
import { signAccountEmailToken } from "@/lib/email/account-email-token";
import { sendVerifyAccountEmail } from "@/lib/email/verify-account-email";
import { getSiteUrl } from "@/lib/seo/constants";

/** Where a pending (submitted, unconfirmed) address is parked. `profiles` is
 *  docId-owned in the migration manifest, so account deletion already sweeps
 *  it — a new collection would have to be taught to the manifest, and an
 *  address stored somewhere deletion doesn't reach is a privacy bug. */
const PROFILES = "profiles";

async function readPendingEmail(uid: string): Promise<string | null> {
    const snap = await getAdminDb().collection(PROFILES).doc(uid).get();
    const value = snap.data()?.pending_email;
    return typeof value === "string" && value ? value : null;
}

export async function getAccountEmailStateAction(): Promise<{
    data?: { state: EmailNudgeState; email: string | null; pendingEmail: string | null };
    error?: string;
}> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };

    const reachable = isReachableEmail(user.email);
    // Don't read the pending doc when the address is already good — the
    // answer can't change the state and it costs a Firestore read per render.
    const pendingEmail = reachable ? null : await readPendingEmail(user.uid);

    return {
        data: {
            state: resolveEmailNudgeState({ reachable, pendingEmail }),
            email: reachable ? user.email ?? null : null,
            pendingEmail,
        },
    };
}

/**
 * Validates the address, parks it as pending, and mails a confirmation link.
 *
 * Returns `success` for a genuinely sent confirmation and `alreadySet` for
 * "that's the address you already have" — two different outcomes that a
 * single boolean would flatten into a UI saying "check your inbox" about a
 * mail that was never sent.
 */
export async function requestAccountEmailAction(raw: unknown): Promise<
    { success: true; pendingEmail: string } | { alreadySet: true } | { error: string }
> {
    const user = await getServerUser();
    if (!user) return { error: "Sign in to add an email address." };

    const resolved = resolveAccountEmailRequest(raw, user.email);
    if (!resolved.ok) {
        if ("alreadySet" in resolved) return { alreadySet: true };
        return { error: resolved.error };
    }

    const token = signAccountEmailToken(user.uid, resolved.email, Date.now());
    // No signing key means no verifiable link. Refuse rather than send a mail
    // whose button is guaranteed to fail — a confirmation that cannot confirm
    // is worse than no mail, because the person believes it worked.
    if (!token) {
        console.error("[account-email] ENCRYPTION_KEY unset — cannot mint a confirmation link");
        return { error: "We couldn't send the confirmation right now. Try again later." };
    }

    await getAdminDb().collection(PROFILES).doc(user.uid).set(
        { pending_email: resolved.email, pending_email_at: new Date().toISOString() },
        { merge: true },
    );

    const verifyUrl = `${getSiteUrl()}/api/account/email/verify?token=${encodeURIComponent(token)}`;
    await sendVerifyAccountEmail({ email: resolved.email, verifyUrl });

    return { success: true, pendingEmail: resolved.email };
}
