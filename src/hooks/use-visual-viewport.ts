"use client";

import { useEffect, useState } from "react";

/** The part of the layout viewport that is actually visible (the keyboard excluded). */
export interface VisibleViewport {
    top: number;
    height: number;
}

/**
 * While `active`, the visible area as the browser reports it. iOS Safari shrinks
 * only the VISUAL viewport when the keyboard opens, and `100dvh` does not follow
 * it, so anything sized to the screen must read this instead. `null` when
 * inactive or when the browser has no `visualViewport`: callers fall back to dvh.
 */
export function useVisibleViewport(active: boolean): VisibleViewport | null {
    const [visible, setVisible] = useState<VisibleViewport | null>(null);
    useEffect(() => {
        const vv = window.visualViewport;
        if (!active || !vv) return;
        const read = () => setVisible({ top: vv.offsetTop, height: vv.height });
        read();
        vv.addEventListener("resize", read);
        vv.addEventListener("scroll", read);
        return () => {
            vv.removeEventListener("resize", read);
            vv.removeEventListener("scroll", read);
            setVisible(null);
        };
    }, [active]);
    return active ? visible : null;
}
