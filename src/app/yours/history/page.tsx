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
import { Badge } from "@/components/ui/badge";
import { AuthPopover } from "@/components/auth/auth-popover";
import { formatAuthGateValueLine } from "@/lib/auth/auth-gate-copy";
import { useViewed } from "@/lib/views/use-viewed";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { stageLabel, type Pursuit } from "@/lib/pursuits/types";
import { applicationStatusTone, STATUS_BADGE_VARIANT } from "@/lib/ui/status-tokens";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { jobPath } from "@/lib/jobs/job-slug";
import { displayCompanyName } from "@/lib/jobs/presentation";
import { TrackerTabs } from "@/components/tracker/TrackerTabs";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import type { JobView } from "@/lib/views/types";

function HistoryHeader() {
    return (
        <PageHeader
            size="display"
            fullWidth
            sticky={false}
            title="Tracker"
            description="Every job you've opened, newest first."
        />
    );
}

function HistoryGate({ onLoginClick }: { onLoginClick: () => void }) {
    return (
        <div className="rounded-none border border-border bg-card p-8 text-center space-y-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-brand bg-muted text-brand">
                <ClockCounterClockwise size={24} weight="duotone" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-lg font-semibold text-foreground">Sign in to see your history</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    We keep track of every job you open so you can find your way back to it.
                </p>
            </div>
            <Button className="rounded-none font-semibold" onClick={onLoginClick}>
                Sign in
            </Button>
        </div>
    );
}

function HistoryEmptyState() {
    return (
        <div data-testid="history-empty" className="rounded-none border border-border bg-card p-8 text-center space-y-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-brand bg-muted text-brand">
                <ClockCounterClockwise size={24} weight="duotone" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-lg font-semibold text-foreground">Jobs you open will show up here.</h3>
            </div>
            <Button asChild className="rounded-none font-semibold">
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
            className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1.5 rounded-none border border-border bg-card p-4"
        >
            <div className="min-w-0">
                <Link href={href} className="block truncate text-sm font-semibold hover:text-brand">
                    {snapshot.title}
                </Link>
                <div className="truncate text-xs text-muted-foreground">{companyName}</div>
            </div>
            {stage && (
                <Badge variant={STATUS_BADGE_VARIANT[applicationStatusTone(stage.status)]}>
                    {stageLabel(stage, Date.now())}
                </Badge>
            )}
            <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[#8b939e]">
                <span>{formatRelativeAge(view.last_viewed_at, Date.now())}</span>
                {view.view_count > 1 && (
                    <>
                        <span aria-hidden="true">·</span>
                        <span>viewed {view.view_count}×</span>
                    </>
                )}
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
                <div className="mt-4 space-y-3">
                    {!user ? (
                        <HistoryGate onLoginClick={() => setAuthPopoverOpen(true)} />
                    ) : loading ? (
                        <HistoryLoading />
                    ) : entries.length === 0 ? (
                        <HistoryEmptyState />
                    ) : (
                        entries.map((view) => (
                            <HistoryRow key={view.id} view={view} stage={byJobId.get(view.job_id)} />
                        ))
                    )}
                </div>
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
