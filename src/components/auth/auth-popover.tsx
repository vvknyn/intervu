"use client";

import { useEffect, useRef } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/events";
import { type AuthGateReason, shouldCaptureAuthStarted } from "@/lib/auth/auth-gate-copy";

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
}

export function AuthPopover({ open, onOpenChange, showTrigger = true, onAuthed, valueLine, defaultTab = "login", reason }: AuthPopoverProps) {
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (shouldCaptureAuthStarted(wasOpenRef.current, open)) {
            captureEvent("auth_started", { reason: reason ?? "generic" });
        }
        wasOpenRef.current = open;
    }, [open, reason]);

    const handleSuccess = () => {
        onAuthed?.();
        onOpenChange(false);
    };

    const valueLineNode = valueLine && (
        <p className="mb-4 text-sm leading-normal text-muted-foreground">{valueLine}</p>
    );

    // When no trigger, use a Dialog instead (e.g. programmatic open from buttons)
    if (!showTrigger) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[420px] p-6 pt-8 rounded-none border border-border bg-card">
                    <DialogTitle className="sr-only">Authentication</DialogTitle>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} />
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-9">
                    Log In
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[420px] p-6 pt-8 rounded-none border border-border bg-card">
                <div>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} />
                </div>
            </PopoverContent>
        </Popover>
    );
}
