/**
 * Pure deck commit lifecycle — CSS uses @keyframes animations (animationend),
 * not transitions. Guards bubbled child animation events.
 */

export const DECK_ANIMATION_NAME = {
    exitNext: "deck-slide-out-next",
    exitPrevious: "deck-slide-out-previous",
    enterNext: "deck-slide-in-next",
    enterPrevious: "deck-slide-in-previous",
} as const;

export type DeckCommitPhase = "idle" | "drag" | "commit-out" | "commit-in" | "commit-cross";
export type DeckMotionRole = "outgoing" | "incoming";
export type DeckMotionDirection = "next" | "previous";

export function expectedDeckAnimationName(
    phase: DeckCommitPhase,
    role: DeckMotionRole,
    direction: DeckMotionDirection | null,
): string | null {
    if (!direction) return null;
    if (phase === "commit-out" && role === "outgoing") {
        return direction === "next" ? DECK_ANIMATION_NAME.exitNext : DECK_ANIMATION_NAME.exitPrevious;
    }
    if (phase === "commit-in" && role === "incoming") {
        return direction === "next" ? DECK_ANIMATION_NAME.enterNext : DECK_ANIMATION_NAME.enterPrevious;
    }
    if (phase === "commit-cross") {
        if (role === "outgoing") {
            return direction === "next" ? DECK_ANIMATION_NAME.exitNext : DECK_ANIMATION_NAME.exitPrevious;
        }
        if (role === "incoming") {
            return direction === "next" ? DECK_ANIMATION_NAME.enterNext : DECK_ANIMATION_NAME.enterPrevious;
        }
    }
    return null;
}

export function shouldAcceptDeckAnimationEnd(input: {
    phase: DeckCommitPhase;
    role: DeckMotionRole;
    direction: DeckMotionDirection | null;
    animationName: string;
    eventTarget: EventTarget | null;
    currentTarget: EventTarget | null;
}): boolean {
    if (input.eventTarget !== input.currentTarget) return false;
    const expected = expectedDeckAnimationName(input.phase, input.role, input.direction);
    if (!expected) return false;
    return input.animationName === expected;
}

export type DeckMotionEndResult =
    | { kind: "noop" }
    | { kind: "navigate" }
    | { kind: "enter-incoming" }
    | { kind: "reset-idle" };

/** Deck index commits skip CSS animation (and animationend) when reduced motion is on. */
export function deckCommitUsesDeckAnimation(reducedMotion: boolean): boolean {
    return !reducedMotion;
}

/** When motion is instant, never wait for animationend — flush commit phases immediately. */
export function flushInstantDeckCommit(input: {
    reducedMotion: boolean;
    phase: DeckCommitPhase;
    direction: DeckMotionDirection | null;
}):
    | { action: "none" }
    | { action: "navigate-then-idle"; direction: DeckMotionDirection }
    | { action: "reset-idle" } {
    if (!input.reducedMotion) return { action: "none" };
    if (input.phase === "idle" || input.phase === "drag") return { action: "none" };
    if (input.phase === "commit-out") {
        if (!input.direction) return { action: "reset-idle" };
        return { action: "navigate-then-idle", direction: input.direction };
    }
    return { action: "reset-idle" };
}

/** Advance commit state machine when a deck-layer animation completes. */
export function reduceDeckAnimationEnd(
    phase: DeckCommitPhase,
    role: DeckMotionRole,
): DeckMotionEndResult {
    if (phase === "commit-cross") {
        return role === "incoming" ? { kind: "reset-idle" } : { kind: "noop" };
    }
    if (phase === "commit-out" && role === "outgoing") {
        return { kind: "enter-incoming" };
    }
    if (phase === "commit-in" && role === "incoming") {
        return { kind: "reset-idle" };
    }
    return { kind: "noop" };
}
