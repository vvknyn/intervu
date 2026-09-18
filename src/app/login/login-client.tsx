"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { validateNextParam } from "@/lib/auth/product-routes";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { captureEvent } from "@/lib/analytics/events";

export function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        return onAuthChange(setUser);
    }, []);

    // Dedicated /login route — count once on mount; LoginForm is not wired
    // here (AuthPopover owns the in-app chokepoint and would double-count).
    useEffect(() => {
        captureEvent("auth_started", { reason: "generic" });
    }, []);

    const redirectAfterAuth = useCallback(() => {
        router.replace(validateNextParam(searchParams.get("next")) ?? "/jobs");
    }, [router, searchParams]);

    useEffect(() => {
        if (user) redirectAfterAuth();
    }, [user, redirectAfterAuth]);

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center px-5 pb-12 below-topbar">
            <div className="w-full max-w-100 rounded-panel border border-border bg-card p-8">
                <LoginForm onSuccess={redirectAfterAuth} />
            </div>
        </div>
    );
}
