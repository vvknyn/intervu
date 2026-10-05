"use client";

/**
 * Today on the packs home (`/jobs`), under the pack chips and above the
 * tracker: the week's roles worth a look for this résumé, and what is the
 * visitor's to do now (follow-ups, interviews, saved searches). The rules
 * (what counts as a pick, due or this week) live in
 * `lib/jobs/for-you/today.ts`; this file owns the one picks search, the
 * device storage and the layout.
 *
 * A pick is rated with thumbs up or down. Ratings, Apply, Skip and opening a
 * posting are the same nudges a pack's role cards record
 * (`lib/jobs/for-you/tuning-store.ts`), so Today and the packs tune one list,
 * on this device, and the tuning line says what it leans toward with Reset.
 *
 * Signed in without a usable résumé, Today still lists what needs the
 * visitor and says how to get picks (or that the saved résumé couldn't be read).
 *
 * `TodayHomeView` is the layout alone, so `/mock/today` can render every
 * state without a search.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { searchJobs } from "@/lib/jobs/search-client";
import { SignupGate } from "@/components/auth/SignupGate";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { MetaLine } from "@/components/jobs/job-detail-primitives";
import { MatchChip } from "@/components/jobs/MatchChip";
import { Button } from "@/components/ui/button";
import { SubTitle } from "@/components/ui/heading";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { WaitBar, WaitState } from "@/components/ui/wait-state";
import { HubPanel, HUB_PANEL_LINK_CLASS } from "@/components/jobs/for-you/HubPanel";
import { NeedsYouView, useNeedsYouRemote, type NeedsYouRemoteState } from "@/components/jobs/for-you/NeedsYou";
import { RoleTuningButtons } from "@/components/jobs/for-you/RoleTuningButtons";
import { captureEvent, type HomeActionKind } from "@/lib/analytics/events";
import type { SitePath } from "@/lib/auth/post-auth-destination";
import { matchAnalyticsProps } from "@/lib/analytics/match-props";
import { locationDropped } from "@/lib/jobs/broaden";
import { FIT_GUEST_PREVIEW_ROWS } from "@/lib/jobs/fit-gate";
import type { CandidateSignals } from "@/lib/jobs/candidate-signals";
import { freshHubProbeMemo } from "@/lib/jobs/for-you/hub-counts";
import { buildNeedsYou, savedRolesToCheck, starterSteps, type NeedsYouKind } from "@/lib/jobs/for-you/needs-you";
import { packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import {
    TODAY_PICK_ROWS,
    TODAY_PICKS_FETCH_LIMIT,
    TODAY_PICKS_WINDOW_MS,
    TODAY_SESSION_GAP_MS,
    followUpsDue,
    formatLastHere,
    interviewsThisWeek,
    isNewSince,
    pickToday,
    placeCheckIds,
    readTodaySkipped,
    readTodayVisit,
    resolveTodaySince,
    sincePhrase,
    todaySearchFloor,
    tuneToday,
    writeTodaySkipped,
    withPlaceNotes,
    writeTodayVisit,
    type TodayRole,
} from "@/lib/jobs/for-you/today";
import { summarizeTuning, tuningLine, type TuningSignal } from "@/lib/jobs/for-you/tuning";
import { clearNudge, recordNudge, resetNudges, useDeckNudges } from "@/lib/jobs/for-you/tuning-store";
import { jobPath } from "@/lib/jobs/job-slug";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { fetchPlaceNotes } from "@/lib/jobs/place-notes-client";
import { PLACE_NOTES_MAX_IDS } from "@/lib/jobs/place-restriction";
import { LOCATION_UNKNOWN_TEXT, postedAgeShort } from "@/lib/jobs/presentation";
import { isUnavailableJobsResult } from "@/lib/jobs/result-state";
import type { PublicJob } from "@/lib/jobs/types";
import { serializeJobsUrl, type JobsUrlState } from "@/lib/jobs/url-state";
import { retryDelayMs } from "@/lib/load-result";
import { scoreJobAgainstResume } from "@/lib/match/score";
import { presentJob } from "@/lib/presentation";
import { DEFAULT_DAILY_APPLY_GOAL, countAppliedToday } from "@/lib/pursuits/daily-apply-plan";
import type { Pursuit } from "@/lib/pursuits/types";
import { cn } from "@/lib/utils";
import { useOnboarding } from "@/hooks/use-onboarding";
import type { ResumeData } from "@/types/resume";

/** The packs Today can open: everything, or this week's. */
export type TodayPackId = "all" | "fresh";

