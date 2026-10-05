"use client";

/**
 * Setup as the /jobs page itself, for a new account that landed there with
 * nowhere else to return to: the three steps sit under the search box in
 * place of the résumé band, and the welcome strip steps aside. Counts as one
 * of the strip's visit days, and "Later" puts it off the same way.
 */
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/heading";
import { captureEvent } from "@/lib/analytics/events";
import { markStripDay, putSetupOff, registerInlineSetup, useOnboarding } from "@/hooks/use-onboarding";
import { SetupSteps } from "./SetupSteps";

export function SetupPanel({ onUploadResume, onFinished }: { onUploadResume: () => void; onFinished: () => void }) {
    const { strip, today } = useOnboarding();
    const reported = useRef(false);

    useEffect(() => registerInlineSetup(), []);
    useEffect(() => {
        if (reported.current) return;
        reported.current = true;
        captureEvent("onboarding_setup_opened", { surface: "jobs_page" });
    }, []);
    useEffect(() => {
        if (strip.show && strip.recordDay) markStripDay(today, strip.day);
    }, [strip.show, strip.recordDay, strip.day, today]);

    return (
        <div className="mx-auto mt-6 w-full max-w-[720px]">
            <section
                data-testid="setup-panel"
                aria-labelledby="setup-panel-title"
                className="rounded-panel border border-border bg-card p-4 sm:p-6"
            >
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <SectionTitle id="setup-panel-title">Set up your search</SectionTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Three steps. Skip any of them. Settings › Preferences keeps the same answers.
                        </p>
                    </div>
                    <Button type="button" variant="ghost" data-testid="setup-panel-later" onClick={putSetupOff}>
                        Later
                    </Button>
                </div>
                <SetupSteps variant="page" onUploadResume={onUploadResume} onFinished={onFinished} />
            </section>
        </div>
    );
}
