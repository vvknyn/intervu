"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { validateNextParam } from "@/lib/auth/product-routes";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";

export function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        return onAuthChange(setUser);
    }, []);

    const redirectAfterAuth = useCallback(() => {
        router.replace(validateNextParam(searchParams.get("next")) ?? "/jobs");
    }, [router, searchParams]);

    useEffect(() => {
        if (user) redirectAfterAuth();
    }, [user, redirectAfterAuth]);

    return (
        <main className="flex min-h-dvh flex-col items-center justify-center px-5 pb-12 pt-[72px]">
            <div className="w-full max-w-[400px] border border-border bg-card p-6 pt-7">
                <LoginForm onSuccess={redirectAfterAuth} />
            </div>
        </main>
    );
}
