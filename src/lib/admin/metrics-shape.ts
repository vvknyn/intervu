/**
 * The SHAPE of an admin metric, and the pure math over it. No I/O, no
 * firebase-admin — deliberately, because both halves import this: the server
 * collector (`metrics.ts`) and the client view (`components/admin/
 * MetricsDashboard.tsx`). A client component that reached for `metrics.ts`
 * would drag firebase-admin into the browser bundle and fail the build.
 *
 * Everything here is unit-testable without a database, which is the whole
 * reason the split exists — the same pure-decision / thin-I/O pattern as
 * `jobs/search-log.ts` and `trends/daily-snapshot.ts`.
 */

/** Sections, in render order. A metric names one; the view groups by it. */
export const METRIC_GROUPS = [
    "People",
    "Waitlist",
    "Search",
    "Product use",
    "Saved intent",
    "Credits",
    "Email",
    "Follow funnel",
    "Inbound",
    "Agents",
    "Corpus",
] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

/** The trailing windows every time-stamped metric reports. One list, so the
 *  collector, the labels and the tiles can never disagree about what "7d" is. */
export const WINDOWS = [
    { label: "24h", days: 1 },
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
] as const;

export interface MetricValue {
    /** Headline number. `null` ONLY when `error` is set — never a stand-in 0. */
    value: number | null;
    /** Trailing-window breakdown keyed by `WINDOWS[].label`, when the source
     *  carries a timestamp we can range-query. */
    windows?: Record<string, number>;
    /** `percent` renders as "12%"; absent renders as a plain count. */
    unit?: "percent";
    /** Why the number is missing. Set ⇒ `value` is null. */
    error?: string;
    /** The number is real but incomplete (e.g. paging cap hit). Distinct from
     *  `error` on purpose: one means "no answer", the other "partial answer". */
    caveat?: string;
}

/** Everything about a metric except how to read it. The registry entry
 *  (`MetricSpec`) adds the read; the collected result (`Metric`) adds the
 *  number — so the label and note have exactly one definition between them. */
export interface MetricMeta {
    id: string;
    label: string;
    group: MetricGroup;
    /** One plain sentence: what this counts, and what it does not. */
    note: string;
}

/** A metric with its number filled in — what the collector returns and the
 *  view renders. */
export type Metric = MetricValue & MetricMeta;

export interface MetricsReport {
    metrics: Metric[];
    /** ISO instant the numbers were read. */
    collectedAt: string;
}

// --- pure helpers (unit-tested without a database) -------------------------

/** ISO instant `days` before `nowMs` — the cutoff for a trailing window. */
export function isoAgo(nowMs: number, days: number): string {
    return new Date(nowMs - days * 86_400_000).toISOString();
}

/**
 * Pure: `part` as a whole-number percent of `whole`.
 *
 * Returns null when `whole` is 0. A share of nothing is undefined, and
 * rendering it as "0%" would claim every search succeeded when in fact no
 * search has ever been logged.
 */
export function sharePercent(part: number, whole: number): number | null {
    if (whole <= 0) return null;
    return Math.round((part / whole) * 100);
}

/** The subset of `UserRecord` the census reads — narrowed so the pure
 *  summariser can be tested with plain objects instead of Firebase types. */
export interface AuthUserLike {
    metadata: { creationTime?: string; lastSignInTime?: string };
    providerData: ReadonlyArray<{ providerId: string }>;
}

export interface AuthCensus {
    total: number;
    /** New accounts inside each window, keyed by `WINDOWS[].label`. */
    created: Record<string, number>;
    /** Accounts whose LAST sign-in falls inside each window. */
    active: Record<string, number>;
    /** Accounts holding at least one non-password provider. Matched on the
     *  class ("not a password login"), not on a list of provider ids, so a
     *  newly enabled provider is counted without editing this file. */
    federated: number;
}

/** Pure: roll a page-walked user list into the four People numbers. */
export function summarizeUsers(users: readonly AuthUserLike[], nowMs: number): AuthCensus {
    const census: AuthCensus = { total: users.length, created: {}, active: {}, federated: 0 };
    for (const { label, days } of WINDOWS) {
        const cutoff = nowMs - days * 86_400_000;
        census.created[label] = users.filter((u) => msOf(u.metadata.creationTime) >= cutoff).length;
        census.active[label] = users.filter((u) => msOf(u.metadata.lastSignInTime) >= cutoff).length;
    }
    census.federated = users.filter((u) =>
        u.providerData.some((p) => p.providerId !== "password"),
    ).length;
    return census;
}

/** `Date.parse` of an optional RFC-1123/ISO string; -Infinity when absent so a
 *  missing timestamp never falls inside a window. */
function msOf(when?: string): number {
    const ms = when ? Date.parse(when) : NaN;
    return Number.isFinite(ms) ? ms : -Infinity;
}

/** Pure: metrics bucketed into `METRIC_GROUPS` order, empty groups dropped. */
export function groupMetrics(metrics: readonly Metric[]): Array<{ group: MetricGroup; metrics: Metric[] }> {
    return METRIC_GROUPS.map((group) => ({
        group,
        metrics: metrics.filter((m) => m.group === group),
    })).filter((section) => section.metrics.length > 0);
}
