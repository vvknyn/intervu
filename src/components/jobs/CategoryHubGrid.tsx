"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { jobsBrowseSearchHref, jobsForYouHubHref } from "@/lib/jobs/prefetch-jobs-route";
import { cn } from "@/lib/utils";
import { WaitState } from "@/components/ui/wait-state";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { hubChipCountText, HUB_PACK_CORPUS_COUNT_LOADING } from "@/lib/jobs/for-you/hub-counts";
import { hubGreeting } from "@/lib/jobs/front-door-state";

const noSubscription = () => () => {};

export interface CategoryHubItem {
    id: string;
    label: string;
}

/** The packs, in chip order. Labels match `HUB_PACK_SHORT_LABELS`; counts are always live (`hubCountLabels`), never written here. */
export const DEFAULT_CATEGORY_HUBS: CategoryHubItem[] = [
    { id: "all", label: "All your matches" },
    { id: "ai", label: "Artificial intelligence" },
    { id: "remote", label: "Fully remote" },
    { id: "fresh", label: "Added this week" },
    { id: "salary", label: "Jobs with salaries" },
    { id: "apply", label: "1-Click tailored apply" },
    { id: "lead", label: "Lead & principal" },
    { id: "good", label: "Tech for good" },
];

export interface CategoryHubGridProps {
    userName?: string | null;
    isAuthenticated?: boolean;
    hasResume?: boolean;
    activeCategoryId?: string;
    /** Opens the pack; `source` says whether a chip or "Browse all matches" did. */
    onSelectCategory: (category: CategoryHubItem, source: "tile" | "browse_all") => void;
    /** Live count labels keyed by hub id ("96 roles", "31+ roles", "…"). */
    hubCountLabels?: Partial<Record<string, string>>;
    /** Roles a pack gained since the last visit (`hub-count-deltas.ts`), keyed by hub id; shown as "+N". */
    hubCountDeltas?: Partial<Record<string, number>>;
    /** Quiet daily apply tip near Browse all / greeting. */
    dailyApplyTip?: string | null;
    /** True while the progressive fit probe is still climbing pack counts. */
    hubMatching?: boolean;
    /** Quiet corpus line under Welcome, e.g. "~508 matches ranked Strong first". */
    hubCorpusLine?: string | null;
    /** Honest removal cue when prior known pack counts shrink. */
    hubRemovalsLine?: string | null;
    /** Rendered under the pack chips — the packs hub puts the visitor's tracker and Recently viewed here. */
    footer?: React.ReactNode;
    /**
     * The Today header (`TodayHome`) sits above and owns the greeting and the
     * daily count: the welcome panel shrinks to a "Your packs" line with the
     * corpus line and "Browse all matches".
     */
    compactHeader?: boolean;
    className?: string;
}

