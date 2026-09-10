import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A regular space on both sides of the dot gives the browser two break
 *  opportunities, and it's free to take the first one — which is exactly
 *  how the flex-item version of this bug happens (a leading "·" on the
 *  wrapped line). A no-break space before the dot removes that break
 *  point, leaving the only breakable space AFTER the dot, so a wrapped
 *  line always starts with the next item's text, never the dot. */
const SEPARATOR = "\u00A0\u00B7 ";

/** Chokepoint for every "· "-joined fact list. Renders as normal inline text
 *  (never `flex`), so wrapping follows ordinary line-breaking rules instead
 *  of flex-item wrapping — replaces the bug class where a dot renders as
 *  its own flex item, or as the first child of one, inside a `flex-wrap`
 *  container (which can land the dot at the start of a wrapped line). */
export function DotSeparated({ items, className }: { items: ReactNode[]; className?: string }) {
    const visible = items.filter(Boolean);
    if (visible.length === 0) return null;
    return (
        <span className={cn("inline", className)}>
            {visible.map((item, i) => (
                <span key={i}>
                    {i > 0 && <span aria-hidden>{SEPARATOR}</span>}
                    {item}
                </span>
            ))}
        </span>
    );
}
