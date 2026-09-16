"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthChange } from "@/lib/firebase/client-auth";
import {
    buildReturnTo,
    clearPersistedPendingAction,
    persistPendingAction,
    takePersistedPendingAction,
    type PendingAction,
} from "@/lib/jobs/pending-actions";

/**
 * The one auth gate: gate any action behind sign-in, survive both ways a
 * user can authenticate, and replay the action exactly once.
 *
 * Two return paths existed before this hook and both had to keep working:
 *
 *   - In-place username/password login (`login-form.tsx`'s `handleLogin`)
 *     never navigates — the component that called `gate()` is still mounted,
 *     so an in-memory ref was enough to remember what to do next.
 *   - WorkOS AuthKit for Google/passkeys is a hard navigation
 *     (`window.location.href = "/auth/start?..."`) — the whole document
 *     reloads, so any in-memory ref is gone by the time the user is back.
 *
 * Rather than keep two mechanisms in lockstep (one more state to desync),
 * this hook has exactly one: `sessionStorage`, tab-scoped and synchronous, so
 * it covers the in-place case (write, then read back moments later, same
 * tab) for free while also surviving the hard-nav round trip the in-memory
 * ref never could. See `persistPendingAction` / `takePersistedPendingAction`
 * in `lib/jobs/pending-actions.ts`.
 */

/**
 * One handler per `PendingAction` kind, each typed to receive only its own
 * action variant. Dispatch (`runHandler` below) looks the handler up by
 * `action.kind` — adding a kind to `PendingAction` is a type error here
 * until every caller supplies a handler for it, rather than a silently
 * unhandled case in an enumerated switch.
 */
export type AuthGateHandlers<Apply, Gate, Report> = {
    [K in PendingAction<Apply, Gate, Report>["kind"]]: (
        action: Extract<PendingAction<Apply, Gate, Report>, { kind: K }>,
    ) => void | Promise<void>;
};

export interface UseAuthGateResult<Apply, Gate, Report> {
    /** Signed in → run the action's handler immediately, no dialog. Signed
     *  out → persist the action and open the auth modal. */
    gate: (action: PendingAction<Apply, Gate, Report>) => void;
    authOpen: boolean;
    /** Setting this to `false` also clears any persisted action — covers
     *  both the popover's own dismiss and a page dismissing the gate on an
     *  alternate path (e.g. the user started a different action). */
    setAuthOpen: (open: boolean) => void;
    /** Wire to the auth popover's `onAuthed` — fires on a successful
     *  in-place login, before the popover closes. */
    onAuthed: () => void;
}

function runHandler<Apply, Gate, Report>(
    handlers: AuthGateHandlers<Apply, Gate, Report>,
    action: PendingAction<Apply, Gate, Report>,
): void {
    // One cast at the single dispatch chokepoint: TS can't carry the
    // Extract<...> narrowing through a generic indexed lookup, but the
    // key/value pairing is exactly what `AuthGateHandlers` enforces at every
    // call site that builds one. A page registering only a SUBSET of
    // handlers (or a persisted record surviving a deploy that dropped a
    // kind) must not crash a `useEffect`/event-handler callback — no
    // matching handler is a no-op, not a throw.
    const handler = handlers[action.kind] as
        | ((a: PendingAction<Apply, Gate, Report>) => void | Promise<void>)
        | undefined;
    if (!handler) return;
    void handler(action);
}

export function useAuthGate<Apply, Gate, Report = Gate>({
    handlers,
    user,
}: {
    handlers: AuthGateHandlers<Apply, Gate, Report>;
    /** The page's already-known signed-in state (whatever it fills via its
     *  own `onAuthChange(setUser)` subscription). Truthy here lets `gate()`
     *  run the handler synchronously with no `/api/auth/session` round trip;
     *  falsy falls back to asking the server, since a page's `user` state can
     *  still be null on first paint even when a real session exists. */
    user: unknown;
}): UseAuthGateResult<Apply, Gate, Report> {
    const [authOpen, setAuthOpenState] = useState(false);
    // Handlers close over page state (job lists, telemetry, dialogs) that
    // changes every render; a ref keeps the callbacks below stable identities
    // without forcing every caller to `useCallback` its whole handlers object.
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    // Same ref idiom as `handlersRef` — `gate` must see the LATEST `user`
    // without itself being recreated (and re-triggering effects) every time
    // the page's auth state changes render to render.
    const userRef = useRef(user);
    userRef.current = user;

    const setAuthOpen = useCallback((open: boolean) => {
        setAuthOpenState(open);
        if (!open) clearPersistedPendingAction(window.sessionStorage);
    }, []);

    const replayPersisted = useCallback(() => {
        const persisted = takePersistedPendingAction<Apply, Gate, Report>(window.sessionStorage, {
            currentPath: window.location.pathname,
            now: Date.now(),
        });
        if (!persisted) return;
        window.scrollTo(0, persisted.scrollY);
        runHandler(handlersRef.current, persisted.action);
    }, []);

    // OAuth/passkey return: this is a fresh mount after a hard navigation, so
    // no in-memory state survived the trip — sessionStorage is the only place
    // a queued action could still be. `onAuthChange` is itself a one-shot
    // server lookup (see client-auth.ts), so its first callback here IS "the
    // first signed-in signal" for a freshly-loaded page.
    useEffect(() => {
        return onAuthChange((user) => {
            if (user) replayPersisted();
        });
    }, [replayPersisted]);

    const gate = useCallback(
        (action: PendingAction<Apply, Gate, Report>) => {
            // Sync fast path: the caller already knows it's signed in (its
            // own `onAuthChange` subscription already resolved), so skip the
            // round trip entirely instead of paying one on every gated click
            // regardless of auth state.
            if (userRef.current) {
                runHandler(handlersRef.current, action);
                return;
            }
            onAuthChange((user) => {
                if (user) {
                    runHandler(handlersRef.current, action);
                    return;
                }
                persistPendingAction(window.sessionStorage, {
                    action,
                    returnTo: buildReturnTo(window.location),
                    scrollY: window.scrollY,
                    createdAt: Date.now(),
                });
                setAuthOpen(true);
            });
        },
        [setAuthOpen],
    );

    // In-place login: no navigation happened, so this is the same tab/session
    // that just persisted the action — the take-and-replay path is identical
    // to the OAuth/passkey return above.
    const onAuthed = useCallback(() => {
        replayPersisted();
    }, [replayPersisted]);

    return { gate, authOpen, setAuthOpen, onAuthed };
}
