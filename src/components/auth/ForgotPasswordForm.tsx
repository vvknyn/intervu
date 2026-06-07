"use client";

import { useState } from "react";
import { sendResetEmail } from "@/lib/firebase/client-auth";
import { CircleNotch, EnvelopeSimple, ArrowLeft } from "@phosphor-icons/react";

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
        try {
            // Firebase's native password-reset flow: emails an oobCode link that
            // lands on /reset-password, where ResetPasswordForm calls confirmReset.
            await sendResetEmail(trimmed);
            setSent(true);
        } catch (err: unknown) {
            // Don't leak whether the account exists — Firebase returns
            // auth/user-not-found, but we still show the neutral success screen
            // for that case to avoid account enumeration. Surface only real errors.
            const code = (err as { code?: string })?.code;
            if (code === "auth/user-not-found" || code === "auth/invalid-email") {
                setSent(true);
            } else {
                setError(
                    (err as { message?: string })?.message ||
                        "Could not send reset email. Please try again.",
                );
            }
        } finally {
            setIsPending(false);
        }
    };

    if (sent) {
        return (
            <div className="w-full max-w-xs mx-auto text-center">
                <div className="mb-6 flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <EnvelopeSimple size={24} className="text-foreground" />
                    </div>
                </div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                    Check your email
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                    If an account with that email exists, we&apos;ve sent a password reset link to it.
                </p>
                <button
                    onClick={onBack}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                >
                    Back to login
                </button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-xs mx-auto">
            <div className="mb-8">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors mb-4"
                >
                    <ArrowLeft size={12} />
                    Back
                </button>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white text-center">
                    Reset password
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">
                    Enter the email on your account to receive a reset link
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                    <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        className="block w-full border-b border-slate-300 bg-transparent py-2 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:text-white"
                    />
                </div>

                {error && (
                    <div className="mt-2 text-xs text-red-500 text-center">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isPending}
                    className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 mt-6"
                >
                    {isPending ? (
                        <CircleNotch size={16} className="mx-auto animate-spin" />
                    ) : (
                        "Send reset link"
                    )}
                </button>
            </form>
        </div>
    );
}
