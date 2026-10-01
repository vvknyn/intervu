"use client";

/**
 * Under Today on the packs hub: the visitor's tracker (the roles they've
 * applied to and saved, with each one's stage) and the last 20 roles they
 * opened. Each is its own panel (`HubPanel`) with hairline rows, and the
 * tracker's numbers are tiles that open that stage's applications on
 * /yours (`/yours?stage=applied`). Signed out it keeps both sections as
 * placeholders behind the one shared `SignupGate`.
 *
 * `HubYourJobs` wires the shared account reads (`usePursuits`, `useViewed`);
 * `HubYourJobsView` is the pure render the /mock/hub-your-jobs fixture reuses.
 */

import { useState } from "react";
import Link from "next/link";
import { SignupGate } from "@/components/auth/SignupGate";
import { Button } from "@/components/ui/button";
import { DotSeparated } from "@/components/ui/dot-separated";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { WaitBar, WaitState } from "@/components/ui/wait-state";
import { StageBadge } from "@/components/tracker/StageBadge";
import { HubPanel, HubStatTile, HubStatTiles, HUB_PANEL_LINK_CLASS } from "@/components/jobs/for-you/HubPanel";
import type { SitePath } from "@/lib/auth/post-auth-destination";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import {
    HUB_YOUR_JOBS_COPY as COPY,
    hubRecentRows,
    hubTrackerAgeLabel,
    hubTrackerRows,
    hubTrackerStaleLabel,
    hubTrackerStats,
} from "@/lib/jobs/for-you/hub-your-jobs";
import { jobPath } from "@/lib/jobs/job-slug";
import { displayCompanyName } from "@/lib/jobs/presentation";
import { trackerStageHref } from "@/lib/pursuits/tracker-display";
import { TRACKER_PRIMARY_CTA } from "@/lib/pursuits/tracker-voice-copy";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { useViewed } from "@/lib/views/use-viewed";
import type { JobView } from "@/lib/views/types";

export interface HubYourJobsViewProps {
    signedIn: boolean;
    /** Where the sign-in gate brings the visitor back to — the packs hub. */
    returnTo: SitePath;
    nowMs: number;
    pursuits: Pursuit[];
    trackerLoading: boolean;
    trackerFailed: boolean;
    onRetryTracker: () => void;
    views: JobView[];
    recentLoading: boolean;
    recentFailed: boolean;
    onRetryRecent: () => void;
}

/** `auth` is the page's confirmed state (`isConfirmedSignedIn` /
 *  `isConfirmedSignedOut`): nothing renders until it settles, so a signed-in
 *  visitor never sees the sign-in gate flash in first. */
export function HubYourJobs({ auth, returnTo }: { auth: "signed-in" | "signed-out" | "pending"; returnTo: SitePath }) {
    const tracker = usePursuits();
    const recent = useViewed();
    const [nowMs] = useState(() => Date.now());
    if (auth === "pending") return null;
    const signedIn = auth === "signed-in";
    return (
        <HubYourJobsView
            signedIn={signedIn}
            returnTo={returnTo}
            nowMs={nowMs}
            pursuits={tracker.pursuits}
            trackerLoading={tracker.loading}
            trackerFailed={tracker.failed}
            onRetryTracker={tracker.retry}
            views={recent.entries}
            recentLoading={recent.loading}
            recentFailed={recent.failed}
            onRetryRecent={recent.retry}
        />
    );
}

export function HubYourJobsView(props: HubYourJobsViewProps) {
    if (!props.signedIn) return <SignedOutPlaceholder returnTo={props.returnTo} />;

    const stageByJobId = new Map<string, PursuitStage>();
    for (const p of props.pursuits) if (p.job_id) stageByJobId.set(p.job_id, p.status);

    return (
        <div data-testid="hub-your-jobs" data-signed-in="true" className="space-y-4">
            <TrackerSection {...props} />
            <RecentSection {...props} stageByJobId={stageByJobId} />
        </div>
    );
}

function PanelLink({ href, label, testId }: { href: string; label: string; testId: string }) {
    return (
        <Link href={href} data-testid={testId} className={HUB_PANEL_LINK_CLASS}>
            {label}
        </Link>
    );
}

