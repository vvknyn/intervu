"use client";

/**
 * The one-line welcome strip under the header for a new account: setup
 * waits beside the page the person signed in for, never in front of it.
 * Shows on the first day plus two more visit days (`stripDecision`), then
 * setup is only "Finish setup" in the account menu. "Later" hides it for the
 * rest of the day.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markStripDay, openSetupSheet, putSetupOff, useOnboarding } from "@/hooks/use-onboarding";
import { SETUP_STEPS } from "@/lib/onboarding/state";
import { setupStepsLeftLabel } from "@/lib/onboarding/copy";

/** Pages that finish something first: the strip waits for the next Velai page. */
function stripAllowedOn(pathname: string): boolean {
    return !(pathname.startsWith("/connect") || pathname.startsWith("/oauth") || pathname.startsWith("/settings"));
}

export function WelcomeStrip() {
    const pathname = usePathname();
    const { strip, answered, inlinePanelShown, today } = useOnboarding();
    const show = strip.show && !inlinePanelShown && stripAllowedOn(pathname);

    useEffect(() => {
        if (show && strip.recordDay) markStripDay(today, strip.day);
    }, [show, strip.recordDay, strip.day, today]);

    if (!show) return null;
    const left = SETUP_STEPS.length - answered;
    return (
        <div data-testid="welcome-strip" role="region" aria-label="Set up Velai" className="border-b border-border bg-surface-2">
            <div className="shell-row flex items-center gap-2 py-1.5">
                <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {answered === 0 ? (
                        <>
                            <span className="hidden sm:inline">Welcome to Velai. Set up what you&apos;re looking for in three short steps.</span>
                            <span className="sm:hidden">Welcome. Set up in three steps.</span>
                        </>
                    ) : (
                        `Setup: ${setupStepsLeftLabel(left)}.`
                    )}
                </p>
                <Button type="button" data-testid="welcome-strip-setup" onClick={() => openSetupSheet("strip")}>
                    Set up
                </Button>
                <Button type="button" variant="ghost" data-testid="welcome-strip-later" onClick={putSetupOff}>
                    Later
                </Button>
            </div>
        </div>
    );
}
