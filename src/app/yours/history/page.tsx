"use client";

/**
 * Viewed-jobs history — the read side of `job_views`. Sibling route to
 * `/yours` (switched via `TrackerTabs`), same page shell (`PageLayout` +
 * `PageHeader`) and the same sign-in-gate idiom `/yours` uses for guests
 * (`AuthPopover` + `formatAuthGateValueLine("generic")`) — but views have no
 * guest/localStorage equivalent to fall back to (unlike pursuits), so a
 * signed-out visitor sees a gate here instead of a guest-mode empty tracker.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { formatAuthGateValueLine } from "@/lib/auth/auth-gate-copy";
import { useViewed } from "@/lib/views/use-viewed";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { stageLabel, type Pursuit } from "@/lib/pursuits/types";
import { trackerStatusColorClass } from "@/lib/pursuits/tracker-display";
import { cn } from "@/lib/utils";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { jobPath } from "@/lib/jobs/job-slug";
import { displayCompanyName } from "@/lib/jobs/presentation";
import { TrackerTabs } from "@/components/tracker/TrackerTabs";
import { DotSeparated } from "@/components/ui/dot-separated";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import type { JobView } from "@/lib/views/types";

function HistoryHeader() {
    return (
        <PageHeader
            fullWidth
            sticky={false}
            title="Tracker"
            description="Every job you've opened, newest first."
        />
    );
}

function HistoryGate({ onLoginClick }: { onLoginClick: () => void }) {
    return (
        <div className="mx-auto max-w-[480px] rounded-none border border-border bg-card p-8 text-center space-y-6">
            <ClockCounterClockwise size={24} weight="duotone" className="mx-auto text-muted-foreground" />
            <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">Sign in to see your history</h3>
                <p className="text-sm text-muted-foreground">
                    We keep track of every job you open so you can find your way back to it.
                </p>
            </div>
            <Button className="font-semibold" onClick={onLoginClick}>
                Sign in
            </Button>
        </div>
    );
}

function HistoryEmptyState() {
    return (
        <div data-testid="history-empty" className="mx-auto max-w-[480px] rounded-none border border-border bg-card p-8 text-center space-y-6">
            <ClockCounterClockwise size={24} weight="duotone" className="mx-auto text-muted-foreground" />
            <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">Jobs you open will show up here.</h3>
            </div>
            <Button asChild className="font-semibold">
                <Link href="/jobs">Browse verified roles</Link>
            </Button>
        </div>
    );
}

function HistoryRow({ view, stage }: { view: JobView; stage: Pursuit | undefined }) {
    const snapshot = view.job_snapshot;
    const href = jobPath({ id: view.job_id, title: snapshot.title, company: snapshot.company });
    // `job_snapshot.company` is a Firestore-stored copy taken when the job was
    // viewed (`buildJobSnapshot`, lib/pursuits/types.ts) — the live Meili index
    // carries the ATS-stated raw name permanently (intervu owns brand cleaning
    // at display time, never at ingest — ingest is the pipeline repo's
    // sync.mjs, which PUTs the Subspace feed through unchanged), so every
    // snapshot taken from it carries the raw value too, and a view is
    // never rewritten after the fact. Cleaned at render instead, same as every
    // live search hit.
    const companyName = displayCompanyName(snapshot.company);
    return (
        <div
            data-testid="history-row"
            className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1.5 px-3 py-4"
        >
            <div className="min-w-0">
                <Link href={href} className="block truncate text-base font-semibold hover:text-brand">
                    {snapshot.title}
                </Link>
                <div className="truncate text-sm text-muted-foreground">{companyName}</div>
            </div>
            {stage && (
                <span className={cn("h-fit text-sm", trackerStatusColorClass(stage.status))}>
                    {stageLabel(stage, Date.now())}
                </span>
            )}
            <div className="col-span-2 font-mono text-sm text-muted-foreground">
                <DotSeparated
                    items={[
                        formatRelativeAge(view.last_viewed_at, Date.now()),
                        view.view_count > 1 && `viewed ${view.view_count}×`,
                    ]}
                />
            </div>
        </div>
    );
}

function HistoryLoading() {
    return (
        <div aria-hidden className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton-bar h-[72px] w-full" />
            ))}
            <span className="sr-only">Loading your history…</span>
        </div>
    );
}

export default function HistoryPage() {
    const [user, setUser] = useState(() => getCurrentUser());
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const { entries, loading } = useViewed();
    const { byJobId } = usePursuits();

    useEffect(() => onAuthChange(setUser), []);

    return (
        <PageLayout fullWidth header={<HistoryHeader />}>
            <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 pb-16 pt-6 sm:px-8 xl:px-10">
                <TrackerTabs active="history" />
                {!user ? (
                    <div className="mt-4">
                        <HistoryGate onLoginClick={() => setAuthPopoverOpen(true)} />
                    </div>
                ) : loading ? (
                    <div className="mt-4">
                        <HistoryLoading />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="mt-4">
                        <HistoryEmptyState />
                    </div>
                ) : (
                    <div className="mt-4 divide-y divide-border border-t border-border">
                        {entries.map((view) => (
                            <HistoryRow key={view.id} view={view} stage={byJobId.get(view.job_id)} />
                        ))}
                    </div>
                )}
            </div>

            <AuthPopover
                open={authPopoverOpen}
                onOpenChange={setAuthPopoverOpen}
                showTrigger={false}
                valueLine={!user ? formatAuthGateValueLine("generic") : undefined}
            />
        </PageLayout>
    );
}
