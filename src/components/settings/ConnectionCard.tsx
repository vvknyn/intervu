"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle, Trash } from "@phosphor-icons/react";
import { CostBadge } from "./CostBadge";
import { cn } from "@/lib/utils";
import type { Provider } from "@/lib/llm/models";

interface ConnectionCardProps {
    provider: Provider;
    providerName: string;
    benefit: string;
    isConnected: boolean;
    isActive: boolean;
    onConnect: () => void;
    onSelect: () => void;
    onRemove?: () => void;
    modelId?: string;
}

export function ConnectionCard({
    provider,
    providerName,
    benefit,
    isConnected,
    isActive,
    onConnect,
    onSelect,
    onRemove,
    modelId,
}: ConnectionCardProps) {
    return (
        <div
            onClick={onSelect}
            className={cn(
                "rounded-xl p-4 border cursor-pointer transition-all flex flex-col",
                isActive
                    ? "ring-2 ring-brand border-brand/30"
                    : "border-border hover:border-foreground/20"
            )}
        >
            {/* Top: Provider name + CostBadge */}
            <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-sm">{providerName}</span>
                <CostBadge provider={provider} modelId={modelId} />
            </div>

            {/* Middle: benefit text */}
            <p className="text-xs text-muted-foreground mb-3 flex-1">{benefit}</p>

            {/* Bottom: status + button */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                    {isConnected ? (
                        <>
                            <CheckCircle size={14} weight="fill" className="text-green-500 shrink-0" />
                            <span className="text-xs text-green-600 whitespace-nowrap">Connected</span>
                        </>
                    ) : (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Not connected</span>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {isConnected && onRemove && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemove();
                            }}
                            title="Remove key"
                        >
                            <Trash size={14} />
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2.5 whitespace-nowrap shrink-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            onConnect();
                        }}
                    >
                        {isConnected ? "Edit" : "Connect"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
