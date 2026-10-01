"use client";

/**
 * The Today header on the packs home (`/jobs` with a résumé): what changed
 * since the visitor last looked and what is theirs to do now, above the pack
 * tiles. The rules (what counts as new, due or this week) live in
 * `lib/jobs/for-you/today.ts`; this file owns the one new-since search, the
 * device storage and the layout.
 *
 * `TodayHomeView` is the layout alone, so `/mock/today` can render every
 * state without a search.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { searchJobs } from "@/lib/jobs/search-client";
import { SignupGate } from "@/components/auth/SignupGate";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { MetaLine } from "@/components/jobs/job-detail-primitives";
import { MatchChip } from "@/components/jobs/MatchChip";
import { Button } from "@/components/ui/button";
import { SectionTitle, SubTitle } from "@/components/ui/heading";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { WaitBar, WaitState } from "@/components/ui/wait-state";
import { NeedsYouView, useNeedsYouRemote, type NeedsYouRemoteState } from "@/components/jobs/for-you/NeedsYou";
import { captureEvent, type HomeActionKind } from "@/lib/analytics/events";
import type { SitePath } from "@/lib/auth/post-auth-destination";
import { matchAnalyticsProps } from "@/lib/analytics/match-props";
import { locationDropped } from "@/lib/jobs/broaden";
import { FIT_GUEST_PREVIEW_ROWS } from "@/lib/jobs/fit-gate";
import { PRIVATE_MATCHING_ACTIVE } from "@/lib/jobs/resume-privacy-copy";
import type { CandidateSignals } from "@/lib/jobs/candidate-signals";
import { freshHubProbeMemo } from "@/lib/jobs/for-you/hub-counts";
import { buildNeedsYou, savedRolesToCheck, starterSteps, type NeedsYouKind } from "@/lib/jobs/for-you/needs-you";
import { packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import {
    TODAY_NEW_FETCH_LIMIT,
    TODAY_NEW_ROWS,
    followUpsDue,
    formatLastHere,
    interviewsThisWeek,
    pickNewForYou,
    readTodaySkipped,
    readTodayVisit,
    resolveTodaySince,
    sincePhrase,
    todaySearchFloor,
    writeTodaySkipped,
    writeTodayVisit,
    type TodayRole,
} from "@/lib/jobs/for-you/today";
import { hubGreeting } from "@/lib/jobs/front-door-state";
import { jobPath } from "@/lib/jobs/job-slug";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
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
import type { ResumeData } from "@/types/resume";

/** The packs the header can open: everything, or this week's. */
export type TodayPackId = "all" | "fresh";

type NewSearch =
    | { kind: "loading" }
    | { kind: "failed" }
    | { kind: "ready"; roles: TodayRole[]; saturated: boolean };

/** The last settled new-since search, repainted on a return to the hub (same rule as the hub probe's memo). */
let todayMemo: { key: string; at: number; complete: true; search: NewSearch } | null = null;

