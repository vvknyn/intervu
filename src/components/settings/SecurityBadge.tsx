"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SecurityBadgeProps {
    compact?: boolean;
    className?: string;
}

export function SecurityBadge({ compact, className }: SecurityBadgeProps) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className={cn(
                        "inline-flex items-center gap-1.5 text-green-600",
                        compact ? "text-xs" : "text-sm",
                        className
                    )}>
                        <ShieldCheck size={compact ? 14 : 16} weight="fill" />
                        <span className="text-muted-foreground">Stored on your device</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                    <p className="text-xs">Your key is encrypted and saved only in your browser. It never reaches our servers.</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
