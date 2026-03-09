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
}

export function ContextHelp({ content, className, side = "top" }: ContextHelpProps) {
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className={cn("text-muted-foreground hover:text-foreground transition-colors cursor-help inline-flex items-center justify-center align-middle ml-1", className)}
                    >
                        <Question size={14} weight="regular" />
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
