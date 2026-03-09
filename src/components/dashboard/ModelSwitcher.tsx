"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Check, CaretDown, WarningCircle, Gear, Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { UsageIndicator } from "./UsageIndicator";
import { AVAILABLE_MODELS, Provider } from "@/lib/llm/models";
import { CostBadge } from "@/components/settings/CostBadge";

interface ModelSwitcherProps {
    provider: Provider;
    model: string;
    onModelChange: (provider: Provider, model: string) => void;
    apiKeys?: { groq?: string; gemini?: string; openai?: string };
    onConfigureKey?: (provider: Provider) => void;
    onRemoveKey?: (provider: Provider) => void;
    className?: string;
}

export function ModelSwitcher({ provider, model, onModelChange, apiKeys, onConfigureKey, onRemoveKey, className }: ModelSwitcherProps) {
    const [open, setOpen] = useState(false);
    const [providerStatus, setProviderStatus] = useState<Record<Provider, 'ok' | 'warning' | 'error' | 'unknown'>>({
        groq: 'unknown',
        gemini: 'unknown',
        openai: 'unknown'
    });

    // Just show provider name
    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
    const displayText = providerLabel;

    // Get status indicator for button
    const currentStatus = providerStatus[provider];
    const statusColor = currentStatus === 'ok' ? 'bg-green-500' :
        currentStatus === 'warning' ? 'bg-yellow-500' :
            currentStatus === 'error' ? 'bg-red-500' : 'bg-muted-foreground';

    const handleStatusChange = useCallback((prov: Provider) => (status: 'ok' | 'warning' | 'error' | 'unknown') => {
        setProviderStatus(prev => ({ ...prev, [prov]: status }));
    }, []);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <div data-tour="model-switcher">
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            "h-10 px-2.5 sm:px-4 justify-between text-sm font-semibold border-transparent hover:bg-brand/5 hover:text-brand transition-colors shadow-sm",
                            className
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full shrink-0", statusColor)} />
                            <span className="truncate max-w-[140px]">{displayText}</span>
                        </div>
                        <CaretDown size={14} className="ml-1 sm:ml-2 opacity-50 flex-shrink-0" />
                    </Button>
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0" align="end">
                <div className="p-2 space-y-1">
                    {/* Groq */}
                    <ProviderRow
                        name="Groq"
                        provider="groq"
                        isActive={provider === "groq"}
                        hasKey={!!apiKeys?.groq}
                        apiKey={apiKeys?.groq}
                        onSelect={() => {
                            onModelChange("groq", AVAILABLE_MODELS.groq[0].id);
                            setOpen(false);
                        }}
                        onConfigure={() => {
                            onConfigureKey?.('groq');
                            setOpen(false);
                        }}
                        onRemove={onRemoveKey ? () => {
                            onRemoveKey('groq');
                            setOpen(false);
                        } : undefined}
                        onStatusChange={handleStatusChange('groq')}
                    />

                    {/* Gemini */}
                    <ProviderRow
                        name="Gemini"
                        provider="gemini"
                        isActive={provider === "gemini"}
                        hasKey={!!apiKeys?.gemini}
                        apiKey={apiKeys?.gemini}
                        onSelect={() => {
                            onModelChange("gemini", AVAILABLE_MODELS.gemini[0].id);
                            setOpen(false);
                        }}
                        onConfigure={() => {
                            onConfigureKey?.('gemini');
                            setOpen(false);
                        }}
                        onRemove={onRemoveKey ? () => {
                            onRemoveKey('gemini');
                            setOpen(false);
                        } : undefined}
                        onStatusChange={handleStatusChange('gemini')}
                    />

                    {/* OpenAI */}
                    <ProviderRow
                        name="OpenAI"
                        provider="openai"
                        isActive={provider === "openai"}
                        hasKey={!!apiKeys?.openai}
                        apiKey={apiKeys?.openai}
                        onSelect={() => {
                            onModelChange("openai", AVAILABLE_MODELS.openai[0].id);
                            setOpen(false);
                        }}
                        onConfigure={() => {
                            onConfigureKey?.('openai');
                            setOpen(false);
                        }}
                        onRemove={onRemoveKey ? () => {
                            onRemoveKey('openai');
                            setOpen(false);
                        } : undefined}
                        onStatusChange={handleStatusChange('openai')}
                    />
                </div>
            </PopoverContent>
        </Popover>
    );
}

// Helper component for provider rows
interface ProviderRowProps {
    name: string;
    provider: Provider;
    isActive: boolean;
    hasKey: boolean;
    apiKey?: string;
    onSelect: () => void;
    onConfigure: () => void;
    onRemove?: () => void;
    onStatusChange?: (status: 'ok' | 'warning' | 'error' | 'unknown') => void;
}

function ProviderRow({ name, provider, isActive, hasKey, apiKey, onSelect, onConfigure, onRemove, onStatusChange }: ProviderRowProps) {
    return (
        <button
            onClick={onSelect}
            className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-md hover:bg-muted/50 transition-colors",
                isActive && "bg-muted"
            )}
        >
            <div className="flex items-center gap-3">
                <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    isActive
                        ? "border-brand bg-brand"
                        : "border-muted-foreground/30"
                )}>
                    {isActive && (
                        <Check size={10} weight="bold" className="text-brand-foreground" />
                    )}
                </div>
                <span className="font-medium">{name}</span>
                <CostBadge provider={provider} />
            </div>
            <div className="flex items-center gap-1.5">
                {/* Usage indicator (compact) */}
                {hasKey && apiKey && (
                    <UsageIndicator
                        provider={provider}
                        apiKey={apiKey}
                        compact
                        onStatusChange={onStatusChange}
                    />
                )}
                {!hasKey && (
                    <WarningCircle size={14} weight="fill" className="text-yellow-500" />
                )}
                {hasKey && onRemove && (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove();
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onRemove();
                            }
                        }}
                        className="p-1 rounded hover:bg-destructive/10 transition-colors cursor-pointer"
                        title="Remove key"
                        aria-label="Remove key"
                    >
                        <Trash size={14} className="text-muted-foreground hover:text-destructive" />
                    </div>
                )}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                        e.stopPropagation();
                        onConfigure();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onConfigure();
                        }
                    }}
                    className="p-1 rounded hover:bg-muted transition-colors cursor-pointer"
                    title="Connect"
                    aria-label="Connect"
                >
                    <Gear size={14} className="text-muted-foreground" />
                </div>
            </div>
        </button>
    );
}
