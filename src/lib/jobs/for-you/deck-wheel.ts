const PACK_JD_SCROLL = "[data-pack-scroll]";
const PACK_INNER_SCROLL = "[data-pack-scroll], [data-pack-meta-scroll]";

function closestRegion(target: EventTarget | null, selector: string): Element | null {
    if (target == null) return null;
    const el = target as Element;
    if (typeof el.closest !== "function") return null;
    return el.closest(selector);
}

/** Whether a wheel event on `target` should advance the pack deck (false inside JD scroll). */
export function shouldAdvancePackOnWheel(target: EventTarget | null): boolean {
    return closestRegion(target, PACK_JD_SCROLL) == null;
}

export type PackScrollMetrics = {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
};

/** Read scroll metrics from the pack JD or meta pane that contains `target`. */
export function readPackScrollRegion(target: EventTarget | null): PackScrollMetrics | null {
    const region = closestRegion(target, PACK_INNER_SCROLL) as HTMLElement | null;
    if (!region) return null;
    return {
        scrollTop: region.scrollTop,
        clientHeight: region.clientHeight,
        scrollHeight: region.scrollHeight,
    };
}

/**
 * Whether a vertical swipe should change packs.
 * Outside inner scrollers: always. Inside: only at the matching edge so JD/meta
 * scroll is not stolen mid-pane (swipe up at bottom → next; swipe down at top → prev).
 */
export function shouldAdvancePackOnSwipe(dy: number, region: PackScrollMetrics | null): boolean {
    if (region == null) return true;
    const atTop = region.scrollTop <= 1;
    const atBottom = region.scrollTop + region.clientHeight >= region.scrollHeight - 1;
    if (dy < 0) return atBottom;
    if (dy > 0) return atTop;
    return false;
}
