"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { AuthRaisedPanel, AuthRouteLayout } from "@/components/auth/auth-route-chrome";
import { hasUsableResumeOnFile } from "@/actions/resume";
import { resolvePostAuthDestination } from "@/lib/auth/post-auth-destination";
import { validateNextParam } from "@/lib/auth/product-routes";
import { peekPendingActionKind } from "@/lib/jobs/pending-actions";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    beginGateAttempt,
    readGateAttempt,
} from "@/lib/auth/gate-attempt";

export function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        return onAuthChange(setUser);
    }, []);

    useEffect(() => {
        // Continuity only. Opening /login is not auth_started; the form
        // fires that when the user engages a method. A topbar attempt is
        // begun here so that engagement still carries reason "topbar".
        const existing = readGateAttempt(window.sessionStorage);
        if (existing) return;
        beginGateAttempt(window.sessionStorage, {
            reason: "topbar",
            originSurface: "login",
            returnTo: validateNextParam(searchParams.get("next")) ?? undefined,
        });
    }, [searchParams]);

    const redirectAfterAuth = useCallback(async () => {
        const validatedNext = validateNextParam(searchParams.get("next"));
        const hasPendingAction = peekPendingActionKind(window.sessionStorage) !== null;
        const { hasResume } = await hasUsableResumeOnFile();
        const destination = resolvePostAuthDestination({
            validatedNext,
            hasResume,
            hasPendingAction,
        });
        router.replace(destination);
    }, [router, searchParams]);

    useEffect(() => {
        if (user) void redirectAfterAuth();
    }, [user, redirectAfterAuth]);

    return (
        <AuthRouteLayout>
            <AuthRaisedPanel>
                <LoginForm onSuccess={redirectAfterAuth} />
            </AuthRaisedPanel>
        </AuthRouteLayout>
    );
}
