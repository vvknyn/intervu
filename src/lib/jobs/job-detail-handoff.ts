/**
 * When the SERP detail surface should play its signature clip/overlap
 * handoff. Keyed on selection identity + explicit open (`?job=`), never on
 * search/filter text: ambient xl+ preview of hits[0] and keystroke refetch
 * must not replay motion. Split out of JobDetailHandoff so the branches are
 * unit-testable without a React harness (same split as thread-render-mode.ts).
 *
 * `reducedMotion` is framer-motion's `useReducedMotion()` value — `null`
 * before the listener attaches (SSR / first paint) — treated like `false`
 * (play clip) so a hydration flash doesn't skip the instrument motion for
 * the common case.
 */
export type JobDetailHandoffSurface = "pane" | "sheet";
export type JobDetailHandoffKind = "clip" | "fade" | "none";

export function resolveJobDetailHandoff(input: {
    previousId: string | null;
    nextId: string | null;
    previousExplicit: boolean;
    nextExplicit: boolean;
    surface: JobDetailHandoffSurface;
    reducedMotion: boolean | null;
}): JobDetailHandoffKind {
    const { previousId, nextId, previousExplicit, nextExplicit, surface, reducedMotion } = input;

    if (!nextId) return "none";
    if (!nextExplicit) return "none";

    const identityChanged = previousId !== nextId;
    const explicitChanged = previousExplicit !== nextExplicit;

    if (!identityChanged && !explicitChanged) return "none";

    if (!identityChanged && explicitChanged && nextExplicit && surface === "pane") {
        return "none";
    }

    const shouldPlay =
        (!identityChanged && explicitChanged && nextExplicit && surface === "sheet") ||
        (identityChanged && nextExplicit);

    if (!shouldPlay) return "none";

    if (reducedMotion === true) return "fade";
    return "clip";
}
