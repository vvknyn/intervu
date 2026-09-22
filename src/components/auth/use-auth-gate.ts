"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthChange } from "@/lib/firebase/client-auth";
import { beginGateAttempt, type OriginSurface } from "@/lib/auth/gate-attempt";
import {
    buildReturnTo,
    clearPersistedPendingAction,
    persistPendingAction,
    takePersistedPendingAction,
    type PendingAction,
} from "@/lib/jobs/pending-actions";

export type AuthGateHandlers<Apply, Report> = {
    [K in PendingAction<Apply, Report>["kind"]]: (
        action: Extract<PendingAction<Apply, Report>, { kind: K }>,
    ) => void | Promise<void>;
};

export interface UseAuthGateResult<Apply, Report> {
    gate: (action: PendingAction<Apply, Report>, meta?: { originSurface?: OriginSurface; gateReason?: string }) => void;
    authOpen: boolean;
    setAuthOpen: (open: boolean) => void;
    onAuthed: () => void;
}

function runHandler<Apply, Report>(
    handlers: AuthGateHandlers<Apply, Report>,
    action: PendingAction<Apply, Report>,
): void {
    const handler = handlers[action.kind] as
        | ((a: PendingAction<Apply, Report>) => void | Promise<void>)
        | undefined;
    if (!handler) return;
    void handler(action);
}

export function useAuthGate<Apply, Report = Apply>({
    handlers,
    user,
}: {
    handlers: AuthGateHandlers<Apply, Report>;
    user: unknown;
}): UseAuthGateResult<Apply, Report> {
    const [authOpen, setAuthOpenState] = useState(false);
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    const userRef = useRef(user);
    userRef.current = user;

    const setAuthOpen = useCallback((open: boolean) => {
        setAuthOpenState(open);
        if (!open) {
            clearPersistedPendingAction(window.sessionStorage);
        }
    }, []);

    const replayPersisted = useCallback(() => {
        const persisted = takePersistedPendingAction<Apply, Report>(window.sessionStorage, {
            currentPath: window.location.pathname,
            now: Date.now(),
        });
        if (!persisted) return;
        window.scrollTo(0, persisted.scrollY);
        runHandler(handlersRef.current, persisted.action);
    }, []);

    useEffect(() => {
        return onAuthChange((user) => {
            if (user) replayPersisted();
        });
    }, [replayPersisted]);

    const gate = useCallback(
        (action: PendingAction<Apply, Report>, meta?: { originSurface?: OriginSurface; gateReason?: string }) => {
            if (userRef.current) {
                runHandler(handlersRef.current, action);
                return;
            }
            onAuthChange((user) => {
                if (user) {
                    runHandler(handlersRef.current, action);
                    return;
                }
                const attempt = beginGateAttempt(window.sessionStorage, {
                    reason: (meta?.gateReason as import("@/lib/auth/auth-gate-copy").AuthGateReason) ?? "generic",
                    originSurface: meta?.originSurface ?? "job_detail",
                    returnTo: buildReturnTo(window.location),
                    jobId:
                        action.kind === "apply" || action.kind === "report"
                            ? (action.payload as { id?: string })?.id
                            : undefined,
                });
                persistPendingAction(window.sessionStorage, {
                    action,
                    returnTo: buildReturnTo(window.location),
                    scrollY: window.scrollY,
                    createdAt: Date.now(),
                    pendingActionId: attempt.pendingActionId,
                    gateReason: attempt.lastGateReason,
                    firstGateReason: attempt.firstGateReason,
                    lastGateReason: attempt.lastGateReason,
                    originSurface: attempt.originSurface,
                });
                setAuthOpen(true);
            });
        },
        [setAuthOpen],
    );

    const onAuthed = useCallback(() => {
        replayPersisted();
    }, [replayPersisted]);

    return { gate, authOpen, setAuthOpen, onAuthed };
}
