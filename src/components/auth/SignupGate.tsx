"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { signupGateCopy, type AuthGateReason } from "@/lib/auth/auth-gate-copy";
import type { OriginSurface } from "@/lib/auth/gate-attempt";
import { recordAuthGateOpen } from "@/lib/auth/open-auth-gate";
import { signupGateHrefs, type SitePath } from "@/lib/auth/post-auth-destination";
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import { cn } from "@/lib/utils";

/**
 * The one signed-out gate card. Every place that tells an anonymous visitor
 * "you need an account for this" renders this: it names the attempted action,
 * says what the account gives, and offers one primary door (create) and one
 * secondary (sign in). `count` must be a TRUE number from the same response
 * (`resolveHiddenCount` for the depth wall, the real match total for the fit
 * gate) — never a number made up for effect. `onDismiss` adds a "Not now"
 * button; omit it only for a hard wall (the depth cap). `children` sit
 * between the body and the doors, for what the account opens on this page
 * (the company page's real per-band counts).
 */
export function SignupGate({
    reason,
    returnTo,
    originSurface,
    count,
    onDismiss,
    className,
    children,
}: {
    reason: AuthGateReason;
    /** The page to come back to — the exact SERP, filters and all. */
    returnTo: SitePath;
    originSurface: OriginSurface;
    count?: CorpusCount | null;
    onDismiss?: () => void;
    className?: string;
    children?: ReactNode;
}) {
    const copy = signupGateCopy(reason, count);
    const hrefs = signupGateHrefs(returnTo);
    // Either door is a user-opened gate: record it so the signup that follows
    // carries this reason (same continuity every dialog gate records).
    const onEngage = () =>
        recordAuthGateOpen({ storage: window.sessionStorage, reason, trigger: "user", originSurface, returnTo });
    return (
        <section
            data-testid="signup-gate"
            data-gate-reason={reason}
            className={cn("rounded-panel border border-border bg-card p-4", className)}
        >
            <h2 className="text-base font-semibold leading-snug text-foreground">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
            {children}
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button asChild>
                    <a data-testid="signup-gate-create" href={hrefs.create} onClick={onEngage}>
                        {copy.createLabel}
                    </a>
                </Button>
                <Button asChild variant="outline">
                    <a data-testid="signup-gate-signin" href={hrefs.signIn} onClick={onEngage}>
                        {copy.signInLabel}
                    </a>
                </Button>
                {onDismiss && (
                    <Button type="button" variant="ghost" data-testid="signup-gate-dismiss" onClick={onDismiss}>
                        Not now
                    </Button>
                )}
            </div>
        </section>
    );
}