type PicksSearch =
    | { kind: "loading" }
    | { kind: "failed" }
    | { kind: "ready"; roles: TodayRole[] };

/** The résumé Today ranks against, once the page has a usable one. */
export interface TodayMatching {
    resume: ResumeData;
    /** Changes only when the résumé's content does (`hubResumeKey`): a new object with the same content must not re-search. */
    resumeKey: string;
    signals: CandidateSignals;
    pack: JobsUrlState;
}

/** Why there are no picks to rank: no résumé yet, one with no role we can read, or the account's still loading. */
export type TodayNoResume = "missing" | "unreadable" | "loading";

/** The last settled picks search, repainted on a return to the hub (same rule as the hub probe's memo). */
let todayMemo: { key: string; at: number; complete: true; search: PicksSearch } | null = null;

/** How long the picks wait for their descriptions' place check before showing without it. */
const TODAY_PLACE_NOTES_DEADLINE_MS = 1_200;

/** This sitting's visit baseline, shared by the "Last here" line and Today so both read the same one. */
type VisitMemo = { at: number; visit: ReturnType<typeof resolveTodaySince> };
let visitMemo: VisitMemo | null = null;

const subscribeNever = () => () => {};

/** Read once per sitting: a return after a break of TODAY_SESSION_GAP_MS is a new sitting. */
function visitSnapshot(): VisitMemo {
    const nowMs = Date.now();
    if (!visitMemo || nowMs - visitMemo.at >= TODAY_SESSION_GAP_MS) {
        visitMemo = { at: nowMs, visit: resolveTodaySince(readTodayVisit(), nowMs) };
    }
    return visitMemo;
}

/**
 * When this device last opened the packs home (`resolveTodaySince`), read
 * once per sitting and recorded for the next visit. Client-only: the server
 * render has no device store, so it reports nothing until hydrated.
 */
export function useTodayVisit(): { hydrated: boolean; sinceMs: number | null; nowMs: number } {
    const memo = useSyncExternalStore(subscribeNever, visitSnapshot, () => null);
    useEffect(() => {
        if (memo) writeTodayVisit(memo.visit.next);
    }, [memo]);
    return { hydrated: memo != null, sinceMs: memo?.visit.sinceMs ?? null, nowMs: memo?.at ?? 0 };
}

/** "Last here Friday" for the welcome panel; nothing on a first visit. */
export function TodayLastHere({ className }: { className?: string }) {
    const { hydrated, sinceMs, nowMs } = useTodayVisit();
    const lastHere = hydrated ? formatLastHere(sinceMs, nowMs) : null;
    if (!lastHere) return null;
    return (
        <p className={cn("text-sm text-muted-foreground", className)} data-testid="today-last-here">
            Last here {lastHere}
        </p>
    );
}

