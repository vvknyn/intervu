"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmReset } from "@/lib/firebase/client-auth";
import { CircleNotch, CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

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
                        <div className="w-12 h-12 bg-verdict-good-bg flex items-center justify-center">
                            <CheckCircle size={24} weight="fill" className="text-verdict-good" />
                        </div>
                    </div>
                    <h2 className="text-lg font-semibold text-foreground mb-2">
                        Password updated
                    </h2>
                    <p className="text-sm text-muted-foreground">
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
                    <h1 className="text-lg font-semibold text-foreground">
                        Set new password
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        Enter your new password below
                    </p>
                </div>

                {!oobCode && (
                    <div className="mb-4 text-xs text-warn text-center">
                        This page should be opened from the link in your reset email.
                    </div>
                )}

                {oobCode && (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <Field label="New password" htmlFor="reset-password-new">
                        <div className="relative">
                            <Input
                                id="reset-password-new"
                                name="password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                required
                                minLength={6}
                                className="pr-14"
                            />
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setShowPassword((show) => !show)}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {showPassword ? "Hide" : "Show"}
                            </button>
                        </div>
                    </Field>

                    <Field label="Confirm password" htmlFor="reset-password-confirm">
                        <div className="relative">
                            <Input
                                id="reset-password-confirm"
                                name="confirmPassword"
                                type={showConfirmPassword ? "text" : "password"}
                                autoComplete="new-password"
                                required
                                minLength={6}
                                className="pr-14"
                            />
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setShowConfirmPassword((show) => !show)}
                                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {showConfirmPassword ? "Hide" : "Show"}
                            </button>
                        </div>
                    </Field>

                    {error && (
                        <div className="mt-2 text-xs text-destructive text-center">
                            {error}
                        </div>
                    )}

                    <Button type="submit" variant="brand" disabled={isPending || !oobCode} className="w-full mt-6">
                        {isPending ? (
                            <CircleNotch size={16} className="animate-spin" />
                        ) : (
                            "Update password"
                        )}
                    </Button>
                </form>
                )}
            </div>
        </div>
    );
}
