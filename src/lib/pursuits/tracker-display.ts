/**
 * Pure display/filter helpers for the /yours tracker list — single source
 * for chip filters, search, and row meta so the page and sheets stay aligned.
 */

import { appliedAtForTransition } from "./applied-at";
import { boardColumn, type BoardColumn, type Pursuit, type PursuitStage } from "./types";

export type TrackerFilter = "all" | "saved" | "applied" | "interviewing" | "offer";

export const TRACKER_CHIP_FILTERS: { key: TrackerFilter; label: string }[] = [
    { key: "all", label: "all" },
    { key: "saved", label: "saved" },
    { key: "applied", label: "applied" },
    { key: "interviewing", label: "interviewing" },
    { key: "offer", label: "offers" },
];

/** /yours Kanban columns — same buckets as `boardColumn`, exhaustive open + closed. */
export const TRACKER_BOARD_COLUMNS: { column: BoardColumn; label: string }[] = [
    { column: "saved", label: "Saved" },
    { column: "applied", label: "Applied" },
    { column: "interviewing", label: "Interviewing" },
    { column: "offer", label: "Offer" },
    { column: "closed", label: "Closed" },
];

const BOARD_COLUMN_IDS = new Set<string>(TRACKER_BOARD_COLUMNS.map(({ column }) => column));

/** /yours showing one stage's applications: what the packs home's tracker numbers link to. */
export function trackerStageHref(column: BoardColumn): string {
    return `/yours?stage=${column}`;
}

/** The `?stage=` on /yours, when it names a board column; anything else shows every stage. */
export function parseTrackerStage(value: string | null | undefined): BoardColumn | null {
    return value && BOARD_COLUMN_IDS.has(value) ? (value as BoardColumn) : null;
}

export type TrackerBoardLayout = "lanes" | "tabs";

/** Wide viewports (md+) keep the kanban lanes; phones get a tab per lane over the same cards. */
export function trackerBoardLayout(isMdUp: boolean): TrackerBoardLayout {
    return isMdUp ? "lanes" : "tabs";
}

/** Lanes to render: a `?stage=` filter wins, else every lane (lanes) or the active tab's lane (tabs). */
export function trackerLanesToRender(layout: TrackerBoardLayout, stage: BoardColumn | null, activeTab: BoardColumn): BoardColumn[] {
    if (stage) return [stage];
    return layout === "lanes" ? TRACKER_BOARD_COLUMNS.map(({ column }) => column) : [activeTab];
}

/** Which board columns to render for the active chip filter. */
export function visibleTrackerBoardColumns(filter: TrackerFilter): BoardColumn[] {
    if (filter === "all") return TRACKER_BOARD_COLUMNS.map(({ column }) => column);
    return [filter];
}

/** Group pursuits into `boardColumn` buckets, preserving input order within each column. */
export function groupPursuitsByBoardColumn(pursuits: Pursuit[]): Record<BoardColumn, Pursuit[]> {
    const groups: Record<BoardColumn, Pursuit[]> = {
        saved: [],
        applied: [],
        interviewing: [],
        offer: [],
        closed: [],
    };
    for (const p of pursuits) {
        groups[boardColumn(p)].push(p);
    }
    return groups;
}

/**
 * The ONE status list every surface that sets a pursuit's status renders:
 * the detail sheet and the full pursuit page (as a button row) and the
 * "Track a role" sheet (as select options). Board order, with the Closed
 * lane split into the two facts it holds: "Rejected" (the employer said no)
 * and "Withdrawn" (you stepped away). Both land in the Closed column. A
 * single "Closed" button used to write `withdrawn`, which left no way to
 * record a rejection from the UI at all (2026-09-30 founder report).
 * `resume_ready` has no button of its own; it reads as "Saved".
 */
export const TRACKER_STATUS_OPTIONS: { stage: PursuitStage; label: string }[] = [
    { stage: "interested", label: "Saved" },
    { stage: "applied", label: "Applied" },
    { stage: "interviewing", label: "Interviewing" },
    { stage: "offer", label: "Offer" },
    { stage: "rejected", label: "Rejected" },
    { stage: "withdrawn", label: "Withdrawn" },
];

