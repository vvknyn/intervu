"use client";

/**
 * "Where should we send your job alerts?" — one form, two mount points
 * (settings, and the /jobs banner). Written once because the two surfaces ask
 * the same question and must not drift into two different answers about what
 * a successful submit means.
 *
 * The three states come from `resolveEmailNudgeState`, not from local
 * booleans: `pending-confirmation` in particular must NOT read as done. An
 * address that has been typed but not confirmed is exactly the "truthy means
 * finished" trap this whole flow exists to fix.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { requestAccountEmailAction } from "@/actions/account-email";
import type { EmailNudgeState } from "@/lib/auth/account-email";

const EMAIL_FIELD_LABEL = "Email for job alerts";

export interface AccountEmailPromptProps {
    state: EmailNudgeState;
    pendingEmail: string | null;
    /** Told the confirmed-pending address so a parent can re-render its own
     *  copy without refetching. */
    onPending?: (email: string) => void;
    /** Settings renders this inline; the /jobs banner offers a dismiss. */
    onDismiss?: () => void;
    className?: string;
}

export function AccountEmailPrompt({
    state,
    pendingEmail,
    onPending,
    onDismiss,
    className,
}: AccountEmailPromptProps) {
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);

    if (state === "reachable") return null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        const result = await requestAccountEmailAction(email);
        setSubmitting(false);

        if ("error" in result) {
            toast.error(result.error);
            return;
        }
        if ("alreadySet" in result) {
            // Not an error and not a send — saying "check your inbox" here
            // would point someone at a mail that was never sent.
            toast.success("That's already the email on your account.");
            return;
        }
        setEmail("");
        onPending?.(result.pendingEmail);
        toast.success(`Confirmation sent to ${result.pendingEmail}.`);
    };

    if (state === "pending-confirmation" && pendingEmail) {
        return (
            <div className={className}>
                <p className="text-sm">Check {pendingEmail}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                    Click the link in that email and we&apos;ll start sending your job alerts there.
                    Wrong address? Enter a different one below.
                </p>
                <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label={EMAIL_FIELD_LABEL} htmlFor="account-email-input-pending" className="min-w-[200px] flex-1">
                        <Input
                            id="account-email-input-pending"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            className="h-9 w-full max-w-[260px] text-base"
                            data-testid="account-email-input"
                        />
                    </Field>
                    <Button type="submit" size="sm" disabled={submitting} data-testid="account-email-submit">
                        {submitting ? "Sending…" : "Send again"}
                    </Button>
                </form>
            </div>
        );
    }

    return (
        <div className={className}>
            <p className="text-sm">Add an email for job alerts</p>
            <p className="mt-1 text-xs text-muted-foreground">
                You signed up with a username, so we have no way to reach you. Add an address and
                we&apos;ll send new roles from your saved searches and followed companies.
            </p>
            <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-wrap items-end gap-2">
                <Field label={EMAIL_FIELD_LABEL} htmlFor="account-email-input-needs" className="min-w-[200px] flex-1">
                    <Input
                        id="account-email-input-needs"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="h-9 w-full max-w-[260px] text-base"
                        data-testid="account-email-input"
                    />
                </Field>
                <Button type="submit" size="sm" disabled={submitting} data-testid="account-email-submit">
                    {submitting ? "Sending…" : "Send confirmation"}
                </Button>
                {onDismiss ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={onDismiss}
                        data-testid="account-email-dismiss"
                    >
                        Not now
                    </Button>
                ) : null}
            </form>
        </div>
    );
}
