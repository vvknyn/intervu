"use client"

import * as React from "react"
import { Question } from "@phosphor-icons/react"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface ContextHelpProps {
    content: React.ReactNode
    className?: string
    side?: "top" | "right" | "bottom" | "left"
    /** Override the default "?" trigger glyph — lets a status glyph (e.g. a
     *  colored ⚠/✕) double as its own tooltip trigger instead of sitting next
     *  to a separate generic help mark. Optional so every existing bare-"?"
     *  callsite is unaffected. */
    icon?: React.ReactNode
    /** Colored inline words as the trigger — drops the fixed 18×18 icon box. */
    children?: React.ReactNode
    /** Fires on every open/close toggle — lets a caller (e.g. MatchChip) log
     *  "this disclosure was actually opened" without owning the open state
     *  itself (Radix's `Tooltip` already does, via `onOpenChange`). */
    onOpenChange?: (open: boolean) => void
}

export function ContextHelp({ content, className, side = "top", icon, children, onOpenChange }: ContextHelpProps) {
    const textTrigger = children != null;
    const [open, setOpen] = React.useState(false)
    const change = (next: boolean) => {
        setOpen(next)
        onOpenChange?.(next)
    }
    // A tap has no hover, and Radix closes a tooltip on click: a touch tap toggles
    // the tip itself, and stays on it rather than reaching the row under it.
    const tap = React.useRef<{ touch: boolean; wasOpen: boolean }>({ touch: false, wasOpen: false })
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip open={open} onOpenChange={change}>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onPointerDown={(event) => {
                            tap.current = { touch: event.pointerType === "touch", wasOpen: open }
                        }}
                        onClick={(event) => {
                            if (!tap.current.touch) return
                            event.preventDefault()
                            event.stopPropagation()
                            change(!tap.current.wasOpen)
                        }}
                        className={cn(
                            textTrigger
                                ? "cursor-help inline-flex items-center"
                                : "text-muted-foreground hover:text-foreground transition-colors cursor-help inline-flex items-center justify-center align-middle ml-1 ctl-sm ctl-button ctl-square -my-1 shrink-0 leading-none",
                            className,
                        )}
                    >
                        {textTrigger ? children : (icon ?? <Question weight="regular" />)}
                        {/* Tailwind's `.sr-only` clip technique is `margin: -1px` by
                            construction — an off-Carbon-scale value the rulebook's
                            spacing probe can't tell apart from a real layout bug, on an
                            element with zero visual footprint. `data-rulebook-exempt`
                            (the same mechanism CompanyLogo already uses) opts this
                            one always-invisible node out rather than
                            widening the scale or hiding real offenders. */}
                        <span className="sr-only" data-rulebook-exempt>More information</span>
                    </button>
                </TooltipTrigger>
                <TooltipContent side={side} className="max-w-xs text-xs">
                    {content}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
