/**
 * Pending post-auth action state for /jobs (pure reducer).
 *
 * On /jobs a logged-out user can trigger four actions that require sign-in:
 *
 *   - apply   — "Mark as applied"  → write an application after login
 *   - tailor  — "Apply with tailored resume" → open the analysis slideout
 *   - upload  — gate: open the resume-import modal
 *   - explore — gate: spend an AI credit on adjacent-role suggestions
 *
 * Each queues itself and pops the auth popover; a post-auth effect replays the
 * queued action once the user appears. The bug this module exists to kill: a
 * queued action that survives a DISMISS and then fires after an *unrelated*
 * later sign-in (e.g. the global sidebar "Log in"), silently writing a phantom
 * application or popping a sheet for a job the user abandoned.
 *
 * The fix is to funnel every queue / dismiss / replay through these pure
 * transitions so the invariant "only the latest action is ever pending, and a
 * cleared state replays nothing" is enforced in one tested place rather than
 * scattered across imperative ref mutations in the page component.
 *
 * Purity: the module never inspects the payloads — they are opaque generics
 * (the page passes `PublicJob` for apply/tailor and `ResumeData` for explore).
 * That keeps it runtime-dependency-free so it loads under `tsx` for unit tests
 * without `@/` path resolution. `upload` carries no payload of its own (it is a
 * plain "open the importer" flag), so its slot is a `boolean`.
 */

/** The four pending slots. At most one is ever non-empty (see `queuePending`).
 *  Empty in every slot is `null` (including `upload`, whose queued value is the
 *  `true` flag) so the state has one uniform "nothing here" sentinel. */
export interface PendingState<Apply, Tailor, Explore> {
    apply: Apply | null;
    tailor: Tailor | null;
    upload: boolean | null;
    explore: Explore | null;
}

/**
 * An action to queue (or that was taken for replay). `upload` carries a
 * `boolean` flag (always `true` when queued); the rest carry an opaque payload.
 */
export type PendingAction<Apply, Tailor, Explore> =
    | { kind: "apply"; payload: Apply }
    | { kind: "tailor"; payload: Tailor }
    | { kind: "upload"; payload: boolean }
    | { kind: "explore"; payload: Explore };

/** The empty / nothing-pending state. */
export function emptyPending<Apply, Tailor, Explore>(): PendingState<Apply, Tailor, Explore> {
    return { apply: null, tailor: null, upload: null, explore: null };
}

/** True when any action is queued for replay-after-auth. */
export function hasPending<Apply, Tailor, Explore>(s: PendingState<Apply, Tailor, Explore>): boolean {
    return s.apply !== null || s.tailor !== null || s.upload !== null || s.explore !== null;
}

/**
 * Queue one action for replay after sign-in. Queuing ALWAYS clears the other
 * three slots, so only the latest user intent is ever pending — the core
 * invariant that prevents a stale apply/tailor from co-existing with a newer
 * gate action (or vice versa).
 */
export function queuePending<Apply, Tailor, Explore>(
    _prev: PendingState<Apply, Tailor, Explore>,
    action: PendingAction<Apply, Tailor, Explore>,
): PendingState<Apply, Tailor, Explore> {
    const next = emptyPending<Apply, Tailor, Explore>();
    switch (action.kind) {
        case "apply":
            next.apply = action.payload;
            break;
        case "tailor":
            next.tailor = action.payload;
            break;
        case "upload":
            next.upload = action.payload;
            break;
        case "explore":
            next.explore = action.payload;
            break;
    }
    return next;
}

/**
 * Clear everything pending — the alternate-path / dismiss transition. Called
 * when the user takes any *other* action (start a results mode, pick a
 * different gate path) or dismisses the popover without authenticating, so a
 * later unrelated sign-in replays nothing.
 */
export function clearPending<Apply, Tailor, Explore>(
    // Reducer shape `(prev, event) => next`; clearing ignores `prev` by design.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prev: PendingState<Apply, Tailor, Explore>,
): PendingState<Apply, Tailor, Explore> {
    return emptyPending<Apply, Tailor, Explore>();
}

/**
 * Consume whatever should replay on sign-in. Returns the queued action (or
 * `null` if nothing is pending) and the `next` state, which is ALWAYS empty —
 * so a second sign-in / second take can never replay the same action twice.
 *
 * Slots are checked in a fixed order, but `queuePending` guarantees at most one
 * is set, so the order only matters as a defensive tie-break.
 */
export function takeReplay<Apply, Tailor, Explore>(
    s: PendingState<Apply, Tailor, Explore>,
): { next: PendingState<Apply, Tailor, Explore>; action: PendingAction<Apply, Tailor, Explore> | null } {
    const next = emptyPending<Apply, Tailor, Explore>();
    if (s.apply !== null) return { next, action: { kind: "apply", payload: s.apply } };
    if (s.tailor !== null) return { next, action: { kind: "tailor", payload: s.tailor } };
    if (s.upload !== null) return { next, action: { kind: "upload", payload: true } };
    if (s.explore !== null) return { next, action: { kind: "explore", payload: s.explore } };
    return { next, action: null };
}
