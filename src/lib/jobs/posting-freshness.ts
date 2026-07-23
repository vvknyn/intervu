/**
 * Posting freshness/relist classification (S2 — fresh & honest results).
 *
 * Pure, DOM-free logic answering the owner's question "is this posting
 * genuinely fresh, or a repost?" from the two observable facts we carry per
 * job: `posted_at` (the posting's CLAIMED date — 18%-ish null, can carry
 * future sentinels) and `first_seen_at` (when Subspace first observed the
 * listing — never null on real corpus rows).
 *
 * The relist tell (measured live 2026-07-23): posted_at claims a date at
 * least RELIST_MARGIN_MS AFTER we first observed the listing — the employer
 * re-stamped an old req as new. This is a stated fact about two dates, not
 * an inferred intent; UI copy must show both dates wherever there's room
 * (HONESTY RULE — see JobDetail's facts line, src/app/page.tsx).
 */

/**
 * Sanity floor — anything before 2000-01-01 is junk (shared with
 * `derivePostedTs`'s index-side derivation, meilisearch.ts, which imports
 * `sanitizeTimestamp` below so there is exactly ONE sanitizer).
 */
const TIMESTAMP_FLOOR = Date.parse("2000-01-01T00:00:00Z");
/** Clock-skew / timezone grace before a timestamp counts as "in the future". */
const FUTURE_GRACE_MS = 24 * 60 * 60 * 1000;

/** A job first seen within this window is "fresh". */
export const FRESH_WINDOW_MS = 7 * 86_400_000;
/**
 * posted_at claiming a date this far (or further) after first_seen_at is the
 * relist tell. 14 days deliberately generous: ingest lag or a claimed-date
 * rounding can put posted_at a few days after first observation innocently;
 * two weeks cannot.
 */
export const RELIST_MARGIN_MS = 14 * 86_400_000;

/**
 * Parse an ISO timestamp, returning epoch ms only if it's sane: parses, is
 * on/after 2000-01-01, and is no more than 24h in the future (small
 * clock-skew grace, not a loophole for sentinels months out — measured live:
 * 2030-01-31, 2026-12-31 sit in `posted_at`). Extracted from
 * `derivePostedTs` (meilisearch.ts) so ingest-side and UI-side reads agree
 * on what counts as a usable date.
 */
export function sanitizeTimestamp(iso: string | null | undefined, nowMs: number): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    if (t < TIMESTAMP_FLOOR) return null;
    if (t > nowMs + FUTURE_GRACE_MS) return null;
    return t;
}

export interface PostingFreshness {
    kind: "fresh" | "relisted" | null;
    firstSeenMs: number | null;
    postedMs: number | null;
}

/**
 * Classify a job as "fresh", "relisted", or neither (`null` — absence of
 * data is absence of claim; no badge is rendered). Relisted wins over fresh:
 * a re-stamped old req can look recently-posted by its own claim, but the
 * first-seen date is ours and doesn't move.
 */
export function classifyPostingFreshness(
    job: { posted_at?: string | null; first_seen_at?: string | null },
    nowMs: number,
): PostingFreshness {
    const postedMs = sanitizeTimestamp(job.posted_at, nowMs);
    const firstSeenMs = sanitizeTimestamp(job.first_seen_at, nowMs);
    let kind: PostingFreshness["kind"] = null;
    if (postedMs != null && firstSeenMs != null && postedMs - firstSeenMs >= RELIST_MARGIN_MS) {
        kind = "relisted";
    } else if (firstSeenMs != null && nowMs - firstSeenMs <= FRESH_WINDOW_MS) {
        kind = "fresh";
    }
    return { kind, firstSeenMs, postedMs };
}
