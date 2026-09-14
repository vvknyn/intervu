/**
 * A scroll region inside a pack is detected by the real mechanism that
 * makes an element scrollable — computed `overflow-y: auto|scroll|overlay`
 * plus actual overflowing content (`scrollHeight > clientHeight`) — not by
 * a class-name spelling list. A spelling list (`.overflow-y-auto`,
 * `.overflow-y-scroll`) misses `lg:overflow-y-auto`, `overflow-auto`, an
 * arbitrary `[overflow-y:auto]`, or an inline style, and is exactly the
 * same class of bug as the two attribute lists this replaced (wheel and
 * swipe each independently choosing what counts as "a scroller").
 *
 * The walk is bounded by `boundary` (the deck root, passed by the caller as
 * `event.currentTarget`) so a scrollable ancestor OUTSIDE the deck can
 * never swallow a gesture made over a non-scrolling part of the card.
 *
 * `readStyle` defaults to the real `getComputedStyle` but is an injectable
 * parameter so this stays unit-testable with plain objects — no jsdom.
 */
export type PackScrollMetrics = {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
};

export type ScrollableCandidate = PackScrollMetrics & {
    parentElement: ScrollableCandidate | null;
};

export type StyleReader = (el: ScrollableCandidate) => { overflowY: string };

const SCROLLABLE_OVERFLOW_Y = new Set(["auto", "scroll", "overlay"]);

function isScrollableElement(el: ScrollableCandidate, readStyle: StyleReader): boolean {
    if (!SCROLLABLE_OVERFLOW_Y.has(readStyle(el).overflowY)) return false;
    return el.scrollHeight > el.clientHeight;
}

function findScrollableAncestor(
    target: EventTarget | null,
    boundary: EventTarget | null,
    readStyle: StyleReader,
): ScrollableCandidate | null {
    let el = target as ScrollableCandidate | null;
    while (el && (el as unknown as EventTarget) !== boundary) {
        if (isScrollableElement(el, readStyle)) return el;
        el = el.parentElement;
    }
    return null;
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

const defaultReadStyle: StyleReader = (el) => getComputedStyle(el as unknown as Element);

/**
 * Shared by the deck's wheel and swipe handlers: should a gesture over
 * `target` advance/retreat the deck, or does it belong to a scrollable
 * region (between `target` and `boundary`, exclusive of `boundary`) that
 * can still move further in `direction` first? Edge-aware in both
 * directions for both gestures — at a scroller's boundary the gesture
 * falls through to the deck instead of being swallowed by an inner pane
 * that has nowhere left to go.
 */
export function shouldPackGestureAdvanceDeck(
    target: EventTarget | null,
    boundary: EventTarget | null,
    direction: 1 | -1,
    readStyle: StyleReader = defaultReadStyle,
): boolean {
    const region = findScrollableAncestor(target, boundary, readStyle);
    if (!region) return true;
    return !regionHasScrollRoom(region, direction);
}
