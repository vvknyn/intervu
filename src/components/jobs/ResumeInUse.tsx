"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const LINK_CLASS = "text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70";

/**
 * What to call the résumé a page ranks against. An uploaded file goes by its
 * name, so "Résumé_V4.pdf" tells the visitor exactly which one; anything else
 * (pasted text, an edit on the page, a résumé read back from the account, or
 * a browser copy an account without one falls back to) gets a plain
 * description rather than an internal label.
 */
export function resumeInUseLabel(sourceLabel: string | null): string {
    const label = sourceLabel?.trim() ?? "";
    if (/\.(pdf|docx?|txt|md|rtf|odt)$/i.test(label)) return label;
    if (label === "Pasted text") return "the résumé you pasted";
    return "your résumé";
}

/**
 * Remove for a guest's résumé, which lives only in this browser: asks once,
 * then `onRemove` forgets it. An account's résumé is managed on /resume.
 */
export function ResumeRemove({
    onRemove,
    testIdPrefix,
    className,
}: {
    onRemove: () => void;
    testIdPrefix: string;
    className?: string;
}) {
    const [confirming, setConfirming] = useState(false);
    if (!confirming) {
        return (
            <button
                type="button"
                data-testid={`${testIdPrefix}-remove-resume`}
                onClick={() => setConfirming(true)}
                className={className ?? LINK_CLASS}
            >
                Remove
            </button>
        );
    }
    return (
        <span className="inline-flex flex-wrap items-baseline gap-x-2" data-testid={`${testIdPrefix}-remove-resume-confirm`}>
            <span>Remove it from this device?</span>
            <button type="button" data-testid={`${testIdPrefix}-remove-resume-yes`} onClick={onRemove} className={className ?? LINK_CLASS}>
                Remove
            </button>
            <button type="button" data-testid={`${testIdPrefix}-remove-resume-no`} onClick={() => setConfirming(false)} className={className ?? LINK_CLASS}>
                Keep it
            </button>
        </span>
    );
}

/**
 * Which résumé the matches and counts on the packs home come from, with
 * Replace. Without it a ranked page reads like numbers made up from nothing.
 * The packs home needs an account, whose résumé is managed on /resume, so
 * there is no Remove here (a guest's is on the Search toolbar).
 */
export function ResumeInUse({
    label,
    onReplace,
    className,
}: {
    label: string;
    onReplace: () => void;
    className?: string;
}) {
    return (
        <p data-testid="today-resume-in-use" className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground", className)}>
            <span className="min-w-0">
                Ranked against{" "}
                <span className="break-all font-semibold text-foreground" data-testid="today-resume-in-use-label">
                    {label}
                </span>
            </span>
            <button type="button" data-testid="today-replace-resume" onClick={onReplace} className={LINK_CLASS}>
                Replace
            </button>
        </p>
    );
}
