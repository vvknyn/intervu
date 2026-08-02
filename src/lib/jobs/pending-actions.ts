/**
 * Pending post-auth action state for /jobs (pure reducer).
 *
 * On /jobs a logged-out user can trigger three actions that require sign-in:
 *
 *   - apply   — "Mark as applied"  → write an application after login
 *   - gate    — any apply-adjacent CTA reachable signed out (card "Apply",
 *               detail "Go after this job", "Open posting") → after login,
 *               open the posting and write the tracker application, same as
 *               "Mark as applied" above. Job 2 (2026-08-01, Vivek: account
 *               creation BEFORE applying) deliberately funnels every such
 *               button into this ONE kind instead of each keeping its own
 *               pre-auth behavior, so a new gated button is covered by
 *               queuing "gate" too, not by adding another slot here or
 *               another replay case.
 *   - upload  — gate: open the resume-import modal
 *
 * (A fourth slot, "explore" — résumé-driven AI-suggested adjacent roles —
 * existed here through 2026-08-02; removed along with the feature when it
 * moved to MCP.)
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
 * (the page passes `PublicJob` for both apply and gate). That keeps it
 * runtime-dependency-free so it loads under `tsx` for unit tests without `@/`
 * path resolution. `upload` carries no payload of its own (it is a plain
 * "open the importer" flag), so its slot is a `boolean`.
 */

/** The three pending slots. At most one is ever non-empty (see `queuePending`).
 *  Empty in every slot is `null` (including `upload`, whose queued value is the
 *  `true` flag) so the state has one uniform "nothing here" sentinel. */
export interface PendingState<Apply, Gate> {
    apply: Apply | null;
    gate: Gate | null;
    upload: boolean | null;
}

/**
 * An action to queue (or that was taken for replay). `upload` carries a
 * `boolean` flag (always `true` when queued); the rest carry an opaque payload.
 */
export type PendingAction<Apply, Gate> =
    | { kind: "apply"; payload: Apply }
    | { kind: "gate"; payload: Gate }
    | { kind: "upload"; payload: boolean };

/** The empty / nothing-pending state. */
export function emptyPending<Apply, Gate>(): PendingState<Apply, Gate> {
    return { apply: null, gate: null, upload: null };
}

/** True when any action is queued for replay-after-auth. */
export function hasPending<Apply, Gate>(s: PendingState<Apply, Gate>): boolean {
    return s.apply !== null || s.gate !== null || s.upload !== null;
}

/**
 * Queue one action for replay after sign-in. Queuing ALWAYS clears the other
 * two slots, so only the latest user intent is ever pending — the core
 * invariant that prevents a stale apply/gate from co-existing with a newer
 * gate action (or vice versa).
 */
export function queuePending<Apply, Gate>(
    _prev: PendingState<Apply, Gate>,
    action: PendingAction<Apply, Gate>,
): PendingState<Apply, Gate> {
    const next = emptyPending<Apply, Gate>();
    switch (action.kind) {
        case "apply":
            next.apply = action.payload;
            break;
        case "gate":
            next.gate = action.payload;
            break;
        case "upload":
            next.upload = action.payload;
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
export function clearPending<Apply, Gate>(
    // Reducer shape `(prev, event) => next`; clearing ignores `prev` by design.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prev: PendingState<Apply, Gate>,
): PendingState<Apply, Gate> {
    return emptyPending<Apply, Gate>();
}

/**
 * Consume whatever should replay on sign-in. Returns the queued action (or
 * `null` if nothing is pending) and the `next` state, which is ALWAYS empty —
 * so a second sign-in / second take can never replay the same action twice.
 *
 * Slots are checked in a fixed order, but `queuePending` guarantees at most one
 * is set, so the order only matters as a defensive tie-break.
 */
export function takeReplay<Apply, Gate>(
    s: PendingState<Apply, Gate>,
): { next: PendingState<Apply, Gate>; action: PendingAction<Apply, Gate> | null } {
    const next = emptyPending<Apply, Gate>();
    if (s.apply !== null) return { next, action: { kind: "apply", payload: s.apply } };
    if (s.gate !== null) return { next, action: { kind: "gate", payload: s.gate } };
    if (s.upload !== null) return { next, action: { kind: "upload", payload: true } };
    return { next, action: null };
}

/**
 * Pure decision for any of the apply-adjacent gated CTAs: signed out
 * always opens the auth gate (queue + prompt sign-in), signed in always
 * performs the button's own action immediately. One function so the
 * signed-in/signed-out branch is expressed once and unit-testable without a
 * React user/session mock, instead of each call site in app/page.tsx
 * repeating its own `if (!user)` check.
 */
export function resolveApplyGateDecision(signedIn: boolean): "gate" | "perform" {
    return signedIn ? "perform" : "gate";
}
