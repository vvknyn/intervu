import type { ReactNode } from "react";
import { Check, Minus, Warning, X } from "@phosphor-icons/react";
import { LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";

export type SignalChipTone = "good" | "lacking" | "short" | "caution" | "neutral";

/**
 * One small fact as a chip: a glyph and a few words, the full sentence in its
 * title (Vivek, 2026-10-10: "so much of our app is text"). Shared by the
 * posting check and the fit label's ✓/✗ terms, so a ✓ reads the same
 * wherever it shows. `good` ✓ in the fit green; `lacking` ✗ and `short` —
 * muted, never alarming; `caution` ⚠ in the relisted tone; `neutral` no glyph.
 */
export function SignalChip({
    tone,
    title,
    srNote,
    children,
}: {
    tone: SignalChipTone;
    /** The full line, on hover. */
    title?: string;
    /** Read after the words by a screen reader, for what the glyph says ("not on your résumé"). */
    srNote?: string;
    children: ReactNode;
}) {
    return (
        <li
            title={title}
            className={cn(
                "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs",
                tone === "good"
                    ? "bg-live-tint-bg text-verdict-good"
                    : tone === "caution"
                      ? cn("bg-surface-2", LISTING_STATE_TEXT.relisted)
                      : "bg-surface-2 text-muted-foreground",
            )}
        >
            {tone === "good" ? (
                <Check weight="bold" aria-hidden />
            ) : tone === "lacking" ? (
                <X weight="bold" aria-hidden />
            ) : tone === "short" ? (
                <Minus weight="bold" aria-hidden />
            ) : tone === "caution" ? (
                <Warning weight="bold" aria-hidden />
            ) : null}
            {children}
            {srNote && <span className="sr-only">, {srNote}</span>}
        </li>
    );
}
