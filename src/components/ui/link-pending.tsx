"use client";

import { useEffect, useState } from "react";
import { useLinkStatus } from "next/link";
import { InlineSpinner } from "@/components/ui/wait-state";

/** A navigation that answers faster than this shows nothing (no flash). */
export const LINK_PENDING_AFTER_MS = 150;

/**
 * The pending mark for a `next/link` whose route is still loading: render it
 * as a CHILD of the `<Link>` (useLinkStatus reads the nearest one). Nothing
 * for the first 150 ms, then a small inline spinner until the page arrives,
 * so a click on a slow server visibly did something. Reduced motion stills
 * the spin through the site-wide rule in globals.css.
 */
export function LinkPending() {
    const { pending } = useLinkStatus();
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (!pending) {
            setShown(false);
            return;
        }
        const t = setTimeout(() => setShown(true), LINK_PENDING_AFTER_MS);
        return () => clearTimeout(t);
    }, [pending]);
    if (!shown) return null;
    return <InlineSpinner size={12} className="ml-1 inline-block align-[-1px] text-muted-foreground" />;
}
