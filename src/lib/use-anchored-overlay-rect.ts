import { useEffect, useState, type RefObject } from "react";

export interface AnchoredOverlayRect {
    top: number;
    left: number;
    width: number;
}

/** Fixed-position anchor for a dropdown hanging below a field. */
export function measureAnchoredOverlayRect(anchor: HTMLElement, gap = 8): AnchoredOverlayRect {
    const r = anchor.getBoundingClientRect();
    return { top: r.bottom + gap, left: r.left, width: r.width };
}

/** Tracks anchor geometry while a dropdown is open (scroll/resize safe). */
export function useAnchoredOverlayRect(
    anchorRef: RefObject<HTMLElement | null>,
    open: boolean,
    gap = 8,
): AnchoredOverlayRect | null {
    const [rect, setRect] = useState<AnchoredOverlayRect | null>(null);

    useEffect(() => {
        if (!open) {
            setRect(null);
            return;
        }
        const update = () => {
            const el = anchorRef.current;
            if (el) setRect(measureAnchoredOverlayRect(el, gap));
        };
        update();
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [anchorRef, open, gap]);

    return rect;
}
