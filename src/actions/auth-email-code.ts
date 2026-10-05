"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthenticationResponse } from "@workos-inc/node";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowAuthEmailCodeRequest } from "@/lib/shield/rate-limit";
import { getWorkosUserManagement, requireWorkosClientId } from "@/lib/auth/workos-runtime";
import { workosErrorCodes } from "@/lib/auth/workos-errors";
import { completeAuthKitSignIn } from "@/lib/auth/authkit-sign-in-complete";
import { resolvePostAuthDestination } from "@/lib/auth/post-auth-destination";
import { toServerUser } from "@/lib/auth/workos-identity";
import {
    EMAIL_CODE_COOKIE_NAME,
    emailCodeCookieOptions,
    normalizeEmailCode,
    unsealPendingEmailCode,
} from "@/lib/auth/email-code-pending";
import {
    EMAIL_CODE_FORMAT_MESSAGE,
    EMAIL_CODE_WRONG_MESSAGE,
    emailCodeRateLimitMessage,
} from "@/lib/auth/email-code-copy";
import { captureServerEvent } from "@/lib/analytics/server-capture";
import { logServer } from "@/lib/observability/posthog-logs";
import { reportAuthStep } from "@/lib/auth/auth-timing";
import { getSiteUrl } from "@/lib/seo/constants";

export type EmailCodeState = { error: string; expired?: false } | { expired: true } | null;

/**
 * Finish a Google sign-in WorkOS held for an emailed code (the step
 * email-code-pending.ts describes): send the code back with the pending token
 * from the sealed cookie, save the session exactly as /auth/callback would,
 * and land the person where they were headed, so an Apply they started
 * replays there.
 *
 * A refused code keeps the cookie: WorkOS lets the same pending token try
 * again until it expires, and the person may just have mistyped. A missing or
 * expired cookie answers `expired`, which the page turns into Start again.
 */
export async function verifyEmailCode(_prev: EmailCodeState, formData: FormData): Promise<EmailCodeState> {
    const cookieStore = await cookies();
    const pending = await unsealPendingEmailCode(cookieStore.get(EMAIL_CODE_COOKIE_NAME)?.value);
    if (!pending) {
        captureServerEvent("auth_email_code_submitted", crypto.randomUUID(), { outcome: "expired" });
        return { expired: true };
    }

    const code = normalizeEmailCode(formData.get("code"));
    if (!code) return { error: EMAIL_CODE_FORMAT_MESSAGE };

    const ip = await getClientIp();
    if (!allowAuthEmailCodeRequest(ip)) {
        return { error: emailCodeRateLimitMessage(allowAuthEmailCodeRequest.retryAfterMs(ip)) };
    }

    const started = Date.now();
    let auth: AuthenticationResponse;
    try {
        const userManagement = await getWorkosUserManagement();
        auth = await userManagement.authenticateWithEmailVerification({
            clientId: requireWorkosClientId(),
            code,
            pendingAuthenticationToken: pending.pendingAuthenticationToken,
        });
    } catch (error) {
        // Why, never the code, token or address.
        const e = error as { name?: string; status?: number; error?: unknown } | null;
        logServer("warn", "email code refused", {
            error_name: e?.name ?? "unknown",
            error_status: e?.status,
            error_codes: [...workosErrorCodes(error), ...(typeof e?.error === "string" ? [e.error] : [])].join(",") || undefined,
        });
        captureServerEvent("auth_email_code_submitted", crypto.randomUUID(), { outcome: "refused" });
        return { error: EMAIL_CODE_WRONG_MESSAGE };
    }

    const { saveSession } = await import("@workos-inc/authkit-nextjs");
    await saveSession(auth, getSiteUrl());
    cookieStore.set(EMAIL_CODE_COOKIE_NAME, "", { ...emailCodeCookieOptions(), maxAge: 0 });
    // Signed in from here on: a failed welcome/signup bookkeeping step must not
    // strand the person on this page.
    await completeAuthKitSignIn(auth.user, auth.authenticationMethod).catch((err) =>
        console.error("[auth] email-code sign-in follow-up failed:", err),
    );
    captureServerEvent("auth_email_code_submitted", toServerUser(auth.user).uid, { outcome: "signed_in" });
    reportAuthStep("email_code", Date.now() - started);
    // Back to the page they started on, as every other sign-in does; bare /jobs when there was none.
    redirect(resolvePostAuthDestination(pending.next));
}
