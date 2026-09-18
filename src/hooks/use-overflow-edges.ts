"use client";

import { useEffect, useState, type RefObject } from "react";

export interface OverflowEdges {
    left: boolean;
    right: boolean;
}

const NONE: OverflowEdges = { left: false, right: false };

function measure(el: HTMLElement): OverflowEdges {
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 1) return NONE;
    return { left: el.scrollLeft > 1, right: el.scrollLeft < overflow - 1 };
}

/**
 * Which side(s) of a horizontally-scrolling element currently hide content,
 * so a caller can render an edge-fade affordance only where something is
 * actually clipped — never a static "always fade" guess, and {false,false}
 * (no fade at all) whenever nothing overflows, e.g. the same scroller at a
 * wide viewport where every child already fits (mobile layout audit,
 * 2026-09-18, class D "cut scroll row" — the toolbar chip row hid 577-607px
 * of controls below `lg` with zero affordance).
 *
 * A `MutationObserver` on childList/subtree (not just `ResizeObserver` on
 * the element itself) is what catches the common case here: a filter chip
 * is added or removed while the scroller's own box size stays fixed (it's a
 * flex item), so only `scrollWidth` changes — a `ResizeObserver` alone never
 * fires for that.
 */
export function useOverflowEdges(ref: RefObject<HTMLElement | null>): OverflowEdges {
    const [edges, setEdges] = useState<OverflowEdges>(NONE);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const recompute = () => setEdges(measure(el));
        recompute();

        el.addEventListener("scroll", recompute, { passive: true });
        window.addEventListener("resize", recompute);
        const resizeObserver = new ResizeObserver(recompute);
        resizeObserver.observe(el);
        const mutationObserver = new MutationObserver(recompute);
        mutationObserver.observe(el, { childList: true, subtree: true });

        return () => {
            el.removeEventListener("scroll", recompute);
            window.removeEventListener("resize", recompute);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
        };
    }, [ref]);

    return edges;
}
