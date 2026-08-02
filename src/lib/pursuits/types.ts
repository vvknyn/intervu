/**
 * Pursuit — the "job you are going after" entity (jobs-first bloom PR2, spec
 * `docs/superpowers/specs/2026-07-21-jobs-first-bloom-redesign-design.md` §3).
 *
 * Backed by the existing Firestore `applications` collection, extended in
 * place: Firestore is schemaless, so this widens the `status` field's value
 * set and adds optional fields. Old docs (five statuses, no job_id/
 * job_snapshot) are valid pursuits mid-stage by construction — zero
 * migration. This module is the single source of truth for the shape; every
 * other module (actions/application.ts, actions/applications.ts,
 * lib/validation.ts, the pursuit UI) imports the type/helpers from here
 * rather than redeclaring them.
 *
 * Pure module — no I/O, no React — safe to unit-test directly and safe to
 * import from both server actions and client components.
 */

import type { PublicJob } from "@/lib/jobs/types";
import { formatRelativeAge } from "@/lib/jobs/freshness";

/**
 * Ordered least → most advanced. `rejected`/`withdrawn` sort last by design:
 * they are terminal, so "keep the more advanced stage" (merge/upsert) must
 * never regress away from a terminal state back to an earlier "still open"
 * one.
 */
export const PURSUIT_STAGES = [
    "interested",
    "resume_ready",
    "applied",
    "interviewing",
    "offer",
    "rejected",
    "withdrawn",
] as const;

export type PursuitStage = (typeof PURSUIT_STAGES)[number];

/** Position in `PURSUIT_STAGES` — the one place "more advanced" is decided. */
export function stageRank(stage: PursuitStage): number {
    return PURSUIT_STAGES.indexOf(stage);
}

/** Job detail captured at go-after time (spec §3) — listings live only in
 *  Meilisearch and expire, so the pursuit carries its own JD. Nullability
 *  mirrors `PublicJob`'s own fields exactly. */
export interface JobSnapshot {
    title: string;
    company: string | null;
    location: string | null;
    description: string | null;
    apply_url: string;
}

/** Lift the fields a pursuit needs to remember out of a live search result. */
export function buildJobSnapshot(job: PublicJob): JobSnapshot {
    return {
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        apply_url: job.apply_url,
    };
}

/** Snapshot for a pursuit created from the search seed line (spec §3
 *  "outside interviews") — typed company/role only, no live listing behind
 *  it. Mirrors `buildJobSnapshot`'s shape so tailor/prep read either kind of
 *  pursuit identically. */
export function buildManualPursuitSnapshot(company: string, position: string): JobSnapshot {
    return {
        title: position,
        company,
        location: null,
        description: null,
        apply_url: "",
    };
}

export interface Pursuit {
    id: string;
    company_name: string;
    position: string;
    job_url?: string;
    applied_at?: string;
    status: PursuitStage;
    resume_version_id?: string;
    cover_letter?: string;
    user_id: string;
    created_at: string;
    updated_at: string;
    resume_version?: {
        version_name: string;
    } | null;
    /** Meilisearch listing id; absent/null for outside interviews (spec §3). */
    job_id?: string | null;
    job_snapshot?: JobSnapshot | null;
    interview_date?: string;
    /** ISO timestamp of the most recent prep session run against this
     *  pursuit (spec §3 stage 4) — set by `recordPursuitPrepVisit`
     *  (actions/pursuit-prep.ts), read back by `stageLabel` below. */
    last_prepped_at?: string;
}

/** `rejected` | `withdrawn` render as a dimmed "Ended" — data keeps its
 *  precision, presentation loses the red (spec §3). */
export function isEnded(p: Pursuit): boolean {
    return p.status === "rejected" || p.status === "withdrawn";
}

/** Has this pursuit progressed at least as far as `stage`? */
export function hasReachedStage(p: Pursuit, stage: PursuitStage): boolean {
    return stageRank(p.status) >= stageRank(stage);
}

/** The current stage, in words — /yours is typography, not badges (spec §2,
 *  §5: "no pill confetti, no badges... Status is typography"). `nowMs`
 *  defaults to `Date.now()` but is overridable so this stays a pure,
 *  unit-testable function despite rendering a relative "prepped Nd ago". */
export function stageLabel(p: Pursuit, nowMs: number = Date.now()): string {
    switch (p.status) {
        case "interested":
            return "Interested";
        case "resume_ready":
            return "Resume ready";
        case "applied":
            return "Applied";
        case "interviewing": {
            const base = p.interview_date ? "Interview scheduled" : "Interviewing";
            return p.last_prepped_at ? `${base} — prepped ${formatRelativeAge(p.last_prepped_at, nowMs)}` : base;
        }
        case "offer":
            return "Offer";
        case "rejected":
            return "Not moving forward";
        case "withdrawn":
            return "Withdrawn";
    }
}

/** The one next step a pursuit's stage implies — never three tool offers at
 *  once (spec §3 "stage choreography"). Pure map, no I/O. */
export function nextAction(
    p: Pursuit,
): { label: string; kind: "tailor" | "apply" | "set_interview" | "prep" | "closed" } {
    switch (p.status) {
        case "interested":
            return { label: "Tailor your resume to this role", kind: "tailor" };
        case "resume_ready":
            return { label: "Finish applying", kind: "apply" };
        case "applied":
            return { label: "Set an interview date", kind: "set_interview" };
        case "interviewing":
            return { label: "Prep for this interview", kind: "prep" };
        case "offer":
            return { label: "You have an offer", kind: "closed" };
        case "rejected":
            return { label: "Didn't move forward", kind: "closed" };
        case "withdrawn":
            return { label: "Withdrawn", kind: "closed" };
    }
}

