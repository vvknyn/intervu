"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { jobsBrowseSearchHref, jobsForYouHubHref } from "@/lib/jobs/prefetch-jobs-route";
import { cn } from "@/lib/utils";
import { WaitState } from "@/components/ui/wait-state";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { DERIVED_CHIP_CLASS } from "@/components/jobs/for-you/ForYouPack";
import { HUB_TILE_FALLBACK_ICON, HUB_TILE_ICON } from "@/components/jobs/hub-tile-icons";
import { useReturningVisitor } from "@/components/jobs/for-you/TodayHome";
import { HUB_PACK_CORPUS_COUNT_LOADING } from "@/lib/jobs/for-you/hub-counts";
import type { HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import { hubGreeting } from "@/lib/jobs/front-door-state";
import { PRIVATE_MATCHING_ACTIVE } from "@/lib/jobs/resume-privacy-copy";

const noSubscription = () => () => {};

/**
 * Columns from tablet up: a count that would leave one tile alone on the last row takes three across instead of four
 * (3, 5 and 6 tiles); every other count fills rows of four. On a phone it is two across, and when a tile would be left
 * alone the first ("All your matches") takes the whole row.
 */
function tileColumnsClass(count: number): string {
    return count === 3 || count === 5 || count === 6 ? "md:grid-cols-3" : "md:grid-cols-4";
}

export interface CategoryHubItem {
    id: string;
    label: string;
}

/**
 * The packs a visitor without a résumé sees, in tile order. A résumé visitor
 * gets their industry's tiles instead (`categories`, industry-tiles.ts).
 * Labels match `HUB_PACK_SHORT_LABELS`; counts are always live (`hubCountLabels`), never written here.
 */
export const DEFAULT_CATEGORY_HUBS: CategoryHubItem[] = [
    { id: "all", label: "All your matches" },
    { id: "ai", label: "Artificial intelligence" },
    { id: "remote", label: "Fully remote" },
    { id: "fresh", label: "Added this week" },
    { id: "salary", label: "Pay listed" },
    { id: "apply", label: "1-Click tailored apply" },
    { id: "lead", label: "Lead & principal" },
    { id: "good", label: "Tech for good" },
];

export interface CategoryHubGridProps {
    /** The tiles to show, "all" first; defaults to `DEFAULT_CATEGORY_HUBS`. */
    categories?: CategoryHubItem[];
    userName?: string | null;
    isAuthenticated?: boolean;
    hasResume?: boolean;
    activeCategoryId?: string;
    /** Opens the pack; `source` says what opened it. */
    onSelectCategory: (category: CategoryHubItem, source: "tile") => void;
    /** Live count labels keyed by hub id ("96 roles", "31+ roles", "…"). */
    hubCountLabels?: Partial<Record<string, string>>;
    /** Roles a pack gained since the last visit (`hub-count-deltas.ts`), keyed by hub id; shown as "+N". */
    hubCountDeltas?: Partial<Record<string, number>>;
    /** Quiet daily apply tip near Browse all / greeting. */
    dailyApplyTip?: string | null;
    /** True while the progressive fit probe is still climbing pack counts. */
    hubMatching?: boolean;
    /** Quiet line under Welcome for a visitor with no résumé: the roles there are, e.g. "~508 roles". */
    hubCorpusLine?: string | null;
    /** What the first tile counts, in the deck's own words: "15 roles fit your résumé · best fit first". */
    hubFitLine?: string | null;
    /** Why the rest were left out, in the deck's own words: "Left out of the first 150 of 226 roles found: 41 above your level · …". */
    hubLeftOutLine?: string | null;
    /** Rendered under the pack tiles — the packs hub puts Today, the visitor's tracker and Recently viewed here. */
    footer?: React.ReactNode;
    /**
     * Which résumé the counts and matches are ranked against, with Replace
     * (`ResumeInUse`): it takes the subtitle's place, which only says the
     * same thing less exactly.
     */
    resumeLine?: React.ReactNode;
    /** "Last here Friday" (`TodayLastHere`), under the greeting. */
    lastHere?: React.ReactNode;
    className?: string;
}

export function CategoryHubGrid({
    categories = DEFAULT_CATEGORY_HUBS,
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
    hubFitLine = null,
    hubLeftOutLine = null,
    footer,
    resumeLine = null,
    lastHere = null,
    className,
}: CategoryHubGridProps) {
    const router = useRouter();
    // A capture-only latch in sessionStorage: false on the server, read once on the client.
    const proofLoading = useSyncExternalStore(noSubscription, readPacksProofLoading, () => false);
    const returning = useReturningVisitor();

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
        returning,
    });

    // What the first tile counts and why the rest were left out, in the deck's own words, under the tiles they explain.
    const hubStatusLines = (
        <>
            {hubFitLine ? (
                <p className="text-sm font-semibold text-foreground tabular-nums" data-testid="hub-fit-line">
                    {hubFitLine}
                </p>
            ) : null}
            {hubLeftOutLine ? (
                <p className="max-w-prose text-xs text-muted-foreground" data-testid="hub-left-out-line">
                    {hubLeftOutLine}
                </p>
            ) : null}
            {hubCorpusLine ? (
                <p
                    className="text-xs text-muted-foreground tabular-nums"
                    data-testid="hub-corpus-line"
                >
                    {hubCorpusLine}
                </p>
            ) : null}
            {proofLoading || (hubMatching && !hubCorpusLine && !hubFitLine) ? (
                <WaitState
                    label="Counting matches across your packs"
                    className="text-xs font-semibold"
                />
            ) : null}
        </>
    );

    // Without a résumé nothing is matched, so the first tile is every role, not "your matches".
    const tileCategories = hasResume
        ? categories
        : categories.map((category) => (category.id === "all" ? { ...category, label: "All roles" } : category));

    return (
        <section
            aria-label="Job categories"
            data-testid="job-packs-hub"
            className={cn(
                "space-y-6 px-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] touch-manipulation",
                className,
            )}
        >
            {/* Welcome: a greeting on the page itself, then the packs as big tiles. */}
            <div className="space-y-1">
                {hasResume && (
                    <div
                        className="inline-flex items-center gap-1.5 rounded-pill bg-muted px-2.5 py-0.5 text-xs font-semibold text-live"
                        data-testid="hub-private-matching"
                    >
                        <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                        {PRIVATE_MATCHING_ACTIVE}
                    </div>
                )}
                {/* page-scale-allow: the packs home's greeting is its hero line, one step above the tile titles (the page's h1 is the sr-only "Jobs") */}
                <h2 className="text-2xl font-semibold leading-snug text-foreground text-balance">
                    {greetingTitle}
                </h2>
                {lastHere}
                {resumeLine ?? (
                    <p className="text-xs text-muted-foreground">
                        {greetingSubtitle}
                    </p>
                )}
                {dailyApplyTip ? (
                    <p
                        className="pt-1 text-xs text-muted-foreground"
                        data-testid="hub-daily-apply-tip"
                    >
                        {dailyApplyTip}
                    </p>
                ) : null}
            </div>

            {/* The packs as tiles, two across on a phone: a glyph ("+N" since the last visit beside it), the title, and the live count in the deck's own words ("14 roles at 7 employers"). */}
            <ul aria-label="Your packs" data-testid="hub-pack-chips" className={cn("grid grid-cols-2 gap-3 md:gap-4", tileColumnsClass(tileCategories.length))}>
                {tileCategories.map((category, hubIndex) => {
                    const countLabel = hubCountLabels?.[category.id] ?? "";
                    const counting = countLabel === HUB_PACK_CORPUS_COUNT_LOADING;
                    const delta = hubCountDeltas?.[category.id] ?? 0;
                    const active = activeCategoryId === category.id;
                    const TileIcon = HUB_TILE_ICON[category.id as HubPackId] ?? HUB_TILE_FALLBACK_ICON;
                    // The tile shows "+3" and "96 roles"; a screen reader hears "Fully remote, 96 roles, 3 more since your last visit".
                    const spoken = [
                        category.label,
                        countLabel && !counting ? countLabel : null,
                        delta > 0 ? `${delta} more since your last visit` : null,
                    ]
                        .filter(Boolean)
                        .join(", ");
                    const prefetchAdjacentHub = () => {
                        const next = categories[hubIndex + 1] ?? categories[0];
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
                        <li
                            key={category.id}
                            className={cn("flex", hubIndex === 0 && tileCategories.length > 1 && tileCategories.length % 2 === 1 && "col-span-2 md:col-span-1")}
                        >
                            <button
                                type="button"
                                data-testid={`hub-pack-card-${category.id}`}
                                data-active={active ? "true" : undefined}
                                aria-label={spoken}
                                onClick={() => onSelectCategory(category, "tile")}
                                onMouseEnter={prefetchAdjacentHub}
                                onFocus={prefetchAdjacentHub}
                                className={cn(
                                    "flex w-full flex-col justify-between gap-8 rounded-panel border bg-surface-postcard p-5 text-left text-surface-postcard-foreground transition-colors hover:border-surface-postcard-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none",
                                    active ? "border-surface-postcard-foreground" : "border-transparent",
                                )}
                            >
                                <span className="flex items-start justify-between gap-2">
                                    <TileIcon size={24} aria-hidden />
                                    {delta > 0 ? (
                                        <span className="text-xs font-semibold text-live-on-postcard tabular-nums" data-testid={`hub-pack-delta-${category.id}`}>
                                            +{delta}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="flex flex-col items-start gap-2">
                                    <span className="text-xl font-semibold leading-snug text-balance" data-testid={`hub-pack-title-${category.id}`}>{category.label}</span>
                                    {countLabel ? (
                                        <span
                                            className={cn(DERIVED_CHIP_CLASS, "font-semibold tabular-nums")}
                                            data-testid={`hub-pack-count-${category.id}`}
                                            data-matching={hubMatching ? "true" : undefined}
                                        >
                                            {countLabel}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>

            <div className="space-y-1 empty:hidden">{hubStatusLines}</div>

            {footer}
        </section>
    );
}
