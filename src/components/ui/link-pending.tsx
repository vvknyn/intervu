"use client";

import { useLinkStatus } from "next/link";
import { InlineSpinner } from "@/components/ui/wait-state";

/**
 * The pending mark for a `next/link` whose route is still loading: render it
 * as a CHILD of the `<Link>` (useLinkStatus reads the nearest one). A zero-
 * width slot holds a spinner positioned inside it, so the label never moves
 * when it appears. The `.link-pending-mark` rules in globals.css hold it
 * back for `--transition-base` (a navigation that answers faster shows
 * nothing) and dim the link while it shows; the site-wide
 * `prefers-reduced-motion` rule stills the spin.
 */
export function LinkPending() {
    const { pending } = useLinkStatus();
    if (!pending) return null;
    return (
        <span className="link-pending-mark relative inline-block h-0 w-0 align-baseline">
            <InlineSpinner size={12} className="absolute bottom-0 left-1 text-muted-foreground" />
        </span>
    );
}
