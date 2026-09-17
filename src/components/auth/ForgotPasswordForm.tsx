"use client";

import { useState } from "react";
import { requestPasswordResetAction } from "@/actions/auth";
import { CircleNotch, EnvelopeSimple, ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

interface ForgotPasswordFormProps {
    onBack: () => void;
}

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
    const [email, setEmail] = useState("");
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim();
        if (!trimmed) {
            setError("Email is required");
            return;
        }
        setIsPending(true);
        setError(null);
        // `requestPasswordResetAction` always resolves `{success: true}` — it
        // never reveals whether `trimmed` belongs to an account, so there is
        // no error branch to sniff here (the try/catch this replaced existed
        // only to force Firebase's `auth/user-not-found` into this same
        // neutral screen). WorkOS mints the token and emails the link that
        // lands on /reset-password, where ResetPasswordForm calls
        // confirmPasswordResetAction.
        await requestPasswordResetAction({ email: trimmed });
        setSent(true);
        setIsPending(false);
    };

    if (sent) {
        return (
            <div className="w-full max-w-xs mx-auto text-center">
                <div className="mb-6 flex justify-center">
                    <div className="w-12 h-12 rounded-none bg-muted flex items-center justify-center">
                        <EnvelopeSimple size={24} className="text-foreground" />
                    </div>
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2">
                    Check your email
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                    If an account with that email exists, we&apos;ve sent a password reset link to it.
                </p>
                <button
                    onClick={onBack}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    Back to sign in
                </button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-xs mx-auto">
            <div className="mb-8">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                    <ArrowLeft />
                    Back
                </button>
                <h2 className="text-lg font-semibold text-foreground text-center">
                    Reset password
                </h2>
                <p className="text-xs text-muted-foreground text-center mt-1">
                    Enter the email on your account to receive a reset link
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Email" htmlFor="forgot-password-email">
                    <Input
                        id="forgot-password-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </Field>

                {error && (
                    <div className="mt-2 text-xs text-danger-text text-center">
                        {error}
                    </div>
                )}

                <Button type="submit" variant="brand" disabled={isPending} className="w-full mt-6">
                    {isPending ? (
                        <CircleNotch size={16} className="animate-spin" />
                    ) : (
                        "Send reset link"
                    )}
                </Button>
            </form>
        </div>
    );
}
