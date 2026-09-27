"use client";

import { useEffect, useRef, useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/events";
import { buildAuthOpenPayload } from "@/lib/analytics/auth-event-payload";
import { AUTH_CTA_LABEL, authGateTitle, type AuthGateReason, type AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import {
    beginGateAttempt,
    clearGateAttempt,
    gateAttemptEventFields,
    readGateAttempt,
    type OriginSurface,
} from "@/lib/auth/gate-attempt";
import { buildReturnTo } from "@/lib/jobs/pending-actions";
import { canShowAutoNudge, markAutoNudgeShown, recordNudgeDismissed } from "@/lib/auth/nudge-cap";
import { type NudgeDecision, type NudgeGateState, decideNudgeOnce, nudgeGateNext, shouldRecordDismiss } from "@/lib/auth/nudge-gate";

const EXPLICIT_USER_GATE_REASONS = new Set<AuthGateReason>([
    "fit",
    "save",
    "resume",
    "tailor",
    "tracker",
    "report",
    "alert",
]);

function ensureGateAttemptRecorded(
    trigger: AuthGateTrigger,
    reason: AuthGateReason,
    originSurface?: OriginSurface,
    jobId?: string,
    returnTo?: string,
): void {
    if (trigger !== "user" || !EXPLICIT_USER_GATE_REASONS.has(reason)) return;
    const existing = readGateAttempt(window.sessionStorage);
    if (existing && reason === "generic") return;
    beginGateAttempt(window.sessionStorage, {
        reason,
        originSurface: originSurface ?? existing?.originSurface ?? "jobs_banner",
        returnTo: returnTo ?? existing?.returnTo ?? buildReturnTo(window.location),
        jobId: jobId ?? existing?.jobId,
    });
}

interface AuthPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    showTrigger?: boolean;
    onAuthed?: () => void;
    valueLine?: React.ReactNode;
    defaultTab?: "login" | "signup";
    reason?: AuthGateReason;
    trigger: AuthGateTrigger;
    originSurface?: OriginSurface;
    jobId?: string;
    returnTo?: string;
    hasResume?: boolean;
    signedIn?: boolean;
    guestSaveCount?: number;
}

export function AuthPopover({
    open,
    onOpenChange,
    showTrigger = true,
    onAuthed,
    valueLine,
    defaultTab = "login",
    reason,
    trigger,
    originSurface,
    jobId,
    returnTo,
    hasResume,
    signedIn,
    guestSaveCount,
}: AuthPopoverProps) {
    const succeededRef = useRef(false);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const effectiveReason = reason ?? "generic";
    const [gate, setGate] = useState<NudgeGateState>("idle");
    const decisionRef = useRef<NudgeDecision | null>(null);

    useEffect(() => {
        if (open && gate === "idle") {
            const alreadyDecided = decisionRef.current !== null;
            decisionRef.current = decideNudgeOnce(decisionRef.current, { reason: effectiveReason, trigger });
            if (alreadyDecided) {
                return;
            }
            const decision = decisionRef.current;
            const allowed = trigger !== "auto" || canShowAutoNudge(effectiveReason);
            const next = nudgeGateNext(gate, { type: "open", trigger, allowed });
            if (next === "shown") {
                if (trigger === "auto") markAutoNudgeShown(decision.reason);
                ensureGateAttemptRecorded(
                    trigger,
                    effectiveReason,
                    originSurface,
                    jobId,
                    returnTo,
                );
                const attempt = readGateAttempt(window.sessionStorage);
                const continuity = gateAttemptEventFields(attempt);
                const payload = buildAuthOpenPayload(decision.reason, {
                    ...continuity,
                    origin_surface: originSurface ?? attempt?.originSurface,
                    trigger_type: trigger,
                    pending_action_id: attempt?.pendingActionId,
                    job_id: jobId ?? attempt?.jobId,
                    return_to: returnTo ?? attempt?.returnTo,
                    has_resume: hasResume,
                    signed_in: signedIn,
                    guest_save_count: guestSaveCount,
                });
                if (trigger === "auto") {
                    captureEvent("auth_nudge_shown", payload);
                } else {
                    captureEvent("auth_started", payload);
                }
            } else {
                onOpenChange(false);
            }
            setGate(next);
            return;
        }
        if (!open && gate !== "idle") {
            const next = nudgeGateNext(gate, { type: "close" });
            if (shouldRecordDismiss(gate, next) && decisionRef.current?.trigger === "auto" && !succeededRef.current) {
                recordNudgeDismissed(decisionRef.current.reason);
            }
            if (!succeededRef.current) {
                clearGateAttempt(window.sessionStorage);
            }
            succeededRef.current = false;
            decisionRef.current = null;
            setGate(next);
        }
    }, [
        open,
        gate,
        trigger,
        effectiveReason,
        onOpenChange,
        originSurface,
        jobId,
        returnTo,
        hasResume,
        signedIn,
        guestSaveCount,
    ]);

    const effectiveOpen = gate === "shown";

    useEffect(() => {
        if (!effectiveOpen || showTrigger) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
            returnFocusRef.current = active;
        }
    }, [effectiveOpen, showTrigger]);

    const handleDialogCloseAutoFocus = (event: Event) => {
        event.preventDefault();
        const target = returnFocusRef.current;
        if (target?.isConnected) {
            target.focus({ preventScroll: true });
        }
        returnFocusRef.current = null;
    };

    const handleSuccess = () => {
        succeededRef.current = true;
        onAuthed?.();
        onOpenChange(false);
    };

    const gateTitle = authGateTitle(effectiveReason);
    const headline = gateTitle ? { title: gateTitle, body: valueLine } : undefined;
    const valueLineNode = !gateTitle && valueLine && (
        <p className="mb-4 text-sm leading-normal text-muted-foreground">{valueLine}</p>
    );

    if (!showTrigger) {
        return (
            <Dialog open={effectiveOpen} onOpenChange={onOpenChange}>
                <DialogContent
                    className="sm:max-w-105 max-h-[min(92dvh,640px)] overflow-y-auto overscroll-contain bg-surface-2 p-5 pt-7 sm:p-6 sm:pt-8"
                    onCloseAutoFocus={handleDialogCloseAutoFocus}
                >
                    <DialogTitle className="sr-only">{gateTitle ?? "Authentication"}</DialogTitle>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} headline={headline} />
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
            <PopoverContent align="end" className="w-105 max-h-[min(92dvh,640px)] overflow-y-auto overscroll-contain bg-surface-2 p-5 pt-7 shadow-[var(--shadow-overlay)] sm:p-6 sm:pt-8">
                <div>
                    {valueLineNode}
                    <LoginForm key={defaultTab} onSuccess={handleSuccess} defaultTab={defaultTab} headline={headline} />
                </div>
            </PopoverContent>
        </Popover>
    );
}
