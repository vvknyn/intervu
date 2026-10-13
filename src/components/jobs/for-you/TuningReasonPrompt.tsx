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
 *
 * `stacked` (a role card's narrow column): the question sits on its own line
 * and the reasons under it — scrolling sideways on a phone (wrapped there, the
 * six took four lines), wrapping from sm up, where a mouse can't swipe.
 * `row` (Today's wide header): the same on a phone, one line that wraps when
 * it must from sm up.
 */
export function TuningReasonPrompt({
    prompt,
    className,
    layout = "row",
}: {
    prompt: Prompt | null;
    className?: string;
    layout?: "row" | "stacked";
}) {
    if (!prompt) return null;
    const text = REASON_TEXT[prompt.signal];
    return (
        <div
            role="group"
            aria-label={`Why ${prompt.signal} like this`}
            data-testid="tuning-reason-prompt"
            data-signal={prompt.signal}
            className={cn(
                "flex flex-col gap-1 text-xs text-muted-foreground",
                layout === "row" && "sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5",
                className,
            )}
        >
            <span className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
                <span className="min-w-0" aria-live="polite">
                    {prompt.signal === "fewer" ? "Fewer" : "More"} like {prompt.role || "this"} — why?
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label="No reason"
                    data-testid="tuning-reason-dismiss"
                    onClick={prompt.dismiss}
                >
                    <X size={16} aria-hidden />
                </Button>
            </span>
            {/* Sideways scroll is a phone gesture; with a mouse every reason must show, so from sm up they wrap. */}
            <div
                className={cn(
                    "flex items-center gap-1.5 overflow-x-auto no-scrollbar",
                    layout === "row" ? "sm:contents" : "sm:flex-wrap sm:overflow-visible",
                )}
            >
                {prompt.reasons.map((reason) => (
                    <Button
                        key={reason}
                        type="button"
                        variant="outline"
                        size="xs"
                        className="shrink-0"
                        data-testid={`tuning-reason-${reason}`}
                        onClick={() => prompt.choose(reason)}
                    >
                        {text[reason]}
                    </Button>
                ))}
            </div>
        </div>
    );
}