/**
 * Is `option` (one of `TRACKER_STATUS_OPTIONS`) the button a pursuit at
 * `current` shows as pressed? Exact, except `resume_ready`, which has no
 * button and lights up "Saved" (`interested`), the lane it sits in.
 */
export function isCurrentTrackerStatus(current: PursuitStage, option: PursuitStage): boolean {
    return (current === "resume_ready" ? "interested" : current) === option;
}

/**
 * The patch a status pick writes. `applied_at` follows the same rule as every
 * other write (`appliedAtForTransition`): stamped once, when a role moves up
 * into Applied, so the apply-pace counts keep the real date when a pursuit
 * is moved back and forth, and a role stepped back from Interviewing does
 * not count as applied today.
 */
export function trackerStatusPatch(p: Pick<Pursuit, "status" | "applied_at">, status: PursuitStage, nowIso: string): Partial<Pursuit> {
    const appliedAt = appliedAtForTransition(p, status, nowIso);
    return appliedAt ? { status, applied_at: appliedAt } : { status };
}

/**
 * The dated facts under the status row on the full pursuit page, e.g.
 * "Applied Sep 28 · Interview Oct 3". Only stored dates, never a guess:
 * saved or applied (whichever is known), the interview if one is set, and
 * the last update once the pursuit has an outcome (the closest stored date
 * to when it closed). An interview date is a calendar day stored as UTC
 * midnight (the date input's value), so it is read in UTC; the rest are
 * real instants, read in the viewer's zone.
 */
export function pursuitDateFacts(p: Pursuit, nowMs: number = Date.now()): string[] {
    const thisYear = new Date(nowMs).getFullYear();
    const day = (iso: string, timeZone?: string) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const year = timeZone === "UTC" ? d.getUTCFullYear() : d.getFullYear();
        return d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            ...(year !== thisYear ? { year: "numeric" } : {}),
            ...(timeZone ? { timeZone } : {}),
        });
    };
    const facts: string[] = [];
    const column = boardColumn(p);
    // Moved back to Saved, an old applied_at is no longer what the row says.
    const applied = p.applied_at && column !== "saved" ? day(p.applied_at) : null;
    const saved = day(p.created_at);
    if (applied) facts.push(`Applied ${applied}`);
    else if (saved) facts.push(`Saved ${saved}`);
    const interview = p.interview_date && column !== "saved" ? day(p.interview_date, "UTC") : null;
    if (interview) facts.push(`Interview ${interview}`);
    const updated = day(p.updated_at);
    if ((column === "offer" || column === "closed") && updated) facts.push(`Updated ${updated}`);
    return facts;
}

