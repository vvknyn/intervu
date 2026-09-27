"use client";

import Link from "next/link";
import { BrandLockup } from "@/components/brand/BrandMark";
import {
    RouteStatusLayout,
    RouteStatusPanel,
    routeStatusFixtureMinClassName,
} from "@/components/layout/route-status-chrome";
import { OfflineShellPanel } from "@/components/layout/offline-shell";
import { ConceptAEmptyState } from "@/components/ui/concept-a-empty-state";
import { JOBS_SESSION_FRAME_CLASS, JobsSessionLoadingShell } from "@/components/layout/jobs-session-loading";
import { posterListInsetClassName, shellMaxWidthClassName } from "@/components/layout/route-loading";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConceptAEmptyIllustration } from "@/components/ui/concept-a-empty-illustration";
import { notFound } from "next/navigation";

function MockSearchZeroChips() {
    return (
        <p className="mt-2 text-xs text-muted-foreground">
            <button type="button" data-testid="empty-state-clear-chip" className="underline underline-offset-2">
                ✕ clear query
            </button>
        </p>
    );
}

export type EmptyStateSurface =
    | "tracker"
    | "history"
    | "for-you"
    | "for-you-blocked"
    | "search"
    | "session-loading"
    | "offline"
    | "404";

const SURFACES: EmptyStateSurface[] = [
    "tracker",
    "history",
    "for-you",
    "for-you-blocked",
    "search",
    "session-loading",
    "offline",
    "404",
];

function isSurface(value: string | null): value is EmptyStateSurface {
    return value != null && (SURFACES as string[]).includes(value);
}

export function EmptyStatesMock({ surface }: { surface: string | null }) {
    if (!isSurface(surface)) {
        notFound();
    }

    return (
        <div
            className={cn(
                "mx-auto w-full py-10",
                shellMaxWidthClassName,
                posterListInsetClassName,
            )}
            data-testid={`mock-empty-${surface}`}
        >
            {surface === "tracker" && (
                <ConceptAEmptyState
                    layout="inline"
                    testId="yours-empty"
                    title="Your tracker is empty."
                    description="Save roles while browsing verified jobs, then pick up where you left off here."
                    actions={
                        <Button asChild variant="outline" size="sm">
                            <Link href="/jobs">Browse verified roles</Link>
                        </Button>
                    }
                />
            )}
            {surface === "history" && (
                <ConceptAEmptyState
                    layout="inline"
                    testId="history-empty"
                    title="Jobs you open will show up here."
                    description="Open a role from Search or For you and we'll keep the trail warm for you."
                    actions={
                        <Button asChild size="sm">
                            <Link href="/jobs">Browse verified roles</Link>
                        </Button>
                    }
                />
            )}
            {surface === "for-you" && (
                <ConceptAEmptyState
                    testId="for-you-empty"
                    title="No ranked roles to show right now."
                    description="Try Search to browse the full list—we'll keep your place here."
                    actions={
                        <Button type="button" variant="outline">
                            Go to Search
                        </Button>
                    }
                />
            )}
            {surface === "for-you-blocked" && (
                <ConceptAEmptyState
                    testId="for-you-empty-blocked"
                    title="We can't rank roles without a résumé on file."
                    description="Upload a PDF or Word résumé to unlock personalized picks, then come back to For you."
                    actions={
                        <Button type="button" variant="outline">
                            Upload résumé
                        </Button>
                    }
                />
            )}
            {surface === "search" && (
                <div className="py-8 text-left" data-testid="search-empty-results">
                    <ConceptAEmptyIllustration className="mb-4" />
                    <p className="text-sm text-foreground">No roles match.</p>
                    <MockSearchZeroChips />
                </div>
            )}
            {surface === "session-loading" && (
                <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")}>
                    <JobsSessionLoadingShell />
                </div>
            )}
            {surface === "offline" && <OfflineShellPanel />}
            {surface === "404" && (
                <RouteStatusLayout className={routeStatusFixtureMinClassName}>
                    <RouteStatusPanel className="enter-reveal text-center">
                        <BrandLockup className="mx-auto w-fit" />
                        <p className="mt-4 text-xs text-muted-foreground">404</p>
                        <h1 className="mt-1 text-title-sm font-semibold text-foreground">Page not found</h1>
                        <p className="mt-2 text-body-sm text-muted-foreground">
                            That page doesn&apos;t exist, or it moved. Let&apos;s get you back on track.
                        </p>
                        <Button asChild size="sm" className="mt-8">
                            <Link href="/jobs">Go to jobs</Link>
                        </Button>
                    </RouteStatusPanel>
                </RouteStatusLayout>
            )}
        </div>
    );
}
