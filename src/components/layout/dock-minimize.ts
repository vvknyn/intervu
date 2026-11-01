/**
 * When the phone dock minimizes (Apple's tab bar behaviour, HIG "Tab bars":
 * "minimize the tab bar and move the accessory inline with it when a person
 * scrolls down ... exit the minimized state by tapping a tab or scrolling to
 * the top"). Pure, so the rule is unit-tested instead of read off a device.
 *
 * Minimized while a person is reading down the page; full again on a short
 * scroll up, at the top of the page, or when the accessory has come to rest in
 * the page (the end of it), where there is nothing left to get out of the way.
 * `globals.css` draws both states from `<html data-dock="min|full">`.
 */
export type DockState = {
    minimized: boolean;
    /** Signed distance scrolled in the current direction, px. */
    run: number;
    lastY: number;
};

/** Within this many px of the top the dock is always full. */
export const DOCK_TOP_ZONE = 80;
/** A run this long downward minimizes the dock. */
export const DOCK_DOWN_RUN = 24;
/** A run this long upward restores it: shorter, so coming back is easy. */
export const DOCK_UP_RUN = 12;

export const initialDockState = (y = 0): DockState => ({ minimized: false, run: 0, lastY: y });

/**
 * One scroll event. `maxY` is the furthest the page scrolls; `accessoryResting`
 * is true when the accessory capsule has left its stuck position and sits in
 * the page (see MobileTabBar).
 */
export function stepDock(state: DockState, rawY: number, maxY: number, accessoryResting: boolean): DockState {
    // iOS rubber-banding reports scroll positions past either end.
    const y = Math.min(Math.max(rawY, 0), Math.max(maxY, 0));
    const dy = y - state.lastY;
    if (y < DOCK_TOP_ZONE || accessoryResting) return { minimized: false, run: 0, lastY: y };
    if (dy === 0) return { ...state, lastY: y };
    // A change of direction starts a new run.
    const run = Math.sign(dy) === Math.sign(state.run) ? state.run + dy : dy;
    if (run >= DOCK_DOWN_RUN) return { minimized: true, run, lastY: y };
    if (run <= -DOCK_UP_RUN) return { minimized: false, run, lastY: y };
    return { minimized: state.minimized, run, lastY: y };
}
