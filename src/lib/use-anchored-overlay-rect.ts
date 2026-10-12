import { useEffect, useState, type RefObject } from "react";

export interface AnchoredOverlayRect {
    top: number;
    left: number;
    width: number;
}

/**
 * Fixed-position anchor for a dropdown hanging below a field.
 *
 * `keepClear` is a control the dropdown must not cover when it sits directly
 * UNDER the field (a phone stacks the location row under the search box).
 * The dropdown then hangs below that control instead, so it stays tappable.
 * Beside the field (desktop) it is left alone.
 */
export function measureAnchoredOverlayRect(
    anchor: HTMLElement,
    gap = 8,
    keepClear?: HTMLElement | null,
): AnchoredOverlayRect {
    const r = anchor.getBoundingClientRect();
    let bottom = r.bottom;
    if (keepClear) {
        const k = keepClear.getBoundingClientRect();
        const stackedUnder = k.height > 0 && k.top >= r.bottom - 1 && k.left < r.right && k.right > r.left;
        if (stackedUnder) bottom = k.bottom;
    }
    return { top: bottom + gap, left: r.left, width: r.width };
}

/** Tracks anchor geometry while a dropdown is open (scroll/resize safe). */
export function useAnchoredOverlayRect(
    anchorRef: RefObject<HTMLElement | null>,
    open: boolean,
    gap = 8,
    keepClearRef?: RefObject<HTMLElement | null>,
): AnchoredOverlayRect | null {
    const [rect, setRect] = useState<AnchoredOverlayRect | null>(null);

    useEffect(() => {
        if (!open) {
            setRect(null);
            return;
        }
        const update = () => {
            const el = anchorRef.current;
            if (el) setRect(measureAnchoredOverlayRect(el, gap, keepClearRef?.current));
        };
        update();
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [anchorRef, open, gap, keepClearRef]);

    return rect;
}
