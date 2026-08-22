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
}

export function ContextHelp({ content, className, side = "top", icon }: ContextHelpProps) {
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className={cn("text-muted-foreground hover:text-foreground transition-colors cursor-help inline-flex items-center justify-center align-middle ml-1 h-[18px] w-[18px] shrink-0 leading-none", className)}
                    >
                        {icon ?? <Question size={14} weight="regular" />}
                        <span className="sr-only">More information</span>
                    </button>
                </TooltipTrigger>
                <TooltipContent side={side} className="max-w-xs text-xs">
                    {content}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
