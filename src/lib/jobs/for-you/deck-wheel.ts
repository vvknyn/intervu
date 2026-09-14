/**
 * A scroll region inside a pack is detected by the CSS mechanism that makes
 * it scrollable — Tailwind's `overflow-y-auto` / `overflow-y-scroll`
 * utilities — not by an attribute a caller has to remember to add to a
 * list. Two lists (one per gesture) previously answered "is this a
 * scroller?" independently and had drifted apart (wheel only knew about
 * `[data-pack-scroll]`, swipe also knew about `[data-pack-meta-scroll]`).
 * Keying off the utility class that actually makes an element scroll means
 * a new scroller — meta pane, JD pane, or one nobody has written a rule for
 * yet — is covered automatically by both gestures, because it cannot
 * scroll at all without that class.
 */
const SCROLLABLE_Y_SELECTOR = ".overflow-y-auto, .overflow-y-scroll";

export type PackScrollMetrics = {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
};

function closestScrollable(target: EventTarget | null): PackScrollMetrics | null {
    if (target == null) return null;
    const el = target as Element;
    if (typeof el.closest !== "function") return null;
    return el.closest(SCROLLABLE_Y_SELECTOR) as unknown as PackScrollMetrics | null;
}

/**
 * Pure: does this region still have room to move further in `direction`
 * (1 = the gesture that reveals later content, i.e. the deck's "next";
 * -1 = the gesture that reveals earlier content, i.e. the deck's "prev")?
 * A region with no overflow has no room either way.
 */
export function regionHasScrollRoom(region: PackScrollMetrics, direction: 1 | -1): boolean {
    if (region.scrollHeight <= region.clientHeight) return false;
    if (direction > 0) return region.scrollTop + region.clientHeight < region.scrollHeight - 1;
    return region.scrollTop > 1;
}

/**
 * Shared by the deck's wheel and swipe handlers: should a gesture over
 * `target` advance/retreat the deck, or does it belong to a scrollable
 * region that can still move further in `direction` first? Edge-aware in
 * both directions for both gestures — at a scroller's boundary the gesture
 * falls through to the deck instead of being swallowed by an inner pane
 * that has nowhere left to go.
 */
export function shouldPackGestureAdvanceDeck(
    target: EventTarget | null,
    direction: 1 | -1,
): boolean {
    const region = closestScrollable(target);
    if (!region) return true;
    return !regionHasScrollRoom(region, direction);
}
