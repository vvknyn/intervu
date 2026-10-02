/**
 * "Needs you" on the packs home's Today header: the few things that are the
 * visitor's move, each with one way to act. Pure: the tracker rows come from
 * `usePursuits`, the account-side counts from `listNeedsYouAction`, and the
 * component (`components/jobs/for-you/NeedsYou.tsx`) only lays them out.
 *
 * Order is urgency: an interview this week, then applications gone quiet,
 * then saved roles whose listing closed, then new roles from the visitor's
 * saved searches and followed companies.
 */
import { displayCompanyName } from "@/lib/jobs/presentation";
import { trackerStageHref } from "@/lib/pursuits/tracker-display";
import { hasReachedStage, isEnded, type Pursuit } from "@/lib/pursuits/types";
import { followUpsDue, interviewDayMs, interviewsThisWeek } from "./today";

const DAY_MS = 86_400_000;

/** Items the list shows before "Show N more". */
export const NEEDS_YOU_MAX_ITEMS = 6;

/**
 * From this many applications gone quiet, the follow-ups are one line into the
 * Applied stage instead of a line each: 21 "Follow up with …" rows bury the
 * interview above them and say nothing the count doesn't.
 */
export const NEEDS_YOU_GROUP_FOLLOW_UPS_AT = 3;

/** Saved roles whose listings one read checks. */
export const NEEDS_YOU_MAX_SAVED_ROLES = 50;

/** Saved searches and followed companies one read checks (newest first). */
export const NEEDS_YOU_MAX_SAVED_SEARCHES = 5;
export const NEEDS_YOU_MAX_FOLLOWS = 10;

export type NeedsYouKind = "interview" | "follow_up" | "closed" | "saved_search" | "follow";

export interface NeedsYouItem {
    key: string;
    kind: NeedsYouKind;
    title: string;
    detail: string;
    href: string;
    /** The button's verb: "Open", "Update", "Review", "Run", "See". */
    action: string;
    /** Dot colour: `warn` is a date or a wait, `brand` is something new, `muted` is housekeeping. */
    tone: "warn" | "brand" | "muted";
}

/** What the account side adds (`listNeedsYouAction`); `null` for a guest or before it loads. */
export interface NeedsYouRemote {
    searches: { id: string; name: string; href: string; count: number; more: boolean }[];
    follows: { domain: string; name: string; slug: string; count: number; more: boolean }[];
    /** Saved roles (by job id) whose listing is closed or gone. */
    closedJobIds: string[];
    savedSearchCount: number;
    followCount: number;
}

