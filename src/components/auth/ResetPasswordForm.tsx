"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmReset } from "@/lib/firebase/client-auth";
import { CircleNotch, CheckCircle } from "@phosphor-icons/react";

export function ResetPasswordForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    // Firebase's reset link appends ?oobCode=...&mode=resetPassword to our continue URL.
    const oobCode = searchParams.get("oobCode");

    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    useEffect(() => {
        if (success) {
            const timer = setTimeout(() => {
                router.push("/");
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [success, router]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const password = (form.elements.namedItem("password") as HTMLInputElement)?.value?.trim() || "";
        const confirmPassword =
            (form.elements.namedItem("confirmPassword") as HTMLInputElement)?.value?.trim() || "";

        if (!password || !confirmPassword) {
            setError("Both password fields are required");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }
        if (password.length < 6) {
            setError("Password must be at least 6 characters");
            return;
        }
        if (!oobCode) {
            setError("This reset link is invalid or has expired. Please request a new one.");
            return;
        }

        setIsPending(true);
        setError(null);
        try {
            await confirmReset(oobCode, password);
            setSuccess(true);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") {
                setError("This reset link is invalid or has expired. Please request a new one.");
            } else if (code === "auth/weak-password") {
                setError("Password is too weak. Please choose a stronger one.");
            } else {
                setError((err as { message?: string })?.message || "Could not reset password. Please try again.");
            }
        } finally {
            setIsPending(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4">
                <div className="w-full max-w-xs text-center">
                    <div className="mb-6 flex justify-center">
                        <div className="w-12 h-12 rounded-none bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
                            <CheckCircle size={24} weight="fill" className="text-green-600 dark:text-green-400" />
                        </div>
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                        Password updated
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Redirecting you to the app...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-xs">
                <div className="mb-8 text-center">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Set new password
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Enter your new password below
                    </p>
                </div>

                {!oobCode && (
                    <div className="mb-4 text-xs text-amber-600 dark:text-amber-400 text-center">
                        This page should be opened from the link in your reset email.
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1">
                        <div className="relative">
                            <input
                                name="password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                required
                                placeholder="New password"
                                minLength={6}
                                className="block w-full border-b border-slate-300 bg-transparent py-2 pr-12 text-sm placeholder:text-slate-400 focus:border-foreground focus:outline-none dark:border-slate-700 dark:text-white"
                            />
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setShowPassword((show) => !show)}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                className="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-foreground dark:text-slate-500"
                            >
                                {showPassword ? "Hide" : "Show"}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="relative">
                            <input
                                name="confirmPassword"
                                type={showConfirmPassword ? "text" : "password"}
                                autoComplete="new-password"
                                required
                                placeholder="Confirm password"
                                minLength={6}
                                className="block w-full border-b border-slate-300 bg-transparent py-2 pr-12 text-sm placeholder:text-slate-400 focus:border-foreground focus:outline-none dark:border-slate-700 dark:text-white"
                            />
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setShowConfirmPassword((show) => !show)}
                                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                                className="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-foreground dark:text-slate-500"
                            >
                                {showConfirmPassword ? "Hide" : "Show"}
                            </button>
                        </div>
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
                            "Update password"
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
