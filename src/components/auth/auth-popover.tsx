"use client";

import { useEffect, useRef } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/events";
import {
    type AuthGateReason,
    type AuthGateTrigger,
    resolveAuthOpenEvent,
    shouldCaptureAuthStarted,
} from "@/lib/auth/auth-gate-copy";
import { recordNudgeDismissed, shouldShowAutoNudge } from "@/lib/auth/nudge-cap";

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
     * (Log In button, a banner's "sign in" link, a method button).
     * "auto": the product opened it as a side effect of a gated action
     * (guest Apply, a second guest Save, ...). "user" fires `auth_started`;
     * "auto" fires `auth_nudge_shown` instead, and is subject to the
     * once-per-session / 7-day-after-dismiss cap in `nudge-cap.ts`.
     */
    trigger: AuthGateTrigger;
}

export function AuthPopover({ open, onOpenChange, showTrigger = true, onAuthed, valueLine, defaultTab = "login", reason, trigger }: AuthPopoverProps) {
    const wasOpenRef = useRef(false);
    const succeededRef = useRef(false);
    const effectiveReason = reason ?? "generic";

    // An auto-triggered open is capped — see nudge-cap.ts. A suppressed
    // nudge never reaches the DOM: the gated action it followed (e.g.
    // opening the ATS tab) already ran, so silently not showing the
    // popover on top of it is correct, not a broken UI.
    const suppressed = trigger === "auto" && open && !shouldShowAutoNudge(effectiveReason);
    const effectiveOpen = open && !suppressed;

    useEffect(() => {
        if (suppressed) {
            onOpenChange(false);
            return;
        }
        if (shouldCaptureAuthStarted(wasOpenRef.current, effectiveOpen)) {
            captureEvent(resolveAuthOpenEvent(trigger), { reason: effectiveReason });
        }
        // Closing without a preceding success is a dismiss — only counts
        // toward the auto-nudge cap; a user who opened this themselves and
        // backed out isn't "nudge fatigue".
        if (wasOpenRef.current && !effectiveOpen && trigger === "auto" && !succeededRef.current) {
            recordNudgeDismissed(effectiveReason);
        }
        if (!effectiveOpen) succeededRef.current = false;
        wasOpenRef.current = effectiveOpen;
    }, [effectiveOpen, suppressed, trigger, effectiveReason, onOpenChange]);

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
                <DialogContent className="sm:max-w-[420px] max-h-[min(92dvh,640px)] overflow-y-auto overscroll-contain p-5 sm:p-6 pt-7 sm:pt-8 rounded-none border border-border bg-card">
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
                <Button size="sm" variant="outline" className="h-9">
                    Log In
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[420px] max-h-[min(92dvh,640px)] overflow-y-auto overscroll-contain p-5 sm:p-6 pt-7 sm:pt-8 rounded-none border border-border bg-card">
                <div>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} />
                </div>
            </PopoverContent>
        </Popover>
    );
}
