"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

interface RecipeCompleteStepProps {
    title?: string;
    message?: string;
    ctaLabel?: string;
    onCta: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
}

export function RecipeCompleteStep({
    title = "You're All Set!",
    message = "You've completed the setup. You're ready to start preparing.",
    ctaLabel = "Start Preparing",
    onCta,
    secondaryLabel,
    onSecondary,
}: RecipeCompleteStepProps) {
    return (
        <div className="space-y-6 text-center py-8 animate-in fade-in">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={32} weight="fill" className="text-green-600" />
            </div>
            <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">{message}</p>
            </div>
            <div className="flex items-center justify-center gap-3">
                {secondaryLabel && onSecondary && (
                    <Button variant="outline" onClick={onSecondary}>
                        {secondaryLabel}
                    </Button>
                )}
                <Button onClick={onCta}>{ctaLabel}</Button>
            </div>
        </div>
    );
}