function TrackerSection({ pursuits, trackerLoading, trackerFailed, onRetryTracker, nowMs }: HubYourJobsViewProps) {
    const rows = hubTrackerRows(pursuits);
    const hasAny = pursuits.length > 0;
    return (
        <HubPanel
            title={COPY.trackerTitle}
            titleId="hub-tracker-title"
            testId="hub-tracker"
            link={hasAny ? <PanelLink href="/yours" label={COPY.trackerLink} testId="hub-tracker-open" /> : null}
        >
            {trackerLoading && !hasAny ? (
                <RowsLoading label="Loading your tracker" />
            ) : trackerFailed && !hasAny ? (
                <div className="mt-4 poster-list-inset-x">
                    <LoadFailedState
                        title="We can't load your tracker right now."
                        onRetry={onRetryTracker}
                        testId="hub-tracker-load-failed"
                    />
                </div>
            ) : !hasAny ? (
                <div className="poster-list-inset-x pt-2" data-testid="hub-tracker-empty">
                    <p className="text-sm text-muted-foreground">{COPY.trackerEmpty}</p>
                    <Button asChild variant="outline" size="sm" className="mt-3">
                        <Link href="/yours?view=new">{TRACKER_PRIMARY_CTA}</Link>
                    </Button>
                </div>
            ) : (
                <>
                    <HubStatTiles testId="hub-tracker-stats" label="Your tracker by stage" count={4}>
                        {hubTrackerStats(pursuits).map((stat) => (
                            <HubStatTile
                                key={stat.key}
                                testId={`hub-tracker-stat-${stat.key}`}
                                href={stat.value > 0 ? trackerStageHref(stat.key) : null}
                                value={String(stat.value)}
                                label={stat.label}
                            />
                        ))}
                    </HubStatTiles>
                    {rows.length === 0 ? (
                        <p className="mt-4 poster-list-inset-x text-sm text-muted-foreground">{COPY.trackerAllClosed}</p>
                    ) : (
                        <div className="mt-3 grid md:grid-cols-2 md:gap-x-6">
                            {rows.map((p) => (
                                <HubRow
                                    key={p.id}
                                    href={`/yours/${p.id}`}
                                    testId="hub-tracker-row"
                                    title={p.position}
                                    meta={[
                                        displayCompanyName(p.company_name),
                                        hubTrackerAgeLabel(p, nowMs),
                                        hubTrackerStaleLabel(p, nowMs),
                                    ]}
                                    stage={p.status}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </HubPanel>
    );
}

function RecentSection({
    views,
    recentLoading,
    recentFailed,
    onRetryRecent,
    nowMs,
    stageByJobId,
}: HubYourJobsViewProps & { stageByJobId: Map<string, PursuitStage> }) {
    const rows = hubRecentRows(views);
    return (
        <HubPanel
            title={COPY.recentTitle}
            titleId="hub-recent-title"
            testId="hub-recent"
            link={rows.length > 0 ? <PanelLink href="/yours/history" label={COPY.recentLink} testId="hub-recent-all" /> : null}
        >
            {recentLoading && rows.length === 0 ? (
                <RowsLoading label="Loading the roles you viewed" />
            ) : recentFailed && rows.length === 0 ? (
                <div className="mt-4 poster-list-inset-x">
                    <LoadFailedState
                        title="We can't load your history right now."
                        onRetry={onRetryRecent}
                        testId="hub-recent-load-failed"
                    />
                </div>
            ) : rows.length === 0 ? (
                <p className="poster-list-inset-x pt-2 text-sm text-muted-foreground" data-testid="hub-recent-empty">
                    {COPY.recentEmpty}
                </p>
            ) : (
                <div className="mt-2 grid md:grid-cols-2 md:gap-x-6">
                    {rows.map((view) => (
                        <HubRow
                            key={view.id}
                            href={jobPath({ id: view.job_id, title: view.job_snapshot.title, company: view.job_snapshot.company })}
                            testId="hub-recent-row"
                            title={view.job_snapshot.title}
                            meta={[displayCompanyName(view.job_snapshot.company), formatRelativeAge(view.last_viewed_at, nowMs)]}
                            stage={stageByJobId.get(view.job_id)}
                        />
                    ))}
                </div>
            )}
        </HubPanel>
    );
}

/** design-language.md §4 row anatomy without the leading tile: the whole row
 *  is the link, the stage pill sits in the right rail (tracker and history
 *  rows alike — `StageBadge` is the one stage colour map). */
function HubRow({
    href,
    testId,
    title,
    meta,
    stage,
}: {
    href: string;
    testId: string;
    title: string;
    meta: (string | null | undefined)[];
    stage?: PursuitStage;
}) {
    return (
        <Link
            href={href}
            data-testid={testId}
            className="grid poster-list-inset-x pt-3 transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border pb-3">
                <div className="min-w-0">
                    <div className="truncate text-base font-semibold leading-snug text-foreground">{title}</div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">
                        <DotSeparated items={meta} />
                    </div>
                </div>
                {stage ? <StageBadge status={stage} className="self-start" /> : null}
            </div>
        </Link>
    );
}

/** §6: bars shaped like two-line rows, laid out like the filled grid. */
function RowsLoading({ label }: { label: string }) {
    return (
        <WaitState
            label={label}
            className="mt-2"
            skeleton={
                <div className="grid md:grid-cols-2 md:gap-x-6">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="poster-list-inset-x pt-3">
                            <div className="space-y-1.5 border-b border-border pb-3">
                                <WaitBar className="h-4 w-2/3" />
                                <WaitBar className="h-3 w-1/3" />
                            </div>
                        </div>
                    ))}
                </div>
            }
        />
    );
}

/** Signed out: both sections keep their place and say what they will hold;
 *  the one sign-up gate opens them. */
function SignedOutPlaceholder({ returnTo }: { returnTo: SitePath }) {
    const sections = [
        { title: COPY.trackerTitle, body: COPY.trackerPlaceholder, testId: "hub-tracker-placeholder" },
        { title: COPY.recentTitle, body: COPY.recentPlaceholder, testId: "hub-recent-placeholder" },
    ];
    return (
        <div data-testid="hub-your-jobs" data-signed-in="false">
            <div className="grid gap-4 md:grid-cols-2">
                {sections.map((s) => (
                    <HubPanel key={s.testId} title={s.title} titleId={`${s.testId}-title`} testId={s.testId}>
                        <p className="mt-3 poster-list-inset-x text-sm text-muted-foreground">{s.body}</p>
                    </HubPanel>
                ))}
            </div>
            <SignupGate reason="tracker" originSurface="for_you" returnTo={returnTo} className="mt-6" />
        </div>
    );
}
