import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
    progress: number
    label?: string
    radius?: "pill" | "ctl"
}

export function ProgressBar({ progress, className, radius = "pill", ...props }: ProgressBarProps) {
    const trackRadius = radius === "ctl" ? "rounded-ctl" : "rounded-pill"
    const fillRadius = radius === "ctl" ? "rounded-ctl" : undefined

    return (
        <div className={cn("w-full", className)} {...props}>
            <div className={cn("h-1 w-full bg-border overflow-hidden", trackRadius)}>
                <div
                    className={cn(
                        "h-full bg-brand transition-all duration-500 ease-out",
                        fillRadius,
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
            </div>
        </div>
    )
}
