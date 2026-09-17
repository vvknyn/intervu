/**
 * Pending post-auth action state for /jobs — persisted across an auth
 * round trip.
 *
 * On /jobs a logged-out user can trigger four actions that require sign-in:
 *
 *   - apply   — "Mark as applied"  → write an application after login
 *   - gate    — legacy replay kind: after login, open the posting and write
 *               the tracker application. Guest Apply no longer queues this
 *               (2026-09-10: open ATS first, then auth with kind `"apply"` to
 *               track only). Stale persisted `"gate"` records still replay via
 *               the handler map; new guest apply clicks use `"apply"`.
 *   - upload  — gate: open the resume-import modal
 *   - report  — flag/report a job → after login, reopen the report dialog
 *               for that job and let the user resubmit
 *
 * (A fifth kind, "explore" — résumé-driven AI-suggested adjacent roles —
 * existed here through 2026-08-02; removed along with the feature when it
 * moved to MCP.)
 *
 * `persistPendingAction` mirrors one action into `sessionStorage` ahead of a
 * hard-nav auth handoff (WorkOS AuthKit's OAuth/passkey flow reloads the
 * document via `window.location.href`, dropping every in-memory ref/state)
 * — that same write also covers the in-place login case for free (write,
 * then read back moments later, same tab). The bug this module exists to
 * kill: a persisted action that survives a DISMISS and then fires after an
 * *unrelated* later sign-in (e.g. the global sidebar "Sign in"), silently
 * writing a phantom application or popping a dialog for a job the user
 * abandoned. The fix is that `takePersistedPendingAction` ALWAYS clears the
 * record the moment it's read — matched, invalid, expired, or
 * path-mismatched — so a queued action can never replay twice or survive
 * past the sign-in that follows it.
 *
 * Purity: the module never inspects the payloads — they are opaque generics
 * (the page passes `PublicJob` for apply/gate/report). That keeps it
 * runtime-dependency-free so it loads under `tsx` for unit tests without `@/`
 * path resolution. `upload` carries no payload of its own (it is a plain
 * "open the importer" flag), so its slot is a `boolean`.
 */

/** The four kinds of pending action — the single source of truth
 *  `PendingAction`'s `kind` union AND this module's own persisted-record
 *  validation both derive from. A new kind is covered by adding it here
 *  once, not by touching a second list. */
export const PENDING_ACTION_KINDS = ["apply", "gate", "upload", "report"] as const;

export type PendingActionKind = (typeof PENDING_ACTION_KINDS)[number];

/** Maps each kind to its payload type. */
interface PendingActionPayloadByKind<Apply, Gate, Report> {
    apply: Apply;
    gate: Gate;
    upload: boolean;
    report: Report;
}

/**
 * An action to queue (or that was taken for replay). Distributed over
 * `PendingActionKind` so a new entry added to `PENDING_ACTION_KINDS` is a
 * type error here until `PendingActionPayloadByKind` supplies its payload
 * type — there is no second enumeration of kinds to keep in sync.
 */
export type PendingAction<Apply, Gate, Report = Gate> = {
    [K in PendingActionKind]: { kind: K; payload: PendingActionPayloadByKind<Apply, Gate, Report>[K] };
}[PendingActionKind];

function isKnownPendingActionKind(kind: unknown): kind is PendingActionKind {
    return typeof kind === "string" && (PENDING_ACTION_KINDS as readonly string[]).includes(kind);
}

/**
 * Cross-navigation persistence: survives a hard-nav auth round trip (WorkOS
 * AuthKit for OAuth/passkeys reloads the document via `window.location.href`,
 * which drops every React ref/state). `sessionStorage` is tab-scoped — dies
 * with the tab, never leaks an intent into a different tab or a later day —
 * which is exactly the lifetime a "finish what I was doing" prompt needs.
 *
 * A single key: at most one pending action exists at a time, so persisting
 * one action is a plain overwrite, not a queue.
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
 * gate — it just means neither the OAuth-return nor the in-place replay can
 * happen, and the user re-does the gated click after signing in manually.
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

/** Clear a persisted action — the dismiss-without-auth transition's storage
 *  side effect. Also best-effort; see `persistPendingAction`. */
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
 * Runtime shape guard for a persisted record fresh off `JSON.parse` — the
 * one place this module trusts `sessionStorage` contents. `action.payload`
 * itself stays unchecked (opaque generic, see module doc); only the fields
 * `takePersistedPendingAction`'s own callers (`useAuthGate`'s `runHandler`
 * dispatch and `window.scrollTo`) dereference are validated here.
 */
function isValidPersistedPendingActionShape(value: unknown): value is {
    returnTo: string;
    createdAt: number;
    scrollY?: number;
    action: { kind: PendingActionKind; payload: unknown };
} {
    if (!value || typeof value !== "object") return false;
    const r = value as Record<string, unknown>;
    if (typeof r.returnTo !== "string") return false;
    if (typeof r.createdAt !== "number") return false;
    if (r.scrollY !== undefined && !(typeof r.scrollY === "number" && Number.isFinite(r.scrollY) && r.scrollY >= 0)) {
        return false;
    }
    if (!r.action || typeof r.action !== "object") return false;
    if (!isKnownPendingActionKind((r.action as Record<string, unknown>).kind)) return false;
    return true;
}

/**
 * Consume a persisted action on return from a hard-nav auth round trip.
 * Always clears the stored record — matched, invalid, expired, or
 * path-mismatched — so a stale or malformed record can never be read a
 * second time; a record is returned only when its shape is safe to dispatch
 * (validated above) AND it belongs on the page currently mounting it AND
 * hasn't expired.
 *
 * Shape validation matters because `JSON.parse` hands back `any`: a record
 * written by an older/newer deploy (a `PendingAction` kind added or removed
 * — see this file's own "explore" kind, removed 2026-08-02) or corrupted by
 * hand-editing sessionStorage must never reach `useAuthGate`'s `runHandler`
 * with an `action.kind` no handler map has a case for, or a non-numeric
 * `scrollY` headed for `window.scrollTo`.
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

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isValidPersistedPendingActionShape(parsed)) return null;

    const record: PersistedPendingAction<Apply, Gate, Report> = {
        returnTo: parsed.returnTo,
        createdAt: parsed.createdAt,
        scrollY: parsed.scrollY ?? 0,
        action: parsed.action as PendingAction<Apply, Gate, Report>,
    };

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

/** Signed-in vs guest Apply click — one function so both entry points share
 *  the same branch without each repeating `if (!user)`. Guests open the ATS
 *  synchronously in the click gesture, then auth tracks the application;
 *  signed-in users go straight to apply-intent / departure. */
export type ApplyClickDecision = "perform" | "open-then-auth";

export function resolveApplyClickDecision(signedIn: boolean): ApplyClickDecision {
    return signedIn ? "perform" : "open-then-auth";
}
