"use client";

import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { REASON_TEXT } from "@/lib/jobs/for-you/tuning";
import type { TuningReasonPrompt as Prompt } from "@/hooks/use-tuning-reason";
import { cn } from "@/lib/utils";

/**
 * "Fewer like Technical Account Manager — why?" with one button per reason
 * (tuning.ts `REASONS_FOR`). Optional: the tap already counted, so the close
 * button (or simply carrying on) leaves the nudge as it was, and a reason
 * makes it steer by exactly that (review 2026-10-13).
 */
export function TuningReasonPrompt({ prompt, className }: { prompt: Prompt | null; className?: string }) {
    if (!prompt) return null;
    const text = REASON_TEXT[prompt.signal];
    return (
        <div
            role="group"
            aria-label={`Why ${prompt.signal} like this`}
            data-testid="tuning-reason-prompt"
            data-signal={prompt.signal}
            className={cn("flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground", className)}
        >
            <span className="min-w-0" aria-live="polite">
                {prompt.signal === "fewer" ? "Fewer" : "More"} like {prompt.role || "this"} — why?
            </span>
            {prompt.reasons.map((reason) => (
                <Button
                    key={reason}
                    type="button"
                    variant="outline"
                    size="xs"
                    data-testid={`tuning-reason-${reason}`}
                    onClick={() => prompt.choose(reason)}
                >
                    {text[reason]}
                </Button>
            ))}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="No reason" data-testid="tuning-reason-dismiss" onClick={prompt.dismiss}>
                <X size={16} aria-hidden />
            </Button>
        </div>
    );
}
