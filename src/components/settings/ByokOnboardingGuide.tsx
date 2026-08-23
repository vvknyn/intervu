"use client";

import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { BYOK_ONBOARDING, type ByokProvider } from "@/lib/llm/byok";
import { cn } from "@/lib/utils";

export interface ByokOnboardingGuideProps {
    provider: ByokProvider;
    providerName: string;
    /** When true, guide starts collapsed and uses softer styling. */
    connected?: boolean;
}

export function ByokOnboardingGuide({ provider, providerName, connected = false }: ByokOnboardingGuideProps) {
    const [expanded, setExpanded] = useState(!connected);
    const onboarding = BYOK_ONBOARDING[provider];

    return (
        <div
            className={cn(
                "border border-border",
                connected ? "bg-muted/20" : "bg-card",
            )}
        >
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                    connected && !expanded && "text-muted-foreground",
                )}
                aria-expanded={expanded}
            >
                <span className={cn("text-[13px] font-semibold tracking-[-0.01em]", connected && "font-medium")}>
                    Get a {providerName} key
                </span>
                <CaretDown
                    size={14}
                    className={cn("shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                />
            </button>

            {expanded && (
                <div className="space-y-3 border-t border-border px-3 py-3">
                    <ol className="space-y-2.5">
                        {onboarding.steps.map((step, i) => (
                            <li key={i} className="flex gap-2.5 text-[13px] leading-snug">
                                <span className="mt-px w-5 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                                    {i + 1}.
                                </span>
                                <span>
                                    {step.href ? (
                                        <a
                                            href={step.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-foreground underline underline-offset-2 hover:text-brand"
                                        >
                                            {step.title}
                                        </a>
                                    ) : (
                                        <span className="text-foreground">{step.title}</span>
                                    )}
                                    {step.body && (
                                        <span className="text-muted-foreground"> — {step.body}</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ol>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                        <a
                            href={onboarding.keysUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-brand underline underline-offset-2"
                        >
                            Open {providerName} keys
                        </a>
                        {onboarding.docsUrl && (
                            <a
                                href={onboarding.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            >
                                Docs
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
