import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";

/**
 * The pack view's stacked role cards ("Tip back under", Vivek 2026-09-30).
 * The open role is the front card. The next role waits below the stage and
 * slides up over it; the role it covers tips back, shrinks and dims into the
 * stack behind. Previous plays the same move in reverse.
 *
 * Poses are CSS (`.role-stack-card[data-stack-pose]`, globals.css). This
 * module only decides which roles are on the stage and in which pose, so the
 * order and the window are unit-testable without a DOM.
 */
export type RoleStackPose = "front" | "upcoming" | "behind-1" | "behind-2" | "gone" | "departing";

/** Roles kept behind the front card. The deepest one sits at `gone`
 *  (invisible), so Previous has a card to bring back to `behind-2`. */
export const ROLE_STACK_BEHIND = 3;

/** Roles kept ahead of the front card, waiting below the stage. */
export const ROLE_STACK_AHEAD = 1;

export function poseForOffset(offset: number): RoleStackPose {
    if (offset === 0) return "front";
    if (offset > 0) return "upcoming";
    if (offset === -1) return "behind-1";
    if (offset === -2) return "behind-2";
    return "gone";
}

export interface RoleStackEntry<T> {
    key: string;
    item: T;
    pose: RoleStackPose;
    /** The open role. Only its card is interactive and carries the pack's
     *  test ids, even on the first frame while it still waits below the stage. */
    active: boolean;
}

/**
 * The cards on the stage, in DOM order. A later card paints over an earlier
 * one, so list order is stacking order and no z-index is needed.
 *
 * - `departing` is a role Skip just removed from the list. It stays on the
 *   stage one more beat, where it was (just before the new front card), so it
 *   tips back under the role that replaced it and fades out.
 * - `entered: false` is the first frame after the stack mounts: the front card
 *   starts below the stage so opening a pack plays the same slide up.
 *
 * Existing cards never change relative order between two calls (new ones only
 * join at either end, and the departing card keeps its old slot), so React
 * keeps every DOM node in place and each pose change is a CSS transition.
 */
export function roleStackEntries<T extends { id: string }>(
    items: readonly T[],
    activeIndex: number,
    options: { departing?: T | null; entered?: boolean } = {},
): RoleStackEntry<T>[] {
    const { departing = null, entered = true } = options;
    const entries: RoleStackEntry<T>[] = [];
    if (items.length > 0) {
        const active = clampDeckIndex(activeIndex, items.length);
        const start = Math.max(0, active - ROLE_STACK_BEHIND);
        const end = Math.min(items.length - 1, active + ROLE_STACK_AHEAD);
        for (let index = start; index <= end; index++) {
            const offset = index - active;
            const pose = offset === 0 && !entered ? "upcoming" : poseForOffset(offset);
            entries.push({ key: items[index].id, item: items[index], pose, active: offset === 0 });
        }
    }
    if (departing && !entries.some((entry) => entry.key === departing.id)) {
        const front = entries.findIndex((entry) => entry.active);
        const at = front === -1 ? entries.length : front;
        entries.splice(at, 0, { key: departing.id, item: departing, pose: "departing", active: false });
    }
    return entries;
}
