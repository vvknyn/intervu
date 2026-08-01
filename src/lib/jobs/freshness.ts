/** Amber threshold for the "updated X ago" stamp. 24h is conservative until the
 * box sync cadence is repaired — retune here, nowhere else. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * How many days a "clear / no ghost signals" row can go without a re-check
 * before that verdict stops being an honest CURRENT claim (`checkFreshness`,
 * badges.ts). Deliberately a much longer horizon than `STALE_THRESHOLD_MS`
 * above: that 24h bar drives the tighter "✓ live" vs "checked" row-badge
 * TEXT split and the corpus-wide "last synced" stamp, where a single missed
 * sync cycle doesn't make a "clear" classification dishonest. Going a full
 * month without a re-check does — verified live 2026-07-19: rows last
 * checked 99-112 days ago still rendered a green "No ghost signals" panel
 * next to a dead apply link.
 */
export const STALE_CHECK_DAYS = 30;

/**
 * Below this age, `searchResultLine`'s "· updated Xh ago" clause (
 * presentation.ts) is honest enough to state out loud; at or past it, the
 * clause is omitted entirely rather than confessing staleness inline — a
 * real maintenance window is the degraded banner's job (result-state.ts's
 * `degradedResultsNote`), not this line's. Independent of
 * `STALE_THRESHOLD_MS` (row-badge TEXT split above) and `STALE_CHECK_DAYS`
 * (ghost-verdict currency above) — three different concerns, three
 * constants, on purpose (writing-lean-code rule 4: don't piggyback one
 * threshold's meaning onto another's).
 */
export const RESULT_LINE_FRESH_MS = 48 * 60 * 60 * 1000;

export function formatRelativeAge(iso: string, nowMs: number): string {
    const ms = Math.max(0, nowMs - Date.parse(iso));
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function isStale(iso: string | null, nowMs: number, thresholdMs = STALE_THRESHOLD_MS): boolean {
    if (!iso) return true;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return true;
    return nowMs - t > thresholdMs;
}
