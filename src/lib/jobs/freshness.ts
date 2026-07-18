/** Amber threshold for the "updated X ago" stamp. 24h is conservative until the
 * box sync cadence is repaired — retune here, nowhere else. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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
