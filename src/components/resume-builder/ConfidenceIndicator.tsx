"use client";

import { cn } from "@/lib/utils";

interface ConfidenceIndicatorProps {
    score: number;
    showLabel?: boolean;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

/**
 * Color-coded confidence badge:
 * - Green (90%+): High confidence - auto-accepted
 * - Yellow (70-89%): Medium confidence - "Review suggested"
 * - Red (<70%): Low confidence - "Manual edit required"
 */
export function ConfidenceIndicator({ score, showLabel = true, size = 'md', className }: ConfidenceIndicatorProps) {
    const getConfidenceLevel = (score: number) => {
        if (score >= 90) return { level: 'high', label: 'High confidence', color: 'bg-live', textColor: 'text-live dark:text-live', bgColor: 'bg-muted dark:bg-muted', borderColor: 'border-muted dark:border-live' };
        if (score >= 70) return { level: 'medium', label: 'Review suggested', color: 'bg-warn', textColor: 'text-warn dark:text-warn', bgColor: 'bg-muted dark:bg-muted', borderColor: 'border-muted dark:border-warn' };
        return { level: 'low', label: 'Manual edit required', color: 'bg-danger-text', textColor: 'text-danger-text dark:text-danger-text', bgColor: 'bg-muted dark:bg-muted', borderColor: 'border-muted dark:border-danger-text' };
    };

    const { level, label, color, textColor, bgColor, borderColor } = getConfidenceLevel(score);

    const sizeClasses = {
        sm: { badge: 'h-5 text-xs px-1.5', dot: 'w-1.5 h-1.5' },
        md: { badge: 'h-6 text-xs px-2', dot: 'w-2 h-2' },
        lg: { badge: 'h-7 text-sm px-2.5', dot: 'w-2.5 h-2.5' }
    };

    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5 rounded-pill border",
                bgColor,
                borderColor,
                sizeClasses[size].badge,
                className
            )}
        >
            <span className={cn("rounded-pill shrink-0", color, sizeClasses[size].dot)} />
            {showLabel && (
                <span className={cn("whitespace-nowrap", textColor)}>
                    {label}
                </span>
            )}
            <span className={cn("font-semibold", textColor)}>
                {score}%
            </span>
        </div>
    );
}

interface ConfidenceBadgeProps {
    score: number;
    section: string;
    className?: string;
}

/**
 * Compact badge for inline use in forms
 */
export function ConfidenceBadge({ score, section, className }: ConfidenceBadgeProps) {
    const getColor = (score: number) => {
        if (score >= 90) return 'text-live dark:text-live';
        if (score >= 70) return 'text-warn dark:text-warn';
        return 'text-danger-text dark:text-danger-text';
    };

    const getDot = (score: number) => {
        if (score >= 90) return 'bg-live';
        if (score >= 70) return 'bg-warn';
        return 'bg-danger-text';
    };

    return (
        <span
            className={cn("inline-flex items-center gap-1 text-xs", getColor(score), className)}
            title={`${section}: ${score}% confidence`}
        >
            <span className={cn("w-1.5 h-1.5 rounded-pill", getDot(score))} />
            {score}%
        </span>
    );
}

interface WarningBannerProps {
    warnings: string[];
    className?: string;
    onDismiss?: () => void;
}

/**
 * Warning banner for overall parsing issues
 */
export function WarningBanner({ warnings, className, onDismiss }: WarningBannerProps) {
    if (warnings.length === 0) return null;

    return (
        <div
            className={cn(
                "relative w-full rounded-panel border-0 border-l-2 border-l-warn bg-muted p-4",
                className
            )}
        >
            <div className="flex items-start gap-3">
                <svg className="w-4 h-4 shrink-0 mt-0.5 text-warn dark:text-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm text-warn dark:text-muted-foreground mb-1">
                        Parsing Warnings
                    </h4>
                    <ul className="text-xs text-warn dark:text-warn space-y-1">
                        {warnings.map((warning, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-warn mt-0.5">•</span>
                                {warning}
                            </li>
                        ))}
                    </ul>
                </div>
                {onDismiss && (
                    <button
                        onClick={onDismiss}
                        className="text-warn dark:text-warn hover:text-warn dark:hover:text-muted-foreground transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}
