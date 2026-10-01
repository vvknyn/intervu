/**
 * Document-level keyboard shortcuts for an opened pack's role stack:
 * `←` and `K` move to the previous role, `→` and `J` to the next, `S`
 * skips the open one. Up/Down are deliberately NOT here: each role card
 * scrolls, and Up/Down are how a keyboard reader scrolls it (they mirrored
 * Left/Right while the pack was a top-to-bottom list, until the stacked role
 * cards, 2026-09-30). Everything else (Space, PageDown, letters outside the
 * three sets below, …) is left alone so native scrolling and page
 * behavior keep working — this is an allowlist of handled keys, not a
 * denylist of blocked ones, so a new key never needs a new exclusion
 * rule here.
 *
 * `readTarget` is an injectable reader (default reads the real DOM, tests
 * supply a fake): the decision itself is a pure function over plain data,
 * real DOM access lives only in the default reader, and unit tests run
 * with no jsdom.
 */
export type DeckShortcutAction = "previous" | "next" | "skip";

export type ShortcutTargetInfo = {
    tagName: string;
    isContentEditable: boolean;
    insideDialog: boolean;
};

export type ShortcutTargetReader = (target: EventTarget | null) => ShortcutTargetInfo;

export type DeckShortcutEvent = {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
    target: EventTarget | null;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "k", "K"]);
const NEXT_KEYS = new Set(["ArrowRight", "j", "J"]);
const SKIP_KEYS = new Set(["s", "S"]);

const defaultReadTarget: ShortcutTargetReader = (target) => {
    if (!(target instanceof Element)) {
        return { tagName: "", isContentEditable: false, insideDialog: false };
    }
    return {
        tagName: target.tagName,
        isContentEditable: target instanceof HTMLElement && target.isContentEditable,
        insideDialog: target.closest('[role="dialog"]') !== null,
    };
};

/**
 * Pure: which deck action (if any) does this keydown represent? Blocks on
 * any modifier — including Shift, since Shift+Arrow has native
 * text-selection semantics this must not hijack — on an editable/dialog
 * target, and when the event already has a default-prevented handler.
 */
export function resolveDeckShortcut(
    event: DeckShortcutEvent,
    readTarget: ShortcutTargetReader = defaultReadTarget,
): DeckShortcutAction | null {
    if (event.defaultPrevented) return null;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
    const target = readTarget(event.target);
    if (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable || target.insideDialog) {
        return null;
    }
    if (PREVIOUS_KEYS.has(event.key)) return "previous";
    if (NEXT_KEYS.has(event.key)) return "next";
    if (SKIP_KEYS.has(event.key)) return "skip";
    return null;
}