export function TodayHome({
    auth,
    returnTo,
    matching,
    noResume,
    pursuits,
    pursuitsLoading,
    accountKey,
    onApply,
    onOpenPack,
    onAddResume,
    onRetryResume,
}: {
    /** The page's confirmed auth state: a guest sees the fit preview and the gate, never before it is known. */
    auth: "signed-in" | "signed-out" | "pending";
    /** Where the sign-up gate brings a guest back to — the packs hub. */
    returnTo: SitePath;
    /** The résumé to rank against; `null` until the page has a usable one. */
    matching: TodayMatching | null;
    /** With no `matching`, why not. */
    noResume: TodayNoResume;
    pursuits: Pursuit[];
    /** The signed-in tracker's first read is in flight: "Needs you" waits for it. */
    pursuitsLoading: boolean;
    /** The signed-in account (uid), so its "Needs you" read is never repainted for another. */
    accountKey: string | null;
    /** The page's own Apply (auth gate, apply-intent prompt, "did you apply?" return). */
    onApply: (job: PublicJob) => void;
    onOpenPack: (id: TodayPackId) => void;
    /** Add or replace the résumé (the page's upload flow). */
    onAddResume: () => void;
    /** Read the saved résumé again (`noResume: "unreadable"`). */
    onRetryResume: () => void;
}) {
    const visit = useTodayVisit();
    const [mountedAt] = useState(() => Date.now());
    const nowMs = visit.hydrated ? visit.nowMs : mountedAt;
    const [skipped, setSkipped] = useState<ReadonlySet<string>>(readTodaySkipped);
    const [attempt, setAttempt] = useState(0);

    const windowFloorMs = nowMs - TODAY_PICKS_WINDOW_MS;
    const memoKey = matching ? `${matching.resumeKey}\0${serializeJobsUrl(matching.pack)}` : "";
    const requestKey = `${memoKey}\0${attempt}`;
    const [settled, setSettled] = useState<{ key: string; search: PicksSearch } | null>(null);
    const search = useMemo<PicksSearch>(() => {
        if (settled?.key === requestKey) return settled.search;
        const memo = attempt === 0 && memoKey ? freshHubProbeMemo(todayMemo, memoKey, nowMs) : null;
        return memo ? memo.search : { kind: "loading" };
    }, [settled, requestKey, attempt, memoKey, nowMs]);

    // The search reads the latest résumé and pack without re-running for a new object with the same content.
    const inputsRef = useRef({ matching, windowFloorMs });
    useEffect(() => {
        inputsRef.current = { matching, windowFloorMs };
    }, [matching, windowFloorMs]);

    useEffect(() => {
        if (!memoKey) return;
        // Going into a pack and back remounts this section, and the search limit is shared with the packs.
        if (attempt === 0 && freshHubProbeMemo(todayMemo, memoKey, Date.now())) return;
        let cancelled = false;
        void (async () => {
            const { matching, windowFloorMs } = inputsRef.current;
            if (!matching) return;
            const { resume, signals, pack } = matching;
            // The pack's own search and order (most relevant first), limited to the week.
            const params = {
                ...packSearchParams(pack),
                postedSinceMs: windowFloorMs,
                limit: TODAY_PICKS_FETCH_LIMIT,
                offset: 0,
                withFacets: false,
            };
            const read = () => searchJobs(params).catch(() => null); // load-result-allow: null is a failed read here, retried once and then shown as LoadFailedState
            // One automatic retry after a jittered delay, then the failure shows (`lib/load-result.ts`).
            let r = await read();
            if (cancelled) return;
            if (!r || isUnavailableJobsResult(r)) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs()));
                if (cancelled) return;
                r = await read();
                if (cancelled) return;
            }
            if (!r || isUnavailableJobsResult(r)) {
                setSettled({ key: requestKey, search: { kind: "failed" } });
                return;
            }
            // The pack's location is where the candidate can work: a search that dropped it matched nothing there.
            const hits = locationDropped(pack, r) ? [] : (r.hits ?? []);
            const roles: TodayRole[] = [];
            for (const job of hits) {
                let score: TodayRole["score"] | null = null;
                try {
                    score = scoreJobAgainstResume(resume, job, signals);
                } catch {
                    score = null;
                }
                if (score) roles.push({ job, score });
            }
            // Rows that name no country may still be for people somewhere else ("must be based in India"):
            // their descriptions are read once, within a deadline, before the picks show.
            const checkIds = placeCheckIds(roles, PLACE_NOTES_MAX_IDS);
            const notes = checkIds.length > 0 ? await fetchPlaceNotes(checkIds, TODAY_PLACE_NOTES_DEADLINE_MS) : null;
            if (cancelled) return;
            const placed = notes ? withPlaceNotes(roles, notes, (job) => scoreJobAgainstResume(resume, job, signals)) : roles;
            const ready: PicksSearch = { kind: "ready", roles: placed };
            todayMemo = { key: memoKey, at: Date.now(), complete: true, search: ready };
            setSettled({ key: requestKey, search: ready });
        })();
        return () => {
            cancelled = true;
        };
    }, [memoKey, requestKey, attempt]);

    const tracked = useMemo(
        () => new Set(pursuits.map((p) => p.job_id).filter((id): id is string => Boolean(id))),
        [pursuits],
    );
    const ranked = useMemo(
        () => (search.kind === "ready" ? pickToday(search.roles, { skipped, tracked }) : []),
        [search, skipped, tracked],
    );
    // Ratings reorder the picks the visitor hasn't reached; the rows down to the one they rated stay put.
    const nudges = useDeckNudges();
    const [held, setHeld] = useState<readonly string[]>([]);
    const picks = useMemo(() => tuneToday(ranked, nudges, held, nowMs), [ranked, nudges, held, nowMs]);
    const liked = useMemo(() => new Set(nudges.filter((n) => n.signal === "more").map((n) => n.jobId)), [nudges]);
    const tuning = useMemo(() => summarizeTuning(nudges, nowMs), [nudges, nowMs]);

    const newCount = useMemo(() => picks.filter((r) => isNewSince(r.job, visit.sinceMs)).length, [picks, visit.sinceMs]);
    const appliedToday = useMemo(() => countAppliedToday(pursuits, nowMs), [pursuits, nowMs]);
    const followUps = useMemo(() => followUpsDue(pursuits, nowMs).length, [pursuits, nowMs]);
    const interviews = useMemo(() => interviewsThisWeek(pursuits, nowMs).length, [pursuits, nowMs]);

    // "Needs you": the tracker's dates and waits now, the account's saved searches, follows and closed listings once read.
    const needsFloorMs = todaySearchFloor(visit.sinceMs, nowMs);
    const savedJobIds = useMemo(() => savedRolesToCheck(pursuits), [pursuits]);
    const needsRemote = useNeedsYouRemote({
        enabled: auth === "signed-in" && !pursuitsLoading && accountKey != null && visit.hydrated,
        accountKey: accountKey ?? "",
        sinceIso: new Date(needsFloorMs).toISOString(),
        savedJobIds,
        nowMs,
    });
    const remote: NeedsYouRemoteState =
        auth === "signed-out" ? { kind: "none" } : auth === "pending" ? { kind: "loading" } : needsRemote.state;
    const remoteData = remote.kind === "ready" ? remote.data : null;
    const needs = useMemo(() => buildNeedsYou(pursuits, nowMs, remoteData), [pursuits, nowMs, remoteData]);
    // Setup's weekly-email step already asked about saving a search (hooks/use-onboarding.ts).
    const emailAnswered = useOnboarding().outcomes?.email != null;
    const steps = useMemo(
        () => (remoteData ? starterSteps(pursuits, remoteData, { emailAnswered }) : null),
        [pursuits, remoteData, emailAnswered],
    );

    const status: TodayStatus = matching ? search.kind : `no-resume-${noResume}`;

    // Once per load, when the list has settled: what Today showed.
    const viewedRef = useRef(false);
    useEffect(() => {
        if (viewedRef.current || !visit.hydrated || status === "loading" || status === "no-resume-loading") return;
        viewedRef.current = true;
        captureEvent("home_viewed", {
            new_count: newCount,
            applied_today: appliedToday,
            follow_ups: followUps,
            interviews,
            has_last_visit: visit.sinceMs != null,
        });
    }, [visit.hydrated, visit.sinceMs, status, newCount, appliedToday, followUps, interviews]);

    const track = (kind: HomeActionKind, role?: TodayRole) =>
        captureEvent("home_action_clicked", {
            kind,
            ...(role ? { job_id: role.job.id, ...matchAnalyticsProps(role.score) } : {}),
        });

    const rowLimit = auth === "signed-in" ? TODAY_PICK_ROWS : FIT_GUEST_PREVIEW_ROWS;
    const shownIds = picks.slice(0, rowLimit).map((r) => r.job.id);
    const deck = picks.map((r) => r.job);
    /** Hold the shown rows down to `index` (inclusive or not) where they are. */
    const holdThrough = (jobId: string, inclusive: boolean) => {
        const index = shownIds.indexOf(jobId);
        if (index < 0) return;
        setHeld(shownIds.slice(0, inclusive ? index + 1 : index));
    };
    // An own-role pick is rated like the packs rate one (#747): a thumbs down steers by employer, not the whole title.
    const nudge = (role: TodayRole, signal: TuningSignal) => recordNudge(role.job, signal, deck, { own: role.score.role === "own" });
    /** A thumbs down: the pick leaves (kept out on this device) and roles like it move down. */
    const turnDown = (role: TodayRole) => {
        holdThrough(role.job.id, false);
        nudge(role, "fewer");
        const next = new Set(skipped).add(role.job.id);
        setSkipped(next);
        writeTodaySkipped(next);
    };

    return (
        <TodayHomeView
            status={status}
            since={sincePhrase(visit.sinceMs, nowMs)}
            firstVisit={visit.sinceMs == null}
            sinceMs={visit.sinceMs}
            roles={picks}
            newCount={newCount}
            appliedToday={appliedToday}
            nowMs={nowMs}
            likedIds={liked}
            tuning={tuning ? tuningLine(tuning) : null}
            gate={
                auth === "signed-out" ? (
                    <SignupGate
                        reason="fit"
                        originSurface="for_you"
                        returnTo={returnTo}
                        count={{ kind: "exact", value: picks.length }}
                        className="w-full"
                    />
                ) : null
            }
            rowLimit={rowLimit}
            onTrack={track}
            onOpen={(role) => {
                track("new_role_open", role);
                nudge(role, "open");
            }}
            onApply={(role) => {
                track("new_role_apply", role);
                nudge(role, "apply");
                onApply(role.job);
            }}
            onMore={(role) => {
                track("new_role_more", role);
                holdThrough(role.job.id, true);
                if (liked.has(role.job.id)) clearNudge(role.job.id);
                else nudge(role, "more");
            }}
            onFewer={(role) => {
                track("new_role_fewer", role);
                turnDown(role);
            }}
            onResetTuning={() => {
                track("tuning_reset");
                setHeld(shownIds);
                resetNudges();
            }}
            onOpenPack={(id) => {
                track("see_more");
                onOpenPack(id);
            }}
            onAddResume={() => {
                track("add_resume");
                onAddResume();
            }}
            onRetryResume={onRetryResume}
            onRetry={() => setAttempt((n) => n + 1)}
            needsYou={
                <NeedsYouView
                    items={needs}
                    remote={remote.kind}
                    steps={steps}
                    guest={auth === "signed-out"}
                    onItem={(item) => track(NEEDS_YOU_ACTION[item.kind])}
                    onStep={(step) => captureEvent("home_action_clicked", { kind: "starter_step", step: step.key })}
                    onTracker={() => track("needs_tracker")}
                    onShowMore={() => track("needs_more")}
                    onRetry={needsRemote.retry}
                />
            }
        />
    );
}