export function CategoryHubGrid({
    userName,
    isAuthenticated = false,
    hasResume = false,
    activeCategoryId,
    onSelectCategory,
    hubCountLabels,
    hubCountDeltas,
    dailyApplyTip,
    hubMatching = false,
    hubCorpusLine = null,
    hubRemovalsLine = null,
    footer,
    compactHeader = false,
    className,
}: CategoryHubGridProps) {
    const router = useRouter();
    // A capture-only latch in sessionStorage: false on the server, read once on the client.
    const proofLoading = useSyncExternalStore(noSubscription, readPacksProofLoading, () => false);

    useEffect(() => {
        try {
            router.prefetch(jobsForYouHubHref());
            router.prefetch(jobsBrowseSearchHref(""));
        } catch {
            /* prefetch is best-effort */
        }
    }, [router]);

    const { title: greetingTitle, subtitle: greetingSubtitle } = hubGreeting({
        signedIn: isAuthenticated,
        userName,
        hasResume,
    });

    const hubStatusLines = (
        <>
            {hubCorpusLine ? (
                <p
                    className="pt-1 text-xs text-muted-foreground tabular-nums"
                    data-testid="hub-corpus-line"
                >
                    {hubCorpusLine}
                </p>
            ) : null}
            {hubRemovalsLine ? (
                <p
                    className="pt-0.5 text-xs text-muted-foreground"
                    data-testid="hub-removals-line"
                >
                    Recently cleared · {hubRemovalsLine}
                </p>
            ) : null}
            {proofLoading || (hubMatching && !hubCorpusLine) ? (
                <WaitState
                    label="Counting matches across your packs"
                    className="pt-1 text-xs font-semibold"
                />
            ) : null}
        </>
    );

    const browseAllButton = (
        <Button
            type="button"
            variant={compactHeader ? "outline" : "default"}
            data-testid="hub-browse-all-matches"
            onClick={() => {
                const allItem = DEFAULT_CATEGORY_HUBS.find((c) => c.id === "all");
                if (allItem) onSelectCategory(allItem, "browse_all");
            }}
            className="w-full justify-center sm:w-auto"
        >
            Browse all matches
        </Button>
    );

    return (
        <section
            aria-label="Job categories"
            data-testid="job-packs-hub"
            className={cn(
                "space-y-4 px-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] touch-manipulation",
                className,
            )}
        >
            {compactHeader ? (
                <div
                    data-testid="hub-compact-header"
                    className="poster-list-inset-x flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"
                >
                    <div className="min-w-0 space-y-0.5">
                        <h2 className="text-base font-semibold leading-snug text-foreground">Your packs</h2>
                        {hubStatusLines}
                    </div>
                    {browseAllButton}
                </div>
            ) : (
            /* Welcome banner — Concept A calm Velai panel */
            <div className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-4 sm:p-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="space-y-1">
                        {hasResume && (
                            <div className="inline-flex items-center gap-1.5 rounded-pill bg-muted px-2.5 py-0.5 text-xs font-semibold text-live">
                                <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                                Private matching active on this device
                            </div>
                        )}
                        <h2 className="text-xl font-semibold text-foreground">
                            {greetingTitle}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {greetingSubtitle}
                        </p>
                        {dailyApplyTip ? (
                            <p
                                className="pt-1 text-xs text-muted-foreground"
                                data-testid="hub-daily-apply-tip"
                            >
                                {dailyApplyTip}
                            </p>
                        ) : null}
                        {hubStatusLines}
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                        {browseAllButton}
                    </div>
                </div>
            </div>
            )}

            {/* The packs as one row of chips: label, live count, and "+N" since the last visit. */}
            <ul aria-label="Your packs" data-testid="hub-pack-chips" className="flex flex-wrap gap-2 poster-list-inset-x">
                {DEFAULT_CATEGORY_HUBS.map((category, hubIndex) => {
                    const countLabel = hubCountLabels?.[category.id] ?? "";
                    const counting = countLabel === HUB_PACK_CORPUS_COUNT_LOADING;
                    const delta = hubCountDeltas?.[category.id] ?? 0;
                    // The chip shows "96 +3"; a screen reader hears "Fully remote, 96 roles, 3 more since your last visit".
                    const spoken = [
                        category.label,
                        countLabel && !counting ? countLabel : null,
                        delta > 0 ? `${delta} more since your last visit` : null,
                    ]
                        .filter(Boolean)
                        .join(", ");
                    const prefetchAdjacentHub = () => {
                        const next = DEFAULT_CATEGORY_HUBS[hubIndex + 1] ?? DEFAULT_CATEGORY_HUBS[0];
                        try {
                            router.prefetch(jobsForYouHubHref());
                            if (next?.id === "all") {
                                router.prefetch(jobsBrowseSearchHref(""));
                            }
                        } catch {
                            /* prefetch is best-effort */
                        }
                    };

                    return (
                        <li key={category.id}>
                            <button
                                type="button"
                                data-testid={`hub-pack-card-${category.id}`}
                                aria-pressed={activeCategoryId === category.id}
                                aria-label={spoken}
                                onClick={() => onSelectCategory(category, "tile")}
                                onMouseEnter={prefetchAdjacentHub}
                                onFocus={prefetchAdjacentHub}
                                className={chipVariants({ active: activeCategoryId === category.id, interactive: true })}
                            >
                                <span data-testid={`hub-pack-title-${category.id}`}>{category.label}</span>
                                {countLabel ? (
                                    <span
                                        className={cn("text-muted-foreground", hubMatching && "opacity-80")}
                                        data-testid={`hub-pack-count-${category.id}`}
                                        data-matching={hubMatching ? "true" : undefined}
                                    >
                                        {hubChipCountText(countLabel)}
                                    </span>
                                ) : null}
                                {delta > 0 ? (
                                    <span className="font-semibold text-brand" data-testid={`hub-pack-delta-${category.id}`}>
                                        +{delta}
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>

            {footer}
        </section>
    );
}
