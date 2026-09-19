"use client";

import { useEffect, useRef, useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/events";
import { AUTH_CTA_LABEL, type AuthGateReason, type AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import { canShowAutoNudge, markAutoNudgeShown, recordNudgeDismissed } from "@/lib/auth/nudge-cap";
import { type NudgeDecision, type NudgeGateState, decideNudgeOnce, nudgeGateNext, shouldRecordDismiss } from "@/lib/auth/nudge-gate";

interface AuthPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    showTrigger?: boolean;
    /**
     * Fired on a *successful* sign-in, BEFORE the popover closes — giving the
     * parent a deterministic success signal it cannot otherwise distinguish
     * from a dismiss (a dismiss and a success both just call `onOpenChange(false)`).
     * Optional and backward-compatible: callers that don't pass it (e.g.
     * WelcomeStep) are unaffected. /jobs uses it to decide whether a queued
     * post-auth action may replay (success) or must be cleared (dismiss).
     */
    onAuthed?: () => void;
    /**
     * Optional value-prop line rendered at the top of the modal frame, above
     * the login/sign-up form (docs-mockup.html Comp K). Lets a caller (e.g.
     * /jobs's apply-gate) explain WHY the account is needed without having
     * to render its own separate overlay above this dialog.
     */
    valueLine?: React.ReactNode;
    /** Initial login-form tab — signup for apply gates, login otherwise. */
    defaultTab?: "login" | "signup";
    /** Auth-gate reason class for auth_started telemetry — omit for generic. */
    reason?: AuthGateReason;
    /**
     * Who is opening this popover — required, no default, so every call
     * site has to state its intent (a stray auto-open can't silently pass
     * as a real funnel start again). "user": a deliberate sign-in click
     * (Sign in button, a banner's "sign in" link, a method button).
     * "auto": the product opened it as a side effect of a gated action
     * (guest Apply, a second guest Save, ...). "user" fires `auth_started`;
     * "auto" fires `auth_nudge_shown` instead, and is subject to the
     * once-per-session / 7-day-after-dismiss cap in `nudge-cap.ts`.
     */
    trigger: AuthGateTrigger;
}

export function AuthPopover({ open, onOpenChange, showTrigger = true, onAuthed, valueLine, defaultTab = "login", reason, trigger }: AuthPopoverProps) {
    const succeededRef = useRef(false);
    const effectiveReason = reason ?? "generic";
    const [gate, setGate] = useState<NudgeGateState>("idle");
    // The record this popover instance actually decided FOR — reason and
    // trigger as they were at decision time, not whatever `props` say when
    // the consequence (marking shown, recording a dismiss) later runs. A
    // ref, not state: it must survive React StrictMode's synchronous
    // double-invoke of this effect (both invocations close over the same
    // pre-commit `gate === "idle"`), and `decideNudgeOnce` makes the second
    // invocation a no-op instead of a re-decide. See nudge-gate.ts.
    const decisionRef = useRef<NudgeDecision | null>(null);

    // The auto-nudge cap (nudge-cap.ts) is decided once per open
    // TRANSITION, not on every render: /jobs re-renders constantly, and
    // re-deciding on each render burned the 7-day dismiss suppression on
    // phantom closes nobody made (see nudge-gate.ts). A suppressed nudge
    // never reaches the DOM: the gated action it followed (e.g. opening
    // the ATS tab) already ran, so silently not showing the popover on
    // top of it is correct, not a broken UI.
    useEffect(() => {
        if (open && gate === "idle") {
            const alreadyDecided = decisionRef.current !== null;
            decisionRef.current = decideNudgeOnce(decisionRef.current, { reason: effectiveReason, trigger });
            if (alreadyDecided) {
                // StrictMode's synchronous double-invoke of this same open
                // transition (both invocations close over the same
                // pre-commit `gate === "idle"`) — the first invocation
                // already decided and acted; this one is a no-op.
                return;
            }
            const decision = decisionRef.current;
            const allowed = trigger !== "auto" || canShowAutoNudge(effectiveReason);
            const next = nudgeGateNext(gate, { type: "open", trigger, allowed });
            if (next === "shown") {
                if (trigger === "auto") markAutoNudgeShown(decision.reason);
                // Literal call per branch (not a resolveAuthOpenEvent() return
                // value passed through as a variable) so the analytics wiring
                // scan can see both real wire names are actually fired.
                // resolveAuthOpenEvent (auth-gate-copy.ts) is the single source
                // of truth this branch mirrors: "auto" trigger → nudge, "user" → started.
                if (trigger === "auto") {
                    captureEvent("auth_nudge_shown", { reason: decision.reason });
                } else {
                    captureEvent("auth_started", { reason: decision.reason });
                }
            } else {
                // Suppressed: tell the parent so its own `open` state
                // doesn't stay stuck true for a popover that never shows.
                onOpenChange(false);
            }
            setGate(next);
            return;
        }
        if (!open && gate !== "idle") {
            const next = nudgeGateNext(gate, { type: "close" });
            // Closing without a preceding success is a dismiss — only
            // counts toward the auto-nudge cap; a user who opened this
            // themselves and backed out isn't "nudge fatigue". Recorded
            // for the reason this popover instance was decided for, not
            // whatever `reason` prop the parent has swapped to since.
            if (shouldRecordDismiss(gate, next) && decisionRef.current?.trigger === "auto" && !succeededRef.current) {
                recordNudgeDismissed(decisionRef.current.reason);
            }
            succeededRef.current = false;
            decisionRef.current = null;
            setGate(next);
        }
    }, [open, gate, trigger, effectiveReason, onOpenChange]);

    const effectiveOpen = gate === "shown";

    const handleSuccess = () => {
        succeededRef.current = true;
        onAuthed?.();
        onOpenChange(false);
    };

    const valueLineNode = valueLine && (
        <p className="mb-4 text-sm leading-normal text-muted-foreground">{valueLine}</p>
    );

    // When no trigger, use a Dialog instead (e.g. programmatic open from buttons)
    if (!showTrigger) {
        return (
            <Dialog open={effectiveOpen} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-105 max-h-[min(92dvh,640px)] overflow-y-auto overscroll-contain p-5 sm:p-6 pt-7 sm:pt-8 rounded-panel border border-border bg-card">
                    <DialogTitle className="sr-only">Authentication</DialogTitle>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} />
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Popover open={effectiveOpen} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                    {AUTH_CTA_LABEL}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-105 max-h-[min(92dvh,640px)] overflow-y-auto overscroll-contain p-5 sm:p-6 pt-7 sm:pt-8 rounded-panel border border-border bg-card">
                <div>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} />
                </div>
            </PopoverContent>
        </Popover>
    );
}
