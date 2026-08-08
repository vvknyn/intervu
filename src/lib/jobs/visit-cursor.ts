/**
 * Scoped "last visited" cursors — ONE storage+lookback mechanism for every
 * feature that needs a "what's new since I last looked" timestamp (follows
 * alerts, the board's own new-postings banner, per-saved-search diffs),
 * generalizing the exact shape `lib/follows/alert-cursor.ts` had before this
 * (that file is now a thin re-export of the `"follows"` scope below).
 *
 * Class fix: before this, a second feature needing the same "cursor in
 * localStorage, 7-day default lookback" mechanism would have meant either a
 * second copy of alert-cursor.ts's five functions, or a growing if/else
 * ladder over feature names inside it. A scope key sidesteps both — a new
 * caller is covered by picking a scope, not by editing this file.
 */

export type VisitCursorScope = "board" | "follows" | `saved:${string}`;

const DEFAULT_LOOKBACK_MS = 7 * 86_400_000;

/** Follows keeps its pre-existing storage key verbatim, byte for byte, so
 *  existing users' cursors survive this refactor untouched. Every other
 *  scope gets its own namespaced key — `saved:<id>` scopes never collide
 *  with each other or with `board`. */
const FOLLOWS_LEGACY_KEY = "intervu.follows.alertCursor";

function storageKey(scope: VisitCursorScope): string {
  return scope === "follows" ? FOLLOWS_LEGACY_KEY : `intervu.visitCursor.${scope}`;
}

/** `lookbackMs` lets a scope default further back (or less far) than the
 *  standard week — the standard itself stays 7 days unless a caller opts out. */
export function defaultVisitCursor(nowMs = Date.now(), lookbackMs = DEFAULT_LOOKBACK_MS): string {
  return new Date(nowMs - lookbackMs).toISOString();
}

export function readVisitCursor(scope: VisitCursorScope): string {
  if (typeof window === "undefined") return defaultVisitCursor();
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (raw && !Number.isNaN(Date.parse(raw))) return raw;
  } catch {
    /* private mode / SSR */
  }
  return defaultVisitCursor();
}

export function writeVisitCursor(scope: VisitCursorScope, iso: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(scope), iso);
  } catch {
    /* quota exceeded */
  }
}

const DAY_MS = 86_400_000;

/**
 * Floor an ISO cursor to UTC midnight. Used server-side (actions/jobs.ts,
 * `countNewSinceAction`) so a "new since cursor" count's cache key advances
 * once a day instead of on every millisecond-precise cursor — the same
 * bucketing purpose `postedBucket` serves for the age-window filters, just
 * applied to an arbitrary stored cursor rather than a fixed enum. An
 * unparseable cursor floors to today, the same fallback posture
 * `defaultVisitCursor`/an invalid stored cursor already use elsewhere in
 * this file — never a thrown error over a stale or corrupted stored value.
 */
export function bucketCursorToUtcDay(iso: string): string {
  const ms = Date.parse(iso);
  const valid = Number.isNaN(ms) ? Date.now() : ms;
  return new Date(Math.floor(valid / DAY_MS) * DAY_MS).toISOString();
}