export function TodayHome({
    auth,
    returnTo,
    userName,
    resume,
    resumeKey,
    signals,
    pack,
    pursuits,
    pursuitsLoading,
    accountKey,
    onApply,
    onOpenPack,
    resumeLine = null,
}: {
    /** The page's confirmed auth state: a guest sees the fit preview and the gate, never before it is known. */
    auth: "signed-in" | "signed-out" | "pending";
    /** Where the sign-up gate brings a guest back to — the packs hub. */
    returnTo: SitePath;
    userName?: string | null;
    resume: ResumeData;
    /** Changes only when the résumé's content does (`hubResumeKey`): a new object with the same content must not re-search. */
    resumeKey: string;
    signals: CandidateSignals;
    pack: JobsUrlState;
    pursuits: Pursuit[];
    /** The signed-in tracker's first read is in flight: "Needs you" waits for it. */
    pursuitsLoading: boolean;
    /** The signed-in account (uid), so its "Needs you" read is never repainted for another. */
    accountKey: string | null;
    /** The page's own Apply (auth gate, apply-intent prompt, "did you apply?" return). */
    onApply: (job: PublicJob) => void;
    onOpenPack: (id: TodayPackId) => void;
    /** Which résumé the page ranks against, with Replace (`ResumeInUse`), under the private-matching line. */
    resumeLine?: ReactNode;
}) {
    const [nowMs] = useState(() => Date.now());
    // This header mounts only once a résumé has loaded on the client, so the device store is readable here.
    // A reload inside one sitting resolves to the same baseline, so a second read is harmless.
    const [visit] = useState(() => resolveTodaySince(readTodayVisit(), nowMs));
    useEffect(() => writeTodayVisit(visit.next), [visit]);
    const [skipped, setSkipped] = useState<ReadonlySet<string>>(readTodaySkipped);
    const [attempt, setAttempt] = useState(0);

    const floorMs = todaySearchFloor(visit.sinceMs, nowMs);
    // A first visit's floor moves with the clock; the key says "first" so a return to the hub reuses its search.
    const memoKey = `${resumeKey}\0${serializeJobsUrl(pack)}\0${visit.sinceMs ?? "first"}`;
    const requestKey = `${memoKey}\0${attempt}`;
    const [settled, setSettled] = useState<{ key: string; search: NewSearch } | null>(null);
    const search = useMemo<NewSearch>(() => {
        if (settled?.key === requestKey) return settled.search;
        const memo = attempt === 0 ? freshHubProbeMemo(todayMemo, memoKey, nowMs) : null;
        return memo ? memo.search : { kind: "loading" };
    }, [settled, requestKey, attempt, memoKey, nowMs]);

    // The search reads the latest résumé and pack without re-running for a new object with the same content.
    const inputsRef = useRef({ resume, signals, pack, floorMs });
    useEffect(() => {
        inputsRef.current = { resume, signals, pack, floorMs };
    }, [resume, signals, pack, floorMs]);

    useEffect(() => {
        // Going into a pack and back remounts this header, and the search limit is shared with the packs.
        if (attempt === 0 && freshHubProbeMemo(todayMemo, memoKey, Date.now())) return;
        let cancelled = false;
        void (async () => {
            const { resume, signals, pack, floorMs } = inputsRef.current;
            const params = {
                ...packSearchParams(pack),
                postedSinceMs: floorMs,
                sort: "newest" as const,
                limit: TODAY_NEW_FETCH_LIMIT,
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
            const ready: NewSearch = {
                kind: "ready",
                roles,
                saturated: hits.length >= TODAY_NEW_FETCH_LIMIT && (r.total ?? 0) > hits.length,
            };
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
    const picks = useMemo(
        () => (search.kind === "ready" ? pickNewForYou(search.roles, { sinceMs: floorMs, skipped, tracked }) : []),
        [search, floorMs, skipped, tracked],
    );
    const appliedToday = useMemo(() => countAppliedToday(pursuits, nowMs), [pursuits, nowMs]);
    const followUps = useMemo(() => followUpsDue(pursuits, nowMs).length, [pursuits, nowMs]);
    const interviews = useMemo(() => interviewsThisWeek(pursuits, nowMs).length, [pursuits, nowMs]);

    // "Needs you": the tracker's dates and waits now, the account's saved searches, follows and closed listings once read.
    const savedJobIds = useMemo(() => savedRolesToCheck(pursuits), [pursuits]);
    const needsRemote = useNeedsYouRemote({
        enabled: auth === "signed-in" && !pursuitsLoading && accountKey != null,
        accountKey: accountKey ?? "",
        sinceIso: new Date(floorMs).toISOString(),
        savedJobIds,
        nowMs,
    });
    const remote: NeedsYouRemoteState =
        auth === "signed-out" ? { kind: "none" } : auth === "pending" ? { kind: "loading" } : needsRemote.state;
    const remoteData = remote.kind === "ready" ? remote.data : null;
    const needs = useMemo(() => buildNeedsYou(pursuits, nowMs, remoteData), [pursuits, nowMs, remoteData]);
    const steps = useMemo(() => (remoteData ? starterSteps(pursuits, remoteData) : null), [pursuits, remoteData]);

    // Once per load, when the list has settled: what the header showed.
    const viewedRef = useRef(false);
    useEffect(() => {
        if (viewedRef.current || search.kind === "loading") return;
        viewedRef.current = true;
        captureEvent("home_viewed", {
            new_count: picks.length,
            applied_today: appliedToday,
            follow_ups: followUps,
            interviews,
            has_last_visit: visit.sinceMs != null,
        });
    }, [visit, search.kind, picks.length, appliedToday, followUps, interviews]);

    const track = (kind: HomeActionKind, role?: TodayRole) =>
        captureEvent("home_action_clicked", {
            kind,
            ...(role ? { job_id: role.job.id, ...matchAnalyticsProps(role.score) } : {}),
        });

    const sinceMs = visit.sinceMs;
    return (
        <TodayHomeView
            title={hubGreeting({ signedIn: auth === "signed-in", userName, hasResume: true }).title}
            lastHere={formatLastHere(sinceMs, nowMs)}
            since={sincePhrase(sinceMs, nowMs)}
            status={search.kind}
            roles={picks}
            saturated={search.kind === "ready" && search.saturated}
            appliedToday={appliedToday}
            followUps={followUps}
            interviews={interviews}
            nowMs={nowMs}
            gate={
                auth === "signed-out" ? (
                    <SignupGate
                        reason="fit"
                        originSurface="for_you"
                        returnTo={returnTo}
                        count={{ kind: search.kind === "ready" && search.saturated ? "floor" : "exact", value: picks.length }}
                        className="w-full"
                    />
                ) : null
            }
            rowLimit={auth === "signed-in" ? TODAY_NEW_ROWS : FIT_GUEST_PREVIEW_ROWS}
            onTrack={track}
            onApply={(role) => {
                track("new_role_apply", role);
                onApply(role.job);
            }}
            onSkip={(role) => {
                track("new_role_skip", role);
                const next = new Set(skipped).add(role.job.id);
                setSkipped(next);
                writeTodaySkipped(next);
            }}
            onOpenPack={(id) => {
                track("see_more");
                onOpenPack(id);
            }}
            onRetry={() => setAttempt((n) => n + 1)}
            resumeLine={resumeLine}
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

function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

export function TodayHomeView({
    title,
    lastHere,
    since,
    status,
    roles,
    saturated,
    appliedToday,
    goal = DEFAULT_DAILY_APPLY_GOAL,
    followUps,
    interviews,
    nowMs,
    rowLimit = TODAY_NEW_ROWS,
    gate = null,
    onTrack,
    onApply,
    onSkip,
    onOpenPack,
    onRetry,
    needsYou = null,
    resumeLine = null,
}: {
    title: string;
    /** "Tuesday", "earlier today"; `null` on a first visit. */
    lastHere: string | null;
    /** What the new count covers: "since Tuesday", "today", "this week". */
    since: string;
    status: NewSearch["kind"];
    /** The picks, best first; the list shows the first `rowLimit`. */
    roles: TodayRole[];
    /** The search read its whole page and more were posted: the count is a floor. */
    saturated: boolean;
    appliedToday: number;
    goal?: number;
    followUps: number;
    interviews: number;
    nowMs: number;
    /** Rows shown: `TODAY_NEW_ROWS`, or a guest's fit preview (`FIT_GUEST_PREVIEW_ROWS`). */
    rowLimit?: number;
    /** A guest's sign-up gate, shown in place of "More" when the picks run past `rowLimit`. */
    gate?: ReactNode;
    onTrack?: (kind: HomeActionKind) => void;
    onApply: (role: TodayRole) => void;
    onSkip: (role: TodayRole) => void;
    onOpenPack: (id: TodayPackId) => void;
    onRetry: () => void;
    /** "Needs you" (`NeedsYouView`): beside the new matches from lg up, under them on a phone. The due and this-week stats link to it. */
    needsYou?: ReactNode;
    /** Which résumé these matches come from (`ResumeInUse`). */
    resumeLine?: ReactNode;
}) {
    const tallyHref = needsYou ? "#today-needs-you" : "/yours";
    const firstVisit = lastHere == null;
    const newCount = `${roles.length}${saturated ? "+" : ""}`;
    const shown = roles.slice(0, rowLimit);
    const gated = gate != null && (roles.length > rowLimit || saturated);

    return (
        <section data-testid="today-home" aria-labelledby="today-title" className="space-y-5 pb-6">
            <div className="space-y-1 poster-list-inset-x">
                <SectionTitle id="today-title">{title}</SectionTitle>
                {lastHere ? (
                    <p className="text-sm text-muted-foreground" data-testid="today-last-here">
                        Last here {lastHere}
                    </p>
                ) : null}
                {/* This header mounts only once a résumé has loaded, so the ranking below runs on this device. */}
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-live" data-testid="today-private-matching">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-live" />
                    {PRIVATE_MATCHING_ACTIVE}
                </p>
                {resumeLine}
            </div>

            <ul data-testid="today-stats" className="grid grid-cols-2 gap-x-4 gap-y-4 poster-list-inset-x sm:grid-cols-4">
                <TodayStat
                    testId="today-stat-new"
                    href="#today-new"
                    tone={status === "ready" && roles.length > 0 ? "brand" : undefined}
                    value={status === "ready" ? newCount : status === "failed" ? "–" : null}
                    label={`new ${plural(roles.length, "match", "matches")} ${since}`}
                    onClick={() => onTrack?.("stat_new")}
                />
                <TodayStat
                    testId="today-stat-applied"
                    href="/yours"
                    value={String(appliedToday)}
                    suffix={`of ${goal}`}
                    label="applied today"
                    onClick={() => onTrack?.("stat_applied")}
                />
                <TodayStat
                    testId="today-stat-follow-ups"
                    href={tallyHref}
                    tone={followUps > 0 ? "warn" : undefined}
                    value={String(followUps)}
                    label={plural(followUps, "follow-up due", "follow-ups due")}
                    onClick={() => onTrack?.("stat_follow_ups")}
                />
                <TodayStat
                    testId="today-stat-interviews"
                    href={tallyHref}
                    value={String(interviews)}
                    label={`${plural(interviews, "interview", "interviews")} this week`}
                    onClick={() => onTrack?.("stat_interviews")}
                />
            </ul>

            <div className={cn("grid gap-y-8", needsYou && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
                <div id="today-new" data-testid="today-new" className="min-w-0 scroll-mt-24">
                    <div className="flex items-baseline justify-between gap-3 border-b border-border poster-list-inset-x py-2 text-sm text-muted-foreground">
                        <SubTitle>New for you</SubTitle>
                        {status === "ready" && roles.length > 0 ? <span>Strong first</span> : null}
                    </div>

                    {status === "loading" ? (
                        <WaitState
                            label="Finding new matches"
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
                                title="We can't load new matches right now."
                                onRetry={onRetry}
                                testId="today-new-failed"
                            />
                        </div>
                    ) : shown.length === 0 ? (
                        <div data-testid="today-new-empty" className="space-y-3 poster-list-inset-x py-8 text-left">
                            <p className="text-sm text-foreground">
                                {firstVisit ? "No new matches this week." : `No new matches ${since}.`}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                data-testid="today-new-empty-action"
                                onClick={() => onOpenPack(firstVisit ? "all" : "fresh")}
                            >
                                {firstVisit ? "Browse all matches" : "Open Added this week"}
                            </Button>
                        </div>
                    ) : (
                        <>
                            <ul aria-label="New for you">
                                {shown.map((role) => (
                                    <TodayRow
                                        key={role.job.id}
                                        role={role}
                                        nowMs={nowMs}
                                        onOpen={() => onTrack?.("new_role_open")}
                                        onApply={() => onApply(role)}
                                        onSkip={() => onSkip(role)}
                                    />
                                ))}
                            </ul>
                            <div className="poster-list-inset-x pt-3">
                                {gated ? (
                                    gate
                                ) : (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        data-testid="today-see-more"
                                        onClick={() => onOpenPack("fresh")}
                                    >
                                        More in Added this week
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
                {needsYou}
            </div>
        </section>
    );
}

function TodayStat({
    testId,
    href,
    value,
    suffix,
    label,
    tone,
    onClick,
}: {
    testId: string;
    href: string;
    /** `null` while the number is still loading. */
    value: string | null;
    suffix?: string;
    label: string;
    tone?: "brand" | "warn";
    onClick: () => void;
}) {
    const body = (
        <>
            <div
                className={cn(
                    "text-xl font-semibold leading-snug tabular-nums",
                    tone === "brand" ? "text-brand" : tone === "warn" ? "text-warn" : "text-foreground",
                )}
            >
                {value == null ? (
                    <WaitBar className="my-1 h-5 w-8" aria-hidden />
                ) : (
                    <>
                        {value}
                        {suffix ? <span className="text-sm font-normal text-muted-foreground"> {suffix}</span> : null}
                    </>
                )}
            </div>
            <div className="mono-data mt-0.5 text-sm text-muted-foreground underline-offset-2 group-hover:underline">
                {label}
            </div>
        </>
    );
    const className =
        "group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";
    return (
        <li data-testid={testId}>
            {href.startsWith("#") ? (
                <a href={href} className={className} onClick={onClick}>
                    {body}
                </a>
            ) : (
                <Link href={href} className={className} onClick={onClick}>
                    {body}
                </Link>
            )}
        </li>
    );
}

function TodayRow({
    role,
    nowMs,
    onOpen,
    onApply,
    onSkip,
}: {
    role: TodayRole;
    nowMs: number;
    onOpen: () => void;
    onApply: () => void;
    onSkip: () => void;
}) {
    const { job, score } = role;
    const presented = presentJob(job);
    const locationKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
    const age = postedAgeShort(derivePostedTs(job), nowMs);
    return (
        <li
            data-testid="today-new-row"
            data-job-id={job.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 poster-list-inset-x pt-4"
        >
            <div className="self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            {/* Phone: Apply and Skip under the facts. From sm up they join the right rail under the fit and age, so the row stays one row tall. */}
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border pb-4">
                <div className="col-start-1 row-start-1 min-w-0 sm:row-span-2">
                    <Link
                        href={jobPath(job)}
                        data-testid="today-role-title"
                        onClick={onOpen}
                        className="text-base font-semibold leading-snug text-foreground line-clamp-2 hover:underline"
                    >
                        {presented.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-baseline text-sm text-muted-foreground">
                        <MetaLine
                            items={[
                                <span key="company">{presented.company.name}</span>,
                                locationKnown && <span key="location">{presented.location}</span>,
                                presented.salary && (
                                    <span key="salary" className="font-semibold text-foreground">
                                        {presented.salary}
                                    </span>
                                ),
                            ]}
                        />
                    </div>
                </div>
                <span className="col-start-2 row-start-1 flex h-fit flex-col items-end gap-1 self-start">
                    <MatchChip score={score} jobId={job.id} />
                    {age ? <span className="mono-data text-xs leading-none text-muted-foreground">{age}</span> : null}
                </span>
                <div className="wrap-row col-span-2 row-start-2 pt-3 sm:col-span-1 sm:col-start-2 sm:pt-2 sm:text-right">
                    <Button type="button" data-testid="today-apply" onClick={onApply}>
                        Apply
                    </Button>
                    <Button type="button" variant="outline" data-testid="today-skip" onClick={onSkip}>
                        Skip
                    </Button>
                </div>
            </div>
        </li>
    );
}
