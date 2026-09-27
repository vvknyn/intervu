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
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { AUTH_CTA_LABEL, formatAuthGateValueLine } from "@/lib/auth/auth-gate-copy";
import { useViewed } from "@/lib/views/use-viewed";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import type { Pursuit } from "@/lib/pursuits/types";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { jobPath } from "@/lib/jobs/job-slug";
import { displayCompanyName } from "@/lib/jobs/presentation";
import { TrackerTabs } from "@/components/tracker/TrackerTabs";
import { DotSeparated } from "@/components/ui/dot-separated";
import { StageBadge } from "@/components/tracker/StageBadge";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import type { JobView } from "@/lib/views/types";
import { posterListPanelClassName } from "@/components/layout/route-loading";
import { ConceptAEmptyPageSlot, ConceptAEmptyState } from "@/components/ui/concept-a-empty-state";
import { EmptyState } from "@/components/ui/empty-state";

/** Exported so `/mock/history` (fixture preview — `useViewed()` has no
 *  guest fallback, so the real route can't show filled/empty states
 *  signed-out) renders the identical header instead of a copy. */
export function HistoryHeader() {
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
        <EmptyState
            title="Sign in to see your history."
            description="We keep track of every job you open so you can find your way back to it."
            actions={
                <Button className="rounded-ctl font-semibold" onClick={onLoginClick}>
                    {AUTH_CTA_LABEL}
                </Button>
            }
        />
    );
}

function HistoryEmptyState() {
    return (
        <ConceptAEmptyState
            testId="history-empty"
            title="Jobs you open will show up here."
            description="Open a role from Search or For you and we'll keep the trail warm for you."
            actions={
                <Button asChild className="rounded-ctl font-semibold">
                    <Link href="/jobs">Browse verified roles</Link>
                </Button>
            }
        />
    );
}

/** design-language.md §4 row anatomy (history is explicitly one of the
 *  named row-anatomy surfaces) — the whole row is the tap target (matches
 *  PursuitListRow's convention), no leading tile column, stage rendered via
 *  the shared `StageBadge` pill (single source of truth with the tracker
 *  list row and the pursuit detail sheet — see StageBadge's doc comment). */
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
        <Link
            href={href}
            data-testid="history-row"
            className="grid rounded-none bg-transparent px-[var(--list-inset)] pt-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-live"
        >
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border pb-4">
                <div className="min-w-0">
                    <div className="truncate text-base font-semibold leading-snug text-foreground">{snapshot.title}</div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">{companyName}</div>
                    <div className="mt-1 font-mono text-sm text-muted-foreground">
                        <DotSeparated
                            items={[
                                formatRelativeAge(view.last_viewed_at, Date.now()),
                                view.view_count > 1 && `viewed ${view.view_count}×`,
                            ]}
                        />
                    </div>
                </div>
                {stage && <StageBadge status={stage.status} className="self-start" />}
            </div>
        </Link>
    );
}

/**
 * The loading/empty/filled ladder for a resolved (signed-in) viewer — pulled
 * out of `HistoryPage` so the `/mock/history` fixture route can render the
 * exact same list markup against fixture data instead of a reimplementation
 * that could drift from what real viewers see.
 */
export function HistoryList({
    loading,
    entries,
    byJobId,
}: {
    loading: boolean;
    entries: JobView[];
    byJobId: Map<string, Pursuit>;
}) {
    if (loading) return <HistoryLoading />;
    if (entries.length === 0) {
        return (
            <ConceptAEmptyPageSlot placement="after-controls">
                <HistoryEmptyState />
            </ConceptAEmptyPageSlot>
        );
    }
    return (
        <div className={posterListPanelClassName}>
            <div className="divide-y divide-border border-t border-border">
                {entries.map((view) => (
                    <HistoryRow key={view.id} view={view} stage={byJobId.get(view.job_id)} />
                ))}
            </div>
        </div>
    );
}

/** §6: "skeleton-bar bars shaped like the row anatomy" — decomposed into
 *  title/company/meta bars (matches the jobs/page.tsx reference skeleton),
 *  not one flat block standing in for the whole row. */
function HistoryLoading() {
    return (
        <div className={posterListPanelClassName} role="status" aria-busy="true">
            <div aria-hidden className="divide-y divide-border border-t border-border">
                {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="px-[var(--list-inset)] pt-4">
                        <div className="space-y-1.5 border-b border-border pb-4">
                            <div className="skeleton-bar h-4 w-2/3" />
                            <div className="skeleton-bar h-3 w-1/3" />
                            <div className="skeleton-bar h-3 w-24" />
                        </div>
                    </div>
                ))}
            </div>
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
                ) : (
                    <div className="mt-4">
                        <HistoryList loading={loading} entries={entries} byJobId={byJobId} />
                    </div>
                )}
            </div>

            <AuthPopover
                open={authPopoverOpen}
                onOpenChange={setAuthPopoverOpen}
                showTrigger={false}
                trigger="user"
                valueLine={!user ? formatAuthGateValueLine("generic") : undefined}
            />
        </PageLayout>
    );
}
