/**
 * Pending post-auth action state for /jobs (pure reducer).
 *
 * On /jobs a logged-out user can trigger four actions that require sign-in:
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
 *   - report  — flag/report a job → after login, reopen the report dialog
 *               for that job and let the user resubmit
 *
 * (A fifth slot, "explore" — résumé-driven AI-suggested adjacent roles —
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
 * (the page passes `PublicJob` for apply/gate/report). That keeps it
 * runtime-dependency-free so it loads under `tsx` for unit tests without `@/`
 * path resolution. `upload` carries no payload of its own (it is a plain
 * "open the importer" flag), so its slot is a `boolean`.
 *
 * A second, independent mechanism lives below the reducer: `persistPendingAction`
 * / `takePersistedPendingAction` mirror one action into `sessionStorage` so it
 * survives a hard navigation away from the page entirely (WorkOS AuthKit's
 * OAuth/passkey handoff reloads the document — the in-memory reducer above is
 * gone when the tab comes back). Same "queue → replay-once → clear" shape,
 * same opaque-payload purity, just durable across a reload instead of a ref.
 */

/** The four pending slots. At most one is ever non-empty (see `queuePending`).
 *  Empty in every slot is `null` (including `upload`, whose queued value is the
 *  `true` flag) so the state has one uniform "nothing here" sentinel. */
export interface PendingState<Apply, Gate, Report = Gate> {
    apply: Apply | null;
    gate: Gate | null;
    upload: boolean | null;
    report: Report | null;
}

/**
 * An action to queue (or that was taken for replay). `upload` carries a
 * `boolean` flag (always `true` when queued); the rest carry an opaque payload.
 */
export type PendingAction<Apply, Gate, Report = Gate> =
    | { kind: "apply"; payload: Apply }
    | { kind: "gate"; payload: Gate }
    | { kind: "upload"; payload: boolean }
    | { kind: "report"; payload: Report };

/** The empty / nothing-pending state. */
export function emptyPending<Apply, Gate, Report = Gate>(): PendingState<Apply, Gate, Report> {
    return { apply: null, gate: null, upload: null, report: null };
}

/** True when any action is queued for replay-after-auth. */
export function hasPending<Apply, Gate, Report = Gate>(s: PendingState<Apply, Gate, Report>): boolean {
    return s.apply !== null || s.gate !== null || s.upload !== null || s.report !== null;
}

/**
 * Queue one action for replay after sign-in. Queuing ALWAYS clears the other
 * slots, so only the latest user intent is ever pending — the core
 * invariant that prevents a stale apply/gate from co-existing with a newer
 * gate action (or vice versa).
 */
