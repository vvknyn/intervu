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
import { captureEvent } from "@/lib/analytics/events";
import { buildAuthOpenPayload } from "@/lib/analytics/auth-event-payload";
import {
    beginGateAttempt,
    gateAttemptEventFields,
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
        const existing = readGateAttempt(window.sessionStorage);
        if (existing) {
            captureEvent("auth_started", buildAuthOpenPayload(existing.lastGateReason, {
                ...gateAttemptEventFields(existing),
                origin_surface: existing.originSurface,
                trigger_type: "user",
                pending_action_id: existing.pendingActionId,
                return_to: existing.returnTo,
                job_id: existing.jobId,
            }));
            return;
        }
        beginGateAttempt(window.sessionStorage, {
            reason: "topbar",
            originSurface: "login",
            returnTo: validateNextParam(searchParams.get("next")) ?? undefined,
        });
        captureEvent("auth_started", buildAuthOpenPayload("topbar", {
            origin_surface: "login",
            trigger_type: "user",
        }));
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
