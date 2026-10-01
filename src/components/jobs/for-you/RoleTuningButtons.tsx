"use client";

import { ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ICON_BUTTON =
    "ctl-md ctl-button ctl-square flex shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/**
 * The open role's "more / fewer like this" (tuning.ts): one tap nudges which
 * roles come next. "Fewer" also moves on, like Skip; "more" stays on the role
 * and a second tap takes it back. Cards stacked behind the open one show the
 * same buttons, unwired, so a card sliding in never changes shape.
 */
export function RoleTuningButtons({
    active,
    liked,
    disabled = false,
    onMore,
    onFewer,
}: {
    active: boolean;
    liked: boolean;
    disabled?: boolean;
    onMore?: () => void;
    onFewer?: () => void;
}) {
    return (
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Tune the roles that come next">
            <TooltipProvider delayDuration={300}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            aria-label="Show more roles like this"
                            aria-pressed={liked}
                            data-testid={active ? "role-more-like-this" : undefined}
                            tabIndex={active ? undefined : -1}
                            disabled={disabled}
                            onClick={active ? onMore : undefined}
                            className={cn(ICON_BUTTON, liked && "text-brand hover:text-brand")}
                        >
                            <ThumbsUp size={20} weight={liked ? "fill" : "regular"} aria-hidden />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                        {liked ? "Showing more like this. Tap again to undo." : "More roles like this"}
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            aria-label="Show fewer roles like this"
                            data-testid={active ? "role-fewer-like-this" : undefined}
                            tabIndex={active ? undefined : -1}
                            disabled={disabled}
                            onClick={active ? onFewer : undefined}
                            className={ICON_BUTTON}
                        >
                            <ThumbsDown size={20} aria-hidden />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Fewer roles like this</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
}