/** Saved, not yet applied, and tied to a listing: the roles whose listing can close under them. */
export function savedRolesToCheck(pursuits: Pursuit[]): string[] {
    const ids = pursuits
        .filter((p) => !isEnded(p) && !hasReachedStage(p, "applied") && p.job_id)
        .map((p) => p.job_id as string);
    return [...new Set(ids)].slice(0, NEEDS_YOU_MAX_SAVED_ROLES);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "today", "tomorrow", or the weekday: the window is one week, so a weekday is never ambiguous. */
export function interviewDayLabel(iso: string | null | undefined, nowMs: number): string | null {
    const day = interviewDayMs(iso);
    if (day == null) return null;
    const today = new Date(nowMs);
    const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const diff = Math.round((day - todayMs) / DAY_MS);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    return WEEKDAYS[new Date(day).getDay()];
}

function company(p: Pursuit): string {
    return displayCompanyName(p.company_name) || p.company_name || "this company";
}

function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

function countLabel(count: number, more: boolean): string {
    return `${count}${more ? "+" : ""}`;
}

/** Days an application has waited: from the last update, as the tracker's stale rule counts. */
function daysWaiting(p: Pursuit, nowMs: number): number {
    const at = Date.parse(p.updated_at);
    return Number.isNaN(at) ? 0 : Math.max(0, Math.floor((nowMs - at) / DAY_MS));
}

/**
 * A saved search's name inside this line's own quotes: a name that is a quoted
 * query ("Product Manager" OR "Technical Product Manager") keeps its words and
 * loses its quote marks, so the line never opens with two.
 */
export function savedSearchLabel(name: string): string {
    return name.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
}

/** Everything that needs the visitor, most urgent first; the list shows the first `NEEDS_YOU_MAX_ITEMS`. */
export function buildNeedsYou(pursuits: Pursuit[], nowMs: number, remote: NeedsYouRemote | null): NeedsYouItem[] {
    const items: NeedsYouItem[] = [];

    for (const p of interviewsThisWeek(pursuits, nowMs)) {
        items.push({
            key: `interview:${p.id}`,
            kind: "interview",
            title: `Interview ${interviewDayLabel(p.interview_date, nowMs) ?? "this week"}`,
            detail: `${company(p)} · ${p.position}`,
            href: `/yours/${p.id}`,
            action: "Open",
            tone: "warn",
        });
    }

    const due = followUpsDue(pursuits, nowMs);
    const groupFollowUps = due.length >= NEEDS_YOU_GROUP_FOLLOW_UPS_AT;
    if (groupFollowUps) {
        // Longest waiting first, so the first and last bound the wait.
        const longest = daysWaiting(due[0], nowMs);
        const shortest = daysWaiting(due[due.length - 1], nowMs);
        const names = [...new Set(due.map(company))];
        items.push({
            key: "follow_up",
            kind: "follow_up",
            title: `Follow up on ${due.length} applications`,
            detail: `No update in ${shortest === longest ? longest : `${shortest} to ${longest}`} days · ${
                names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ")
            }`,
            href: trackerStageHref("applied"),
            action: "Review",
            tone: "warn",
        });
    }
    for (const p of groupFollowUps ? [] : due) {
        const days = daysWaiting(p, nowMs);
        items.push({
            key: `follow_up:${p.id}`,
            kind: "follow_up",
            title: `Follow up with ${company(p)}`,
            detail: `No update in ${days} ${plural(days, "day", "days")} · ${p.position}`,
            href: `/yours/${p.id}`,
            action: "Update",
            tone: "warn",
        });
    }

    if (remote && remote.closedJobIds.length > 0) {
        const closed = new Set(remote.closedJobIds);
        const roles = pursuits.filter((p) => p.job_id && closed.has(p.job_id) && !isEnded(p) && !hasReachedStage(p, "applied"));
        if (roles.length === 1) {
            items.push({
                key: `closed:${roles[0].id}`,
                kind: "closed",
                title: "A saved role may have closed",
                detail: `${company(roles[0])} · ${roles[0].position}`,
                href: `/yours/${roles[0].id}`,
                action: "Review",
                tone: "muted",
            });
        } else if (roles.length > 1) {
            const names = [...new Set(roles.map(company))];
            items.push({
                key: "closed",
                kind: "closed",
                title: `${roles.length} saved roles may have closed`,
                detail: names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "),
                href: "/yours",
                action: "Review",
                tone: "muted",
            });
        }
    }

    for (const s of remote?.searches ?? []) {
        if (s.count === 0) continue;
        items.push({
            key: `saved_search:${s.id}`,
            kind: "saved_search",
            title: `“${savedSearchLabel(s.name)}” has ${countLabel(s.count, s.more)} new`,
            detail: "Your saved search",
            href: s.href,
            action: "Run",
            tone: "brand",
        });
    }

    for (const f of remote?.follows ?? []) {
        if (f.count === 0) continue;
        items.push({
            key: `follow:${f.domain}`,
            kind: "follow",
            title: `${f.name} posted ${countLabel(f.count, f.more)} ${plural(f.count, "role", "roles")}`,
            detail: "A company you follow",
            href: `/co/${f.slug}`,
            action: "See",
            tone: "brand",
        });
    }

    return items;
}

export interface StarterStep {
    key: "apply" | "save_search" | "follow";
    label: string;
    done: boolean;
    href: string;
    action: string;
}

/**
 * A new account with nothing to act on yet gets three first steps instead of
 * an empty list; they tick off as the tracker, saved searches and follows
 * fill. `null` once all three are done (the list is simply empty then).
 */
export function starterSteps(pursuits: Pursuit[], remote: NeedsYouRemote): StarterStep[] | null {
    const applied = pursuits.filter((p) => hasReachedStage(p, "applied")).length;
    const steps: StarterStep[] = [
        { key: "apply", label: "Apply to 3 Strong matches", done: applied >= 3, href: "#today-new", action: "See matches" },
        {
            key: "save_search",
            label: "Save a search to get its new roles by email",
            done: remote.savedSearchCount > 0,
            href: "/jobs?view=search",
            action: "Search",
        },
        { key: "follow", label: "Follow 3 companies you'd work for", done: remote.followCount >= 3, href: "/companies", action: "Browse" },
    ];
    return steps.every((s) => s.done) ? null : steps;
}
