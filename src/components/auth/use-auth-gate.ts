"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthChange } from "@/lib/firebase/client-auth";
import { beginGateAttempt, type OriginSurface } from "@/lib/auth/gate-attempt";
import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import {
    buildReturnTo,
    clearPersistedPendingAction,
    persistPendingAction,
    takePersistedPendingAction,
    type PendingAction,
} from "@/lib/jobs/pending-actions";

export type AuthGateHandlers<Apply> = {
    [K in PendingAction<Apply>["kind"]]: (
        action: Extract<PendingAction<Apply>, { kind: K }>,
    ) => void | Promise<void>;
};

export interface UseAuthGateResult<Apply> {
    gate: (action: PendingAction<Apply>, meta?: { originSurface?: OriginSurface; gateReason?: string }) => void;
    authOpen: boolean;
    setAuthOpen: (open: boolean) => void;
    onAuthed: () => void;
}

function runHandler<Apply>(
    handlers: AuthGateHandlers<Apply>,
    action: PendingAction<Apply>,
): void {
    const handler = handlers[action.kind] as
        | ((a: PendingAction<Apply>) => void | Promise<void>)
        | undefined;
    if (!handler) return;
    void handler(action);
}

export function useAuthGate<Apply>({
    handlers,
    user,
    onGateOpen,
}: {
    handlers: AuthGateHandlers<Apply>;
    user: unknown;
    /** Runs just before `gate()` opens the dialog, with the reason it was
     *  given, so the host can title it ("Sign in to apply"). */
    onGateOpen?: (reason: AuthGateReason) => void;
}): UseAuthGateResult<Apply> {
    const [authOpen, setAuthOpenState] = useState(false);
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    const userRef = useRef(user);
    userRef.current = user;
    const onGateOpenRef = useRef(onGateOpen);
    onGateOpenRef.current = onGateOpen;
    // The auth listener of a `gate()` still waiting for its first answer.
    const pendingGateUnsubRef = useRef<(() => void) | null>(null);
    const dropPendingGate = useCallback(() => {
        pendingGateUnsubRef.current?.();
        pendingGateUnsubRef.current = null;
    }, []);
    useEffect(() => dropPendingGate, [dropPendingGate]);

    const setAuthOpen = useCallback((open: boolean) => {
        setAuthOpenState(open);
        if (!open) {
            clearPersistedPendingAction(window.sessionStorage);
            dropPendingGate();
        }
    }, [dropPendingGate]);

    const replayPersisted = useCallback(() => {
        const persisted = takePersistedPendingAction<Apply>(window.sessionStorage, {
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
        (action: PendingAction<Apply>, meta?: { originSurface?: OriginSurface; gateReason?: string }) => {
            if (userRef.current) {
                runHandler(handlersRef.current, action);
                return;
            }
            dropPendingGate();
            // One answer per click. Every later session check notifies every
            // listener, so a listener kept past its first answer reopened a
            // dialog the visitor had closed, and replayed the abandoned action
            // on a later sign-in. After the dialog opens, its own `onAuthed`
            // and the persisted action carry the step to the end.
            let settled = false;
            let unsubscribe: (() => void) | null = null;
            unsubscribe = onAuthChange((user) => {
                if (settled) return;
                settled = true;
                if (unsubscribe) {
                    unsubscribe();
                    if (pendingGateUnsubRef.current === unsubscribe) pendingGateUnsubRef.current = null;
                }
                if (user) {
                    runHandler(handlersRef.current, action);
                    return;
                }
                const reason = (meta?.gateReason as AuthGateReason | undefined) ?? "generic";
                const attempt = beginGateAttempt(window.sessionStorage, {
                    reason,
                    originSurface: meta?.originSurface ?? "job_detail",
                    returnTo: buildReturnTo(window.location),
                    jobId:
                        action.kind === "apply" ? (action.payload as { id?: string })?.id : undefined,
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
                onGateOpenRef.current?.(reason);
                setAuthOpenState(true);
            });
            // The answer can arrive synchronously, before `unsubscribe` exists.
            if (settled) unsubscribe();
            else pendingGateUnsubRef.current = unsubscribe;
        },
        [dropPendingGate],
    );

    const onAuthed = useCallback(() => {
        replayPersisted();
    }, [replayPersisted]);

    return { gate, authOpen, setAuthOpen, onAuthed };
}
