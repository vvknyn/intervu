import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A line of facts joined by a "·", as its own line (a résumé's headline and contact line, a company's tags).
 *  Each fact is one unit that wraps whole, and no "·" ever ends or starts a wrapped line — the rule lives in
 *  `.fact-line` (globals.css). A run inside a sentence, or a fact list that clamps lines, stays on `DotSeparated`.
 *  The dots are drawn by CSS, so they are not text: the facts read as separate items to a screen reader. */
export function FactLine({ items, className, ...rest }: { items: ReactNode[]; className?: string; "data-testid"?: string }) {
    const visible = items.filter(Boolean);
    if (visible.length === 0) return null;
    return (
        <p className={cn("fact-line", className)} {...rest}>
            {visible.map((item, i) => (
                <span key={i}>{item}</span>
            ))}
        </p>
    );
}