/** Which /yours board column (and stat-card bucket) a pursuit belongs to
 *  (portal redesign spec, "Page: Tracker (/yours)"): Saved = interested +
 *  resume_ready, Closed = rejected + withdrawn, everything else is its own
 *  column. Same switch shape as `stageLabel`/`nextAction` — a new
 *  `PursuitStage` is caught by the compiler here too, so the board can never
 *  silently drop a stage into no column. Single source for both the board
 *  grouping and the stat-card counts, so they can't disagree. */
export type BoardColumn = "saved" | "applied" | "interviewing" | "offer" | "closed";

export function boardColumn(p: Pursuit): BoardColumn {
    switch (p.status) {
        case "interested":
        case "resume_ready":
            return "saved";
        case "applied":
            return "applied";
        case "interviewing":
            return "interviewing";
        case "offer":
            return "offer";
        case "rejected":
        case "withdrawn":
            return "closed";
    }
}

/** The one real timestamp worth showing on a board card, phrased for its
 *  stage (spec: "mono '{stage-appropriate timestamp}' (applied_at,
 *  interview_date, created_at)"). `nowMs` is overridable for the same reason
 *  as `stageLabel`'s — pure and unit-testable despite rendering a relative
 *  age. Falls back to `updated_at`/`created_at` wherever the stage's own
 *  timestamp field is optional and unset, rather than rendering nothing. */
export function boardTimestampLabel(p: Pursuit, nowMs: number = Date.now()): string {
    switch (p.status) {
        case "interested":
        case "resume_ready":
            return `saved ${formatRelativeAge(p.created_at, nowMs)}`;
        case "applied":
            return `applied ${formatRelativeAge(p.applied_at ?? p.created_at, nowMs)}`;
        case "interviewing":
            return p.interview_date
                ? `interview ${new Date(p.interview_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                : `since ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "offer":
        case "rejected":
        case "withdrawn":
            return `since ${formatRelativeAge(p.updated_at, nowMs)}`;
    }
}

/** The board card's mono truth-line (docs-mockup.html Comp C): renders ONLY
 *  the real per-row facts a pursuit actually carries — a linked resume
 *  version, and the recency of the last prep session run against it —
 *  joined with " · ", omitting whatever isn't present. Deliberately does NOT
 *  include a live/ghost verdict: unlike the pursuit detail page (which
 *  fetches the live posting on demand), the board never fetches per-row, so
 *  that signal is never actually present here — fabricating one would
 *  violate "no lying fallbacks". Returns null when neither atom is present,
 *  so the card renders with no truth-line at all rather than an empty one. */
export function boardTruthLine(p: Pursuit, nowMs: number = Date.now()): string | null {
    const atoms: string[] = [];
    if (p.resume_version?.version_name) atoms.push(`resume: ${p.resume_version.version_name}`);
    if (p.last_prepped_at) atoms.push(`prepped ${formatRelativeAge(p.last_prepped_at, nowMs)}`);
    return atoms.length > 0 ? atoms.join(" · ") : null;
}

/** Ordering for the /yours list (spec §5): pursuits with an upcoming
 *  interview first (soonest `interview_date` first, undated interviews
 *  last-among-interviewing), then the rest of the active pursuits by
 *  recency, then ended pursuits (dimmed) at the bottom, also by recency. */
export function orderPursuits(list: Pursuit[]): Pursuit[] {
    const byRecency = (a: Pursuit, b: Pursuit) => Date.parse(b.updated_at) - Date.parse(a.updated_at);

    const interviewing = list
        .filter((p) => p.status === "interviewing")
        .sort((a, b) => {
            const ad = a.interview_date ? Date.parse(a.interview_date) : Infinity;
            const bd = b.interview_date ? Date.parse(b.interview_date) : Infinity;
            return ad !== bd ? ad - bd : byRecency(a, b);
        });
    const active = list.filter((p) => p.status !== "interviewing" && !isEnded(p)).sort(byRecency);
    const ended = list.filter(isEnded).sort(byRecency);

    return [...interviewing, ...active, ...ended];
}

/**
 * Guest→auth merge (spec §3, §7): match by job_id, keep the more advanced
 * stage, no conflict UI. `existing` wins ties and supplies identity fields
 * (id/user_id/created_at); `guest`'s snapshot/interview_date fill gaps the
 * existing record doesn't already have (an existing snapshot is never
 * clobbered by a redundant guest one). The server upsert chokepoint
 * (`upsertPursuitForJob` in actions/application.ts) reuses this same
 * function for its own "update to max(stage, existing)" rule, so client
 * guest-merge and server upsert can never disagree about what "more
 * advanced" means.
 */
export function mergeGuestPursuit(existing: Pursuit | undefined, guest: Pursuit): Pursuit {
    if (!existing) return guest;
    const winner = stageRank(guest.status) > stageRank(existing.status) ? guest.status : existing.status;
    return {
        ...existing,
        status: winner,
        job_snapshot: existing.job_snapshot ?? guest.job_snapshot,
        interview_date: existing.interview_date ?? guest.interview_date,
    };
}
