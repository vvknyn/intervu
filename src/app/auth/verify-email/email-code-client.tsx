"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyEmailCode, type EmailCodeState } from "@/actions/auth-email-code";
import { AuthRaisedPanel, AuthRouteLayout } from "@/components/auth/auth-route-chrome";
import { BrandLockup } from "@/components/brand/BrandMark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/ui/heading";
import { InlineSpinner } from "@/components/ui/wait-state";
import {
    EMAIL_CODE_EXPIRED_BODY,
    EMAIL_CODE_EXPIRED_BUTTON_LABEL,
    EMAIL_CODE_EXPIRED_HEADLINE,
    EMAIL_CODE_FIELD_LABEL,
    EMAIL_CODE_HEADLINE,
    EMAIL_CODE_RESEND_LABEL,
    EMAIL_CODE_RESEND_PROMPT,
    EMAIL_CODE_SUBMIT_LABEL,
    emailCodeBody,
} from "@/lib/auth/email-code-copy";

/**
 * The code form, or Start again once the hold is gone. A refusal shows under
 * the heading, above the field the person is typing in, never below the
 * button (signup-refusals: an answer under the button went unseen on phones).
 * `restartHref` restarts Continue with Google back to the same page, which is
 * also how a fresh code is sent. Never prefetched: /auth/start mints a PKCE
 * cookie and redirects to WorkOS on every request, so a prefetch would start
 * a sign-in nobody asked for.
 */
export function EmailCodeClient({ email, held, restartHref }: { email: string | null; held: boolean; restartHref: string }) {
    const [state, formAction, isPending] = useActionState<EmailCodeState, FormData>(verifyEmailCode, null);

    if (!held || state?.expired) {
        return (
            <AuthRouteLayout>
                <AuthRaisedPanel className="text-center">
                    <BrandLockup className="mx-auto w-fit" />
                    <PageTitle className="mt-4">{EMAIL_CODE_EXPIRED_HEADLINE}</PageTitle>
                    <p className="mt-2 text-sm text-muted-foreground">{EMAIL_CODE_EXPIRED_BODY}</p>
                    <Button asChild className="mt-8">
                        <Link href={restartHref} prefetch={false}>{EMAIL_CODE_EXPIRED_BUTTON_LABEL}</Link>
                    </Button>
                </AuthRaisedPanel>
            </AuthRouteLayout>
        );
    }

    const error = state && !state.expired ? state.error : null;
    return (
        <AuthRouteLayout>
            <AuthRaisedPanel>
                <div className="text-center">
                    <BrandLockup className="mx-auto w-fit" />
                    <PageTitle className="mt-4">{EMAIL_CODE_HEADLINE}</PageTitle>
                    <p className="mt-2 text-sm text-muted-foreground">{emailCodeBody(email)}</p>
                </div>
                {error && (
                    <Alert variant="destructive" data-testid="email-code-message" className="enter-reveal mt-4 text-center">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                <form action={formAction} className="mt-6 flex flex-col gap-4">
                    <Field label={EMAIL_CODE_FIELD_LABEL} htmlFor="email-code">
                        <Input
                            id="email-code"
                            name="code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            required
                            maxLength={7}
                            disabled={isPending}
                            className="text-center font-mono text-lg"
                        />
                    </Field>
                    <Button type="submit" disabled={isPending} className="w-full">
                        {isPending && <InlineSpinner size={16} className="mr-2" />}
                        {EMAIL_CODE_SUBMIT_LABEL}
                    </Button>
                </form>
                <p className="mt-4 text-center text-sm text-muted-foreground">
                    {EMAIL_CODE_RESEND_PROMPT}{" "}
                    <Link href={restartHref} prefetch={false} className="text-foreground underline underline-offset-4">
                        {EMAIL_CODE_RESEND_LABEL}
                    </Link>
                    .
                </p>
            </AuthRaisedPanel>
        </AuthRouteLayout>
    );
}
