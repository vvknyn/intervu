import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EmailCodeClient } from "./email-code-client";
import { decideCallbackFailureLanding } from "@/lib/auth/callback-guard";
import { getServerUser } from "@/lib/auth/server-user";
import { EMAIL_CODE_COOKIE_NAME, emailCodeRestartHref, unsealPendingEmailCode } from "@/lib/auth/email-code-pending";

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

/**
 * Where /auth/callback sends a Google sign-in WorkOS held for an emailed code
 * (src/lib/auth/email-code-pending.ts). With the held sign-in in its cookie
 * the page asks for the code; without it (expired, already used, opened
 * later) it offers Start again. A visitor who is already signed in, say after
 * the back button, is sent on, same decision as /auth/retry.
 */
export default async function VerifyEmailPage() {
    const pending = await unsealPendingEmailCode((await cookies()).get(EMAIL_CODE_COOKIE_NAME)?.value);
    if (!pending) {
        const landing = decideCallbackFailureLanding({ hasSession: (await getServerUser()) !== null, rawNext: null });
        if (landing.kind === "redirect") redirect(landing.path);
    }

    return (
        <EmailCodeClient
            email={pending?.email ?? null}
            held={pending !== null}
            restartHref={emailCodeRestartHref(pending?.next ?? null)}
        />
    );
}