export function queuePending<Apply, Gate, Report = Gate>(
    _prev: PendingState<Apply, Gate, Report>,
    action: PendingAction<Apply, Gate, Report>,
): PendingState<Apply, Gate, Report> {
    const next = emptyPending<Apply, Gate, Report>();
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
        case "report":
            next.report = action.payload;
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
export function clearPending<Apply, Gate, Report = Gate>(
    // Reducer shape `(prev, event) => next`; clearing ignores `prev` by design.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prev: PendingState<Apply, Gate, Report>,
): PendingState<Apply, Gate, Report> {
    return emptyPending<Apply, Gate, Report>();
}

/**
 * Consume whatever should replay on sign-in. Returns the queued action (or
 * `null` if nothing is pending) and the `next` state, which is ALWAYS empty —
 * so a second sign-in / second take can never replay the same action twice.
 *
 * Slots are checked in a fixed order, but `queuePending` guarantees at most one
 * is set, so the order only matters as a defensive tie-break.
 */
export function takeReplay<Apply, Gate, Report = Gate>(
    s: PendingState<Apply, Gate, Report>,
): { next: PendingState<Apply, Gate, Report>; action: PendingAction<Apply, Gate, Report> | null } {
    const next = emptyPending<Apply, Gate, Report>();
    if (s.apply !== null) return { next, action: { kind: "apply", payload: s.apply } };
    if (s.gate !== null) return { next, action: { kind: "gate", payload: s.gate } };
    if (s.upload !== null) return { next, action: { kind: "upload", payload: true } };
    if (s.report !== null) return { next, action: { kind: "report", payload: s.report } };
    return { next, action: null };
}

/**
 * Cross-navigation persistence: survives a hard-nav auth round trip (WorkOS
 * AuthKit for OAuth/passkeys reloads the document via `window.location.href`,
 * which drops every React ref/state). `sessionStorage` is tab-scoped — dies
 * with the tab, never leaks an intent into a different tab or a later day —
 * which is exactly the lifetime a "finish what I was doing" prompt needs.
 *
 * A single key: like the in-memory reducer above, at most one pending action
 * exists at a time, so persisting one action is a plain overwrite, not a queue.
 */
export const PENDING_ACTION_STORAGE_KEY = "velai.auth.pendingAction";

/** The subset of the `Storage` interface these helpers need — small enough to
 *  hand-mock in unit tests without `jsdom`, and satisfied by real `sessionStorage`. */
export interface PendingActionStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** A persisted pending action: the action itself, where to return the user to
 *  replay it, how far down the page they were, and when it was queued (for
 *  expiry). `returnTo` is `pathname + search + hash` — see `buildReturnTo`. */
export interface PersistedPendingAction<Apply, Gate, Report> {
    action: PendingAction<Apply, Gate, Report>;
    returnTo: string;
    scrollY: number;
    createdAt: number;
}

/** `pathname + search + hash` — the round-trippable "come back here" target,
 *  built once at gate time so persistence never re-derives it from a URL that
 *  may have changed by the time it's read back. */
export function buildReturnTo(location: Pick<Location, "pathname" | "search" | "hash">): string {
    return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Persist one action ahead of a hard-nav auth handoff. Best-effort: a full or
 * blocked `sessionStorage` (private browsing, quota) must never crash the
 * gate — it just means the OAuth-return replay silently can't happen, same
 * as today, while the in-memory reducer still covers in-place login.
 */
export function persistPendingAction<Apply, Gate, Report>(
    storage: PendingActionStorage,
    record: PersistedPendingAction<Apply, Gate, Report>,
): void {
    try {
        storage.setItem(PENDING_ACTION_STORAGE_KEY, JSON.stringify(record));
    } catch {
        // Best-effort persistence — see function doc.
    }
}

/** Clear a persisted action — the dismiss-without-auth transition's durable
 *  counterpart to `clearPending`. Also best-effort; see `persistPendingAction`. */
export function clearPersistedPendingAction(storage: PendingActionStorage): void {
    try {
        storage.removeItem(PENDING_ACTION_STORAGE_KEY);
    } catch {
        // Best-effort — see persistPendingAction.
    }
}

const DEFAULT_MAX_PENDING_ACTION_AGE_MS = 15 * 60_000;

export interface TakePersistedPendingActionOptions {
    /** The path the caller is currently rendering (e.g. `usePathname()`),
     *  compared against the persisted record's `returnTo` pathname. */
    currentPath: string;
    /** Injected clock (`Date.now()`), for deterministic expiry tests. */
    now: number;
    maxAgeMs?: number;
}

/**
 * Consume a persisted action on return from a hard-nav auth round trip.
 * Always clears the stored record — matched, expired, or path-mismatched —
 * so a stale record can never be read a second time; it is returned only
 * when it belongs on the page currently mounting it and hasn't expired.
 *
 * The path check matters because sessionStorage is tab-scoped but not
 * page-scoped: a user could queue an action on job A, then (same tab)
 * navigate to job B before ever authenticating. Replaying on the wrong page
 * would be the same "phantom action on an abandoned job" bug this module
 * exists to kill, just via the durable path instead of the in-memory one.
 */
export function takePersistedPendingAction<Apply, Gate, Report>(
    storage: PendingActionStorage,
    { currentPath, now, maxAgeMs = DEFAULT_MAX_PENDING_ACTION_AGE_MS }: TakePersistedPendingActionOptions,
): PersistedPendingAction<Apply, Gate, Report> | null {
    let raw: string | null;
    try {
        raw = storage.getItem(PENDING_ACTION_STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;

    clearPersistedPendingAction(storage);

    let record: PersistedPendingAction<Apply, Gate, Report>;
    try {
        record = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!record || typeof record.returnTo !== "string" || typeof record.createdAt !== "number") return null;

    if (now - record.createdAt > maxAgeMs) return null;

    let recordPath: string;
    try {
        recordPath = new URL(record.returnTo, "http://localhost").pathname;
    } catch {
        return null;
    }
    if (recordPath !== currentPath) return null;

    return record;
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
