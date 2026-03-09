"use client";

import { useState } from "react";
import { ShieldCheck, SmileyNervous } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SETUP_NUDGES } from "@/lib/copy";
import { AuthPopover } from "@/components/auth/auth-popover";

const PROVIDERS = [
    { name: "Groq", label: "Free" },
    { name: "Google Gemini", label: "Free" },
    { name: "OpenAI", label: "Paid" },
];

interface WelcomeStepProps {
    dismissCount?: number;
}

export function WelcomeStep({ dismissCount = 0 }: WelcomeStepProps) {
    const [authOpen, setAuthOpen] = useState(false);
    const nudge = dismissCount > 0
        ? SETUP_NUDGES[Math.min(dismissCount - 1, SETUP_NUDGES.length - 1)]
        : null;

    return (
        <div className="space-y-6 animate-in fade-in">
            {nudge && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm animate-in slide-in-from-top-2 fade-in duration-300">
                    <SmileyNervous size={18} weight="fill" className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-amber-900 dark:text-amber-200">{nudge}</span>
                </div>
            )}

            <div>
                <h2 className="text-xl font-semibold tracking-tight mb-2">
                    {dismissCount > 0 ? "Welcome back to Intervu" : "Welcome to Intervu"}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Intervu uses AI to help you prepare for interviews &mdash; but we don&apos;t run
                    the AI ourselves. You bring a key from a provider like Groq or Google Gemini
                    (both free), and we use it to generate questions, strategies, and resume
                    tailoring on your behalf.
                </p>
            </div>

            {/* Provider overview */}
            <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map((p) => (
                    <div
                        key={p.name}
                        className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center"
                    >
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className={cn(
                            "text-xs mt-1 font-medium",
                            p.label === "Free" ? "text-green-600" : "text-muted-foreground"
                        )}>
                            {p.label}
                        </div>
                    </div>
                ))}
            </div>

            {/* Privacy note */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-green-500/5 border border-green-500/15 text-sm text-muted-foreground">
                <ShieldCheck size={18} weight="fill" className="text-green-600 shrink-0 mt-0.5" />
                <span>Your key stays on your device. We never see or store it on our servers.</span>
            </div>

            {/* Sign in prompt */}
            <p className="text-xs text-muted-foreground text-center pt-1">
                Already have an account?{" "}
                <button
                    onClick={() => setAuthOpen(true)}
                    className="font-medium text-foreground hover:underline"
                >
                    Sign in
                </button>
            </p>
            <AuthPopover open={authOpen} onOpenChange={setAuthOpen} showTrigger={false} />
        </div>
    );
}
