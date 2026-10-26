"use client"

import { X } from "@phosphor-icons/react"
import type { ReactNode } from "react"

/**
 * A notice's content with its dismiss × pinned to the top-right corner (the Primer banner,
 * Material banner and toast pattern). The × is a sibling of the content, never a member of its
 * wrap, so a narrow card cannot drop it onto a line of its own. It is a `ctl-sm` square, level
 * with the first line of text: 3px down keeps its top within 4px of the line's top whether the line
 * sits at the top of the content or is centred beside a 32px control. The 44px touch band comes from
 * the control scale. Callers own the shell (border, padding) and the dismissal itself.
 */
export function Dismissible({ onDismiss, dismissTestId, children }: { onDismiss: () => void; dismissTestId?: string; children: ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">{children}</div>
            <button
                type="button"
                aria-label="Dismiss"
                data-testid={dismissTestId}
                onClick={onDismiss}
                className="ctl-sm ctl-button ctl-square mt-[3px] inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <X size={16} weight="bold" aria-hidden />
            </button>
        </div>
    )
}