const NEEDS_YOU_ACTION: Record<NeedsYouKind, HomeActionKind> = {
    interview: "needs_interview",
    follow_up: "needs_follow_up",
    closed: "needs_closed",
    saved_search: "needs_saved_search",
    follow: "needs_follow",
};

/** What the picks list shows: the search's state, or why there is no résumé to rank against. */
export type TodayStatus = PicksSearch["kind"] | `no-resume-${TodayNoResume}`;

function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

/** The rule a pick passed (`todayLeftOut`), said once at the top so every row's fit word has its basis. */
const PICKS_BASIS = "This week's roles in your line of work, at your level, where you can work. Your own role comes first.";

/** The summary line's links: plain text with a quiet underline, the number in bold. */
const SUMMARY_LINK =
    "underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function TodayHomeView({
    status,
    since,
    firstVisit,
    sinceMs,
    roles,
    newCount,
    appliedToday,
    goal = DEFAULT_DAILY_APPLY_GOAL,
    nowMs,
    likedIds,
    tuning,
    rowLimit = TODAY_PICK_ROWS,
    gate = null,
    onTrack,
    onOpen,
    onApply,
    onMore,
    onFewer,
    onResetTuning,
    onOpenPack,
    onAddResume,
    onRetryResume,
    onRetry,
    needsYou = null,
}: {
    status: TodayStatus;
    /** What "new" covers: "since Tuesday", "today", "this week". */
    since: string;
    firstVisit: boolean;
    /** The last visit, for each row's "New"; `null` on a first visit. */
    sinceMs: number | null;
    /** The picks, best first after ratings; the list shows the first `rowLimit`. */
    roles: TodayRole[];
    /** Picks posted since the last visit. */
    newCount: number;
    appliedToday: number;
    goal?: number;
    nowMs: number;
    /** Picks given a thumbs up. */
    likedIds: ReadonlySet<string>;
    /** "Tuned toward …, away from …." while ratings steer the list. */
    tuning: string | null;
    /** Rows shown: `TODAY_PICK_ROWS`, or a guest's fit preview (`FIT_GUEST_PREVIEW_ROWS`). */
    rowLimit?: number;
    /** A guest's sign-up gate, shown in place of "More" when the picks run past `rowLimit`. */
    gate?: ReactNode;
    onTrack?: (kind: HomeActionKind) => void;
    onOpen?: (role: TodayRole) => void;
    onApply: (role: TodayRole) => void;
    onMore: (role: TodayRole) => void;
    onFewer: (role: TodayRole) => void;
    onResetTuning: () => void;
    onOpenPack: (id: TodayPackId) => void;
    onAddResume: () => void;
    onRetryResume?: () => void;
    onRetry: () => void;
    /** "Needs you" (`NeedsYouView`): beside the picks from lg up, under them on a phone. Its header counts what's due. */
    needsYou?: ReactNode;
}) {
    // Ranked against a résumé (or about to be): the picks count and "All of this week" belong.
    const matched = !status.startsWith("no-resume");
    const ranking = matched || status === "no-resume-loading";
    const shown = roles.slice(0, rowLimit);
    const gated = gate != null && roles.length > rowLimit;

    return (
        <HubPanel
            id="today"
            title="Today"
            titleId="today-title"
            testId="today-home"
            link={
                matched ? (
                    <button
                        type="button"
                        data-testid="today-see-more"
                        onClick={() => onOpenPack("fresh")}
                        className={HUB_PANEL_LINK_CLASS}
                    >
                        All of this week
                    </button>
                ) : null
            }
            intro={
                <>
                    <p className="text-sm text-muted-foreground" data-testid="today-basis">
                        {ranking
                            ? PICKS_BASIS
                            : status === "no-resume-unreadable"
                              ? "What needs you today. This week's roles that fit your résumé show here once it loads."
                              : "What needs you today. Add your résumé and this week's roles that fit it show here too."}
                    </p>
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground" data-testid="today-summary">
                        {status === "ready" ? (
                            <>
                                <a href="#today-new" data-testid="today-stat-new" className={SUMMARY_LINK} onClick={() => onTrack?.("stat_new")}>
                                    <span className="font-semibold tabular-nums">{newCount}</span>{" "}
                                    {firstVisit
                                        ? `${plural(newCount, "pick", "picks")} this week`
                                        : `new ${plural(newCount, "pick", "picks")} ${since}`}
                                </a>
                                <span aria-hidden className="text-muted-foreground">
                                    ·
                                </span>
                            </>
                        ) : null}
                        <Link
                            href="/yours?stage=applied"
                            data-testid="today-stat-applied"
                            className={SUMMARY_LINK}
                            onClick={() => onTrack?.("stat_applied")}
                        >
                            <span className="font-semibold tabular-nums">{appliedToday}</span> of {goal} applied today
                        </Link>
                    </p>
                    {matched && tuning ? (
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground" data-testid="today-tuning">
                            <span className="min-w-0" aria-live="polite">
                                {tuning}
                            </span>
                            <button
                                type="button"
                                data-testid="today-tuning-reset"
                                onClick={onResetTuning}
                                className="text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70"
                            >
                                Reset
                            </button>
                        </p>
                    ) : null}
                </>
            }
        >
            <div className={cn("mt-4 grid gap-y-8", needsYou && "lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-2")}>
                <div id="today-new" data-testid="today-new" className="min-w-0 scroll-mt-24">
                    <div className="flex items-baseline justify-between gap-3 border-b border-border poster-list-inset-x py-2 text-sm text-muted-foreground">
                        <SubTitle>Roles to look at</SubTitle>
                    </div>

                    {status === "loading" || status === "no-resume-loading" ? (
                        <WaitState
                            label={status === "loading" ? "Picking this week's roles for you" : "Reading your résumé"}
                            data-testid="today-new-loading"
                            skeleton={
                                <div>
                                    {[0, 1, 2].map((i) => (
                                        <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 poster-list-inset-x pt-4">
                                            <WaitBar className="size-10 rounded-panel" />
                                            <div className="space-y-2 border-b border-border pb-4">
                                                <WaitBar className="h-4 w-2/3" />
                                                <WaitBar className="h-3 w-1/2" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            }
                        />
                    ) : status === "failed" ? (
                        <div className="poster-list-inset-x pt-4">
                            <LoadFailedState
                                title="We can't load this week's roles right now."
                                onRetry={onRetry}
                                testId="today-new-failed"
                            />
                        </div>
                    ) : status === "no-resume-missing" || status === "no-resume-unreadable" ? (
                        <div data-testid="today-no-resume" data-reason={status.slice("no-resume-".length)} className="space-y-3 poster-list-inset-x py-6">
                            <p className="text-sm text-foreground">
                                {status === "no-resume-unreadable"
                                    ? "Your saved résumé didn't load, or we couldn't read a role from it, so there's nothing to rank yet."
                                    : "Picks need your résumé: Today ranks the week's roles against it, on this device."}
                            </p>
                            <div className="wrap-row">
                                {status === "no-resume-unreadable" && onRetryResume ? (
                                    <Button type="button" variant="outline" data-testid="today-retry-resume" onClick={onRetryResume}>
                                        Try again
                                    </Button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant={status === "no-resume-unreadable" ? "ghost" : "outline"}
                                    data-testid="today-add-resume"
                                    onClick={onAddResume}
                                >
                                    {status === "no-resume-unreadable" ? "Replace résumé" : "Add your résumé"}
                                </Button>
                            </div>
                        </div>
                    ) : shown.length === 0 ? (
                        <div data-testid="today-new-empty" className="space-y-3 poster-list-inset-x py-8 text-left">
                            <p className="text-sm text-foreground">
                                No role posted this week fits your own line of work, level and place yet. Your packs list the near ones.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                data-testid="today-new-empty-action"
                                onClick={() => onOpenPack("all")}
                            >
                                Browse all matches
                            </Button>
                        </div>
                    ) : (
                        <>
                            <ul aria-label="Roles to look at">
                                {shown.map((role) => (
                                    <TodayRow
                                        key={role.job.id}
                                        role={role}
                                        nowMs={nowMs}
                                        isNew={isNewSince(role.job, sinceMs)}
                                        liked={likedIds.has(role.job.id)}
                                        onOpen={() => onOpen?.(role)}
                                        onApply={() => onApply(role)}
                                        onMore={() => onMore(role)}
                                        onFewer={() => onFewer(role)}
                                    />
                                ))}
                            </ul>
                            {gated ? <div className="poster-list-inset-x pt-4">{gate}</div> : null}
                        </>
                    )}
                </div>
                {needsYou}
            </div>
        </HubPanel>
    );
}

/** Hidden until the row is hovered or focused, only where there is a mouse. */
const ROW_ACTIONS_ON_HOVER =
    "transition-opacity motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-hover/today-row:opacity-100 pointer-fine:group-focus-within/today-row:opacity-100";

/**
 * One pick. Every row has the same few things, so each is said once and
 * quietly: the fit word leads the meta line (it opens the same receipt as the
 * chip), Apply is a text button, and the thumbs are the only other control (a
 * thumbs down takes the pick out, which is what Skip did, and tunes the rest).
 * With a mouse, Apply and the thumbs show on hover or keyboard focus, so the
 * list reads as roles, not a column of buttons; a liked row keeps its lit
 * thumb in view. Touch has no hover, so there they always show.
 */
function TodayRow({
    role,
    nowMs,
    isNew,
    liked,
    onOpen,
    onApply,
    onMore,
    onFewer,
}: {
    role: TodayRole;
    nowMs: number;
    isNew: boolean;
    liked: boolean;
    onOpen: () => void;
    onApply: () => void;
    onMore: () => void;
    onFewer: () => void;
}) {
    const { job, score } = role;
    const presented = presentJob(job);
    const locationKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
    const age = postedAgeShort(derivePostedTs(job), nowMs);
    return (
        <li
            data-testid="today-new-row"
            data-job-id={job.id}
            className="group/today-row grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 poster-list-inset-x pt-3"
        >
            <div className="self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="min-w-0 border-b border-border pb-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
                <div className="min-w-0">
                    <Link
                        href={jobPath(job)}
                        data-testid="today-role-title"
                        onClick={onOpen}
                        className="text-base font-semibold leading-snug text-foreground line-clamp-2 hover:underline"
                    >
                        {presented.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-baseline text-sm text-muted-foreground">
                        <MetaLine
                            items={[
                                <MatchChip key="fit" score={score} jobId={job.id} variant="text" />,
                                <span key="company">{presented.company.name}</span>,
                                locationKnown && <span key="location">{presented.location}</span>,
                                presented.salary && (
                                    <span key="salary" className="font-semibold text-foreground">
                                        {presented.salary}
                                    </span>
                                ),
                                isNew && (
                                    <span key="new" className="font-semibold text-foreground" data-testid="today-new-badge">
                                        New
                                    </span>
                                ),
                                age && (
                                    <span key="age" className="tabular-nums">
                                        {age}
                                    </span>
                                ),
                            ]}
                        />
                    </div>
                </div>
                <div
                    data-testid="today-row-actions"
                    className={cn(
                        "mt-1 flex items-center justify-between gap-2 sm:mt-0 sm:justify-end",
                        !liked && ROW_ACTIONS_ON_HOVER,
                    )}
                >
                    <Button type="button" variant="ghost" data-testid="today-apply" onClick={onApply} className="-ml-3 sm:ml-0">
                        Apply
                    </Button>
                    <RoleTuningButtons active liked={liked} onMore={onMore} onFewer={onFewer} />
                </div>
            </div>
        </li>
    );
}
