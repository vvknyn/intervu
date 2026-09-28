/**
 * Pending post-auth action state for /jobs — persisted across an auth
 * round trip.
 *
 * On /jobs a logged-out user can trigger three actions that require sign-in:
 *
 *   - apply   — optional guest tracker prompt after Apply opens the employer
 *               site; after sign-in, resume tracking (apply-intent / mark
 *               applied) rather than blocking the outbound click.
 *   - upload  — gate: open the resume-import modal
 *   - report  — flag/report a job → after login, reopen the report dialog
 *               for that job and let the user resubmit
 *
 * (A legacy `"gate"` kind — open the posting and write the tracker
 * application on replay — was superseded 2026-09-10 and retired 2026-09-18
 * once guest Apply opened the ATS before auth (retired 2026-09-18);
 * removed here the same day once nothing wrote it any more. A fifth kind,
 * "explore" — résumé-driven AI-suggested adjacent roles — existed here
 * through 2026-08-02; removed along with the feature when it moved to MCP.)
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
 * (a page passes `PublicJob` for apply/report). That keeps it
 * runtime-dependency-free so it loads under `tsx` for unit tests without `@/`
 * path resolution. `upload` carries no payload of its own (it is a plain
 * "open the importer" flag), so its slot is a `boolean`.
 */

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import type { OriginSurface } from "@/lib/auth/gate-attempt";

/** The three kinds of pending action — the single source of truth
 *  `PendingAction`'s `kind` union AND this module's own persisted-record
 *  validation both derive from. A new kind is covered by adding it here
 *  once, not by touching a second list. */
export const PENDING_ACTION_KINDS = ["apply", "upload", "report"] as const;

export type PendingActionKind = (typeof PENDING_ACTION_KINDS)[number];

/** Maps each kind to its payload type. */
interface PendingActionPayloadByKind<Apply, Report> {
    apply: Apply;
    upload: boolean;
    report: Report;
}

/**
 * An action to queue (or that was taken for replay). Distributed over
 * `PendingActionKind` so a new entry added to `PENDING_ACTION_KINDS` is a
 * type error here until `PendingActionPayloadByKind` supplies its payload
 * type — there is no second enumeration of kinds to keep in sync.
 */
export type PendingAction<Apply, Report = Apply> = {
    [K in PendingActionKind]: { kind: K; payload: PendingActionPayloadByKind<Apply, Report>[K] };
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
export interface PersistedPendingAction<Apply, Report> {
    action: PendingAction<Apply, Report>;
    returnTo: string;
    scrollY: number;
    createdAt: number;
    /** Stable anonymous attempt id — reused through signup when present. */
    pendingActionId?: string;
    gateReason?: AuthGateReason;
    firstGateReason?: AuthGateReason;
    lastGateReason?: AuthGateReason;
    originSurface?: OriginSurface;
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
export function persistPendingAction<Apply, Report>(
    storage: PendingActionStorage,
    record: PersistedPendingAction<Apply, Report>,
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

/** Read a queued action kind without consuming — for post-auth routing only. */
export function peekPendingActionKind(storage: PendingActionStorage): PendingActionKind | null {
    let raw: string | null;
    try {
        raw = storage.getItem(PENDING_ACTION_STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isValidPersistedPendingActionShape(parsed)) return null;
        return parsed.action.kind;
    } catch {
        return null;
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
    pendingActionId?: string;
    gateReason?: string;
    firstGateReason?: string;
    lastGateReason?: string;
    originSurface?: string;
    action: { kind: PendingActionKind; payload: unknown };
} {
    if (!value || typeof value !== "object") return false;
    const r = value as Record<string, unknown>;
    if (typeof r.returnTo !== "string") return false;
    if (typeof r.createdAt !== "number") return false;
    if (r.scrollY !== undefined && !(typeof r.scrollY === "number" && Number.isFinite(r.scrollY) && r.scrollY >= 0)) {
        return false;
    }
    if (r.pendingActionId !== undefined && typeof r.pendingActionId !== "string") return false;
    if (r.gateReason !== undefined && typeof r.gateReason !== "string") return false;
    if (r.firstGateReason !== undefined && typeof r.firstGateReason !== "string") return false;
    if (r.lastGateReason !== undefined && typeof r.lastGateReason !== "string") return false;
    if (r.originSurface !== undefined && typeof r.originSurface !== "string") return false;
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
export function takePersistedPendingAction<Apply, Report>(
    storage: PendingActionStorage,
    { currentPath, now, maxAgeMs = DEFAULT_MAX_PENDING_ACTION_AGE_MS }: TakePersistedPendingActionOptions,
): PersistedPendingAction<Apply, Report> | null {
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

    const record: PersistedPendingAction<Apply, Report> = {
        returnTo: parsed.returnTo,
        createdAt: parsed.createdAt,
        scrollY: parsed.scrollY ?? 0,
        action: parsed.action as PendingAction<Apply, Report>,
        ...(parsed.pendingActionId ? { pendingActionId: parsed.pendingActionId } : {}),
        ...(parsed.gateReason ? { gateReason: parsed.gateReason as AuthGateReason } : {}),
        ...(parsed.firstGateReason ? { firstGateReason: parsed.firstGateReason as AuthGateReason } : {}),
        ...(parsed.lastGateReason ? { lastGateReason: parsed.lastGateReason as AuthGateReason } : {}),
        ...(parsed.originSurface ? { originSurface: parsed.originSurface as OriginSurface } : {}),
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

/** Signed-out Apply opens auth first; signed-in users depart immediately. */
export type ApplyClickDecision = "perform" | "gate";

export function resolveApplyClickDecision(signedIn: boolean): ApplyClickDecision {
    return signedIn ? "perform" : "gate";
}
