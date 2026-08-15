"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkUsernameAvailability } from "@/actions/auth";
import { signInWithUsername, signUpWithUsername } from "@/lib/firebase/client-auth";
import { CircleNotch } from "@phosphor-icons/react";
import { useDebouncedCallback } from "use-debounce";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export function SimpleAuthForm() {
    const router = useRouter();
    const [isLogin, setIsLogin] = useState(true);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [availability, setAvailability] = useState<{ available?: boolean; checking?: boolean; message?: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const checkAvailability = useDebouncedCallback(async (value: string) => {
        if (!value || value.length < 3) {
            setAvailability(null);
            return;
        }
        setAvailability({ checking: true });
        const result = await checkUsernameAvailability(value);
        setAvailability({ ...result, checking: false });
    }, 500);

    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setUsername(value);
        if (!isLogin) {
            checkAvailability(value);
        } else {
            setAvailability(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) {
            setError("Username and password are required");
            return;
        }

        setError(null);
        startTransition(async () => {
            try {
                if (isLogin) {
                    await signInWithUsername(username, password);
                } else {
                    // Create profile on server first, then sign in client-side
                    const formData = new FormData();
                    formData.append("username", username);
                    formData.append("password", password);
                    const { signUp } = await import("@/actions/auth");
                    const result = await signUp(null, formData);
                    if (result?.error) {
                        setError(result.error);
                        return;
                    }
                    // Now sign in client-side to create session
                    await signInWithUsername(username, password);
                }
                router.refresh();
            } catch (err: any) {
                const msg = err?.message || "Authentication failed";
                if (msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password") || msg.includes("auth/user-not-found")) {
                    setError("Invalid username or password");
                } else if (msg.includes("auth/email-already-in-use")) {
                    setError("Username is already taken");
                } else if (msg.includes("auth/weak-password")) {
                    setError("Password must be at least 6 characters");
                } else {
                    setError(msg);
                }
            }
        });
    };

    if (showForgotPassword) {
        return <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />;
    }

    return (
        <div className="w-full max-w-xs mx-auto">
            <div className="mb-8 text-center">
                <h2 className="text-lg font-semibold text-foreground">
                    {isLogin ? "Welcome back" : "Create account"}
                </h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                    <input
                        id="username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        required
                        placeholder="Username"
                        value={username}
                        onChange={handleUsernameChange}
                        className={`block w-full border-b bg-transparent py-2 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none
                            ${availability?.available === false && !isLogin ? 'border-destructive/50 focus:border-destructive' : 'border-border'}
                            ${availability?.available === true && !isLogin ? 'border-green-300 focus:border-green-500' : ''}
                        `}
                    />
                    {!isLogin && username.length >= 3 && (
                        <div className="flex items-center justify-end h-4">
                            {availability?.checking ? (
                                <CircleNotch size={12} className="animate-spin text-faint" />
                            ) : availability?.available ? (
                                <span className="text-[10px] text-green-500 font-medium">Available</span>
                            ) : availability?.available === false ? (
                                <span className="text-[10px] text-destructive font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-full block">
                                    {availability.message || "Taken"}
                                </span>
                            ) : null}
                        </div>
                    )}
                </div>

                <div className="space-y-1">
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete={isLogin ? "current-password" : "new-password"}
                        required
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="block w-full border-b border-border bg-transparent py-2 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none"
                    />
                </div>

                {error && (
                    <div className="mt-2 text-xs text-destructive text-center">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isPending || (!isLogin && availability?.available !== true && username.length > 0)}
                    className="w-full rounded bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed mt-6"
                >
                    {isPending ? (
                        <CircleNotch size={16} className="mx-auto animate-spin" />
                    ) : (
                        isLogin ? "Enter" : "Join"
                    )}
                </button>

                {isLogin && (
                    <div className="text-center mt-3">
                        <button
                            type="button"
                            onClick={() => setShowForgotPassword(true)}
                            className="text-[10px] text-brand hover:underline"
                        >
                            Forgot password?
                        </button>
                    </div>
                )}
            </form>

            <div className="mt-6 text-center">
                <button
                    onClick={() => {
                        setIsLogin(!isLogin);
                        setUsername("");
                        setPassword("");
                        setAvailability(null);
                        setError(null);
                    }}
                    className="text-xs text-faint hover:text-foreground transition-colors"
                >
                    {isLogin ? "Need an account?" : "Have an account?"}
                </button>
            </div>
        </div>
    );
}