export function trackerStatusLabel(status: PursuitStage): string {
    if (status === "interested" || status === "resume_ready") return "Saved";
    if (status === "rejected") return "Rejected";
    if (status === "withdrawn") return "Withdrawn";
    return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Status → text colour only (no pill, no badge) — the tracker's own spec
 * comment in `types.ts` (`stageLabel`): "no pill confetti, no badges...
 * Status is typography." Progress states (applied/interviewing/offer)
 * render in ink; saved (not yet applied) and closed (rejected/withdrawn)
 * render in secondary — the rulebook's list-row status rule for tracker
 * rows and history rows alike, so both surfaces call this one function.
 */
export function trackerStatusColorClass(status: PursuitStage): string {
    const column = boardColumn({ status });
    return column === "saved" || column === "closed" ? "text-muted-foreground" : "text-foreground";
}

export function matchesTrackerFilter(p: Pursuit, filter: TrackerFilter): boolean {
    if (filter === "all") return true;
    if (filter === "saved") return boardColumn(p) === "saved";
    if (filter === "applied") return p.status === "applied";
    if (filter === "interviewing") return p.status === "interviewing";
    if (filter === "offer") return p.status === "offer";
    return true;
}

export function matchesTrackerSearch(p: Pursuit, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${p.company_name} ${p.position}`.toLowerCase().includes(q);
}

/** Bottom offset for fixed sheets so they sit above MobileTabBar on small screens. */
export const TRACKER_SHEET_BOTTOM =
    "bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px))] lg:bottom-0";

export function daysInTracker(p: Pursuit, nowMs: number = Date.now()): number {
    const created = Date.parse(p.created_at);
    if (Number.isNaN(created)) return 0;
    return Math.max(0, Math.floor((nowMs - created) / 86_400_000));
}

/** The Tracker tab's count: open roles only. A rejected or withdrawn role
 *  is done, and counting it gave anyone with a few closed roles a permanent
 *  "9+" (journey audit 2026-09-30). */
export function countOpenPursuits(pursuits: Pick<Pursuit, "status">[]): number {
    return pursuits.filter((p) => boardColumn(p) !== "closed").length;
}

export function hasResumeLinked(p: Pursuit): boolean {
    return (
        (p.resume_versions?.length ?? 0) > 0 ||
        !!p.resume_version_id ||
        !!p.resume_version?.version_name
    );
}

/** PursuitListRow meta — keep résumé accented; single source for tracker row copy. */
export function trackerResumeMetaLabel(linked: boolean): string {
    return linked ? "résumé linked" : "no résumé";
}

/** Threshold (days) beyond which an unanswered application is flagged stale
 *  on the tracker (spec B2, "honest re-engagement — facts only"). */
export const STALE_APPLICATION_THRESHOLD_DAYS = 14;

/** Days since a pursuit's last update — the same clock `isStalePursuit`
 *  gates on and the "no update in Nd" line renders, so the two can never
 *  disagree. Mirrors `daysInTracker`'s shape (created_at instead of
 *  updated_at). */
export function daysSinceUpdate(p: Pursuit, nowMs: number = Date.now()): number {
    const updated = Date.parse(p.updated_at);
    if (Number.isNaN(updated)) return 0;
    return Math.max(0, Math.floor((nowMs - updated) / 86_400_000));
}

/**
 * True only while a pursuit sits in the one stage that means "waiting on
 * them" — `applied` — with no update in at least `thresholdDays`. Traced
 * against `PURSUIT_STAGES`: `interested`/`resume_ready` are still the
 * applicant's own move to make; `interviewing` is a *different* waiting
 * state (waiting on an interview outcome, not a first response) and is
 * deliberately excluded — a pursuit that's advanced past `applied` is
 * making progress, not going stale; `offer`/`rejected`/`withdrawn` are
 * already resolved. Facts only — this never renders an imperative, just the
 * count.
 */
export function isStalePursuit(
    p: Pursuit,
    nowMs: number = Date.now(),
    thresholdDays: number = STALE_APPLICATION_THRESHOLD_DAYS,
): boolean {
    return p.status === "applied" && daysSinceUpdate(p, nowMs) >= thresholdDays;
}

/**
 * Row meta facts for PursuitListRow — omit dead values (`0d in tracker`,
 * `no résumé`) until they carry meaning.
 */
export function pursuitRowMetaItems(p: Pursuit, nowMs: number = Date.now()): string[] {
    const items: string[] = [];
    const days = daysInTracker(p, nowMs);
    if (days > 0) items.push(`${days}d in tracker`);
    if (hasResumeLinked(p)) items.push(trackerResumeMetaLabel(true));
    if (isStalePursuit(p, nowMs)) items.push(`no update in ${daysSinceUpdate(p, nowMs)}d`);
    const note = p.note?.trim();
    if (note) items.push(note);
    return items;
}

/** Applications marked applied since `sinceMs` (spec B3, pattern
 *  Self-Monitoring). `applied_at`-based, not stage-based, so re-tracking an
 *  older applied pursuit doesn't retroactively count it. Missing/unparseable
 *  `applied_at` is the class case: never counted, never throws. */
export function countAppliedSince(pursuits: Pursuit[], sinceMs: number): number {
    let count = 0;
    for (const p of pursuits) {
        if (!p.applied_at) continue;
        const applied = Date.parse(p.applied_at);
        if (!Number.isNaN(applied) && applied >= sinceMs) count++;
    }
    return count;
}

export function countByTrackerFilter(pursuits: Pursuit[]): Record<Exclude<TrackerFilter, "all">, number> {
    const counts = { saved: 0, applied: 0, interviewing: 0, offer: 0 };
    for (const p of pursuits) {
        if (boardColumn(p) === "saved") counts.saved++;
        if (p.status === "applied") counts.applied++;
        if (p.status === "interviewing") counts.interviewing++;
        if (p.status === "offer") counts.offer++;
    }
    return counts;
}
