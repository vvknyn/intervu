"use client";

import { Key, ShieldCheck, CurrencyDollar, Timer } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WelcomeCardProps {
    onSetup: () => void;
    onDismiss: () => void;
}

const PROVIDERS = [
    { name: "Groq", cost: "Free", time: "~2 min" },
    { name: "Gemini", cost: "Free", time: "~2 min" },
    { name: "OpenAI", cost: "Paid", time: "~3 min" },
];

export function WelcomeCard({ onSetup, onDismiss }: WelcomeCardProps) {
    return (
        <div className="w-full rounded-2xl border border-border/60 bg-card p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Header */}
            <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                    <Key size={22} weight="duotone" className="text-brand" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">Bring Your Own AI Key</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                        Intervu doesn&apos;t have a built-in AI &mdash; you connect your own provider.
                        This keeps your data private and your costs transparent.
                    </p>
                </div>
            </div>

            {/* Provider cards */}
            <p className="text-sm font-medium mb-3">Pick one to get started:</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
                {PROVIDERS.map((p) => (
                    <div
                        key={p.name}
                        className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center"
                    >
                        <div className="font-semibold text-sm">{p.name}</div>
                        <div className={cn(
                            "text-xs mt-1 font-medium",
                            p.cost === "Free" ? "text-green-600" : "text-muted-foreground"
                        )}>
                            {p.cost}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{p.time}</div>
                    </div>
                ))}
            </div>

            {/* CTA */}
            <Button variant="brand" className="w-full h-11 font-medium" onClick={onSetup}>
                Set Up Now
            </Button>

            {/* Dismiss */}
            <button
                onClick={onDismiss}
                className="block mx-auto mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                I&apos;ll do this later
            </button>

            {/* Trust indicators */}
            <div className="mt-5 pt-4 border-t border-border/40 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-6 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <ShieldCheck size={14} weight="fill" className="text-green-600" />
                    Keys stored locally, encrypted
                </span>
                <span className="flex items-center gap-1.5">
                    <CurrencyDollar size={14} weight="fill" className="text-green-600" />
                    Free tiers available &mdash; no credit card needed
                </span>
                <span className="flex items-center gap-1.5">
                    <Timer size={14} weight="fill" className="text-brand" />
                    Takes about 2 minutes
                </span>
            </div>
        </div>
    );
}
