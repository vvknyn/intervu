"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, BookmarkSimple, CaretLeft, CaretRight, UploadSimple } from "@phosphor-icons/react";
import { InlineSpinner, WaitBar, WaitState } from "@/components/ui/wait-state";
import { Button } from "@/components/ui/button";
import { formatDeckShowingLine } from "@/lib/pursuits/daily-apply-plan";
import {
    JOBS_SESSION_FRAME_CLASS,
    JobsSessionLoadingShell,
} from "@/components/layout/jobs-session-loading";
import { ConceptAEmptyPageSlot, ConceptAEmptyState } from "@/components/ui/concept-a-empty-state";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { searchJobsAction } from "@/actions/jobs";
import { BroadenOptions } from "@/components/jobs/BroadenOptions";
import { countResults, isThinResults, locationDropped, namedPlaces } from "@/lib/jobs/broaden";
import type { CandidateSignals } from "@/lib/jobs/candidate-signals";
import { packFilters } from "@/lib/jobs/for-you/pack-filters";
import { HUB_PACK_SHORT_LABELS, type HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import { hubTile } from "@/lib/jobs/for-you/hub-tiles";
import { jobsBoardHref, serializeJobsUrl } from "@/lib/jobs/url-state";
import { LocalCustomizePanel } from "@/components/jobs/LocalCustomizePanel";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { RoleStack, focusedStackControl, restoreStackFocus } from "@/components/jobs/for-you/RoleStack";
import { StackedRoleCard } from "@/components/jobs/for-you/StackedRoleCard";
import { RoleTuningButtons } from "@/components/jobs/for-you/RoleTuningButtons";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { hasMeaningfulDiff } from "@/lib/jobs/for-you/tailor-diff";
import { resumeForPackApply } from "@/lib/jobs/for-you/pack-apply-location";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { deckListLoading } from "@/lib/jobs/for-you/deck-list-loading";
import { resolveDeckShortcut } from "@/lib/jobs/for-you/deck-keyboard";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";
import { tuningLine, type TuningSignal, type TuningSummary } from "@/lib/jobs/for-you/tuning";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { jobActionIconSize } from "@/lib/jobs/toolbar-control-height";
import { toast } from "@/lib/toast";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";
import { MOTION_DURATION_MS } from "@/lib/motion/interaction-contract";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import { cn } from "@/lib/utils";
import {
    FOR_YOU_DOWNLOAD_LABEL,
    FOR_YOU_UPLOAD_PDF_EMPTY,
} from "@/lib/jobs/resume-cta-copy";
import type { Pursuit } from "@/lib/pursuits/types";

export { JOBS_SESSION_FRAME_CLASS, JOBS_SESSION_FRAME_CLASS as FOR_YOU_HOME_FRAME_CLASS };

/** An opened pack is a stack of role cards (RoleStack): one role at a time,
 *  moved through with Previous / Next / Skip, arrow keys or a swipe. One
 *  header row carries the pack's name, the way back, its links and the
 *  position; the stack fills the rest of the screen and each card scrolls
 *  inside itself. */

/** Seconds on one role before reading it counts as interest (tuning.ts "dwell"). */
const DWELL_SECONDS = 20;

const REPLACE_RESUME_CLASS =
    "shrink-0 whitespace-nowrap text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground";

export interface ForYouHomeProps {
    visiblePacks: PublicJob[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    activeJob: PublicJob | null;
    onSkip: () => void;
    /** "Fewer like this": the open role goes, like Skip, and roles like it move down (tuning.ts). */
    onFewerLikeThis?: () => void;
    /** "More like this" on the open role, or takes it back. */
    onMoreLikeThis?: () => void;
    /** Roles given "more like this", to show the button pressed. */
    likedIds?: ReadonlySet<string>;
    /** Apply, Save, opening the posting or reading a while nudge too, more gently. */
    onRoleSignal?: (signal: Extract<TuningSignal, "apply" | "save" | "open" | "dwell">) => void;
    /** What the nudges lean toward and away from, with a way to drop them. */
    tuning?: TuningSummary | null;
    onResetTuning?: () => void;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    /** Résumé + saved preferences, resolved once by the page (`resolveCandidateSignals`). */
    signals: CandidateSignals | null;
    nowMs: number;
    /** The ranked list's read failed (after its automatic retry). With no
     *  rows, this renders `LoadFailedState` instead of the empty state. */
    loadError: string | null;
    onRetryLoad: () => void;
    fitResolving: boolean;
    loading: boolean;
    fitActive: boolean;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    /** A role the visitor deliberately stepped to (Next, Previous, an arrow
     *  key or a swipe), not the first card or the one Skip brings forward —
     *  the page records it as a view. */
    onOpenRow?: (job: PublicJob) => void;
    onRetryDescription?: (jobId: string) => void;
    onOpenPosting: (job: PublicJob) => void;
    onHomeViewChange: (view: JobsHomeView) => void;
    showSearchCta: boolean;
    onReplaceResume?: () => void;
    hasUsableResume?: boolean;
    /** Load next PAGE chunk into the deck (same loadMore as SERP). */
    onLoadMore?: () => void;
    loadingMore?: boolean;
    hasMore?: boolean;
    /** The page's fit gate, shown where the list stops for a guest (replaces "Show more"). */
    signupGate?: ReactNode;
    /** Known corpus total for optional "N of ~total · Strong first" near Show more. */
    resultTotal?: number | null;
    /** Location text the list's search could not filter on (`unmatchedPlaceMentions`).
     *  When it covers every place the pack names, the list is not the pack. */
    unmatchedPlaces?: string[];
    /** The hub tile this list was opened from: a filter tile's own filter is part of the pack (hub-tiles.ts). */
    tileId?: HubPackId;
    /** Back to the packs hub; the header row shows the way back only with it. */
    onBackToPacks?: () => void;
    /** CRAFT-3 — enter-reveal on first pack after auto-reveal. */
    firstRevealEnter?: boolean;
    /** CRAFT-3 — focus deck primary CTA once after first-pack auto-reveal. */
    firstRevealDeckFocus?: boolean;
    onFirstRevealFocusDone?: () => void;
    /** Active pack save — same RowBookmarkButton / optimistic overlay contract as SERP rows. */
    activePursuit?: Pursuit;
    onGoAfter?: (job: PublicJob) => void;
    saveSuccessPulse?: boolean;
}

/** "Iceland", "Iceland and Norway", "Iceland, Norway and Denmark". */
function formatPlaceList(places: string[]): string {
    return places.length < 2 ? (places[0] ?? "") : `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}

function RoleCardSkeleton() {
    return (
        <div className="flex flex-col gap-4 rounded-panel border border-border bg-card p-6" aria-hidden>
            <div className="flex items-center gap-3">
                <WaitBar className="size-10 shrink-0" />
                <WaitBar className="h-4 w-1/3" />
            </div>
            <WaitBar className="h-7 w-2/3" />
            <WaitBar className="h-4 w-1/2" />
            <div className="space-y-2 pt-2">
                <WaitBar className="h-3 w-full" />
                <WaitBar className="h-3 w-5/6" />
                <WaitBar className="h-3 w-4/6" />
            </div>
        </div>
    );
}

/** Nothing to list: a stable empty deck. */
const NO_PACKS: PublicJob[] = [];

export function ForYouHome({
    visiblePacks: listedPacks,
    activeIndex,
    onActiveIndexChange,
    activeJob,
    onSkip,
    onFewerLikeThis,
    onMoreLikeThis,
    likedIds,
    onRoleSignal,
    tuning = null,
    onResetTuning,
    matchScores,
    resume,
    signals,
    nowMs,
    fitResolving,
    loading,
    loadError,
    onRetryLoad,
    hydratedJobs,
    onActivePackChange,
    onOpenRow,
    onRetryDescription,
    onOpenPosting,
    onHomeViewChange,
    showSearchCta,
    onReplaceResume,
    hasUsableResume = false,
    onLoadMore,
    loadingMore = false,
    hasMore = false,
    signupGate = null,
    resultTotal = null,
    firstRevealEnter = false,
    firstRevealDeckFocus = false,
    onFirstRevealFocusDone,
    activePursuit,
    onGoAfter,
    saveSuccessPulse = false,
    unmatchedPlaces,
    tileId,
    onBackToPacks,
}: ForYouHomeProps) {
    // The pack is a `/jobs` filter state: "Edit filters" opens /jobs on exactly it.
    const filters = useMemo(
        () => (resume && signals ? hubTile(packFilters(resume, signals), tileId ?? "all").state : null),
        [resume, signals, tileId],
    );
    // The list's search dropped every place the pack names, so its rows come from
    // anywhere. The pack's location is where the candidate can work: none of them fit.
    // A failed read says nothing about where roles are: during a search outage the
    // place check fails too and reports the place as dropped, so the error wins.
    const placesMissing =
        filters != null && !loadError && locationDropped(filters, { unmatchedPlaceMentions: unmatchedPlaces });
    const visiblePacks = placesMissing ? NO_PACKS : listedPacks;
    // The list's own search kept the place and found nothing there: the corpus has roles in it,
    // none of them this pack's. Name the place, not the generic "right now" empty state.
    const placeEmpty =
        filters != null && !placesMissing && !loadError && resultTotal === 0 && visiblePacks.length === 0;
    const places = filters ? namedPlaces(filters) : [];
    const noRolesThereTitle =
        places.length === 0
            ? null
            : placesMissing
              ? `No roles in ${formatPlaceList(places)} yet.`
              : placeEmpty
                ? `No matching roles in ${formatPlaceList(places)} yet.`
                : null;
    const draftCache = useRef<Map<string, TailorDraft>>(new Map());
    const [applying, setApplying] = useState(false);
    const [proofLoading, setProofLoading] = useState(false);
    // A role Skip just removed: it stays on the stack one more beat to tip
    // back and fade (RoleStack), then goes.
    const [departing, setDeparting] = useState<PublicJob | null>(null);

    useEffect(() => {
        setProofLoading(readPacksProofLoading());
    }, []);

    const prewarmDraft = useCallback(
        async (job: PublicJob) => {
            if (!resume || draftCache.current.has(job.id)) return;
            const hydrated = hydratedJobs.get(job.id)?.job ?? job;
            const located = resumeForPackApply(resume);
            try {
                const draft = await tailorResumeForJob(located, jobToTailorInput(hydrated), {
                    allowModel: false,
                });
                draftCache.current.set(job.id, draft);
            } catch {
                // Best-effort pre-warm — apply path generates on demand.
            }
        },
        [resume, hydratedJobs],
    );

    useEffect(() => {
        if (activeJob) void prewarmDraft(activeJob);
        const next = visiblePacks[activeIndex + 1];
        if (next) void prewarmDraft(next);
    }, [activeJob, activeIndex, visiblePacks, prewarmDraft]);

    useEffect(() => {
        const job = visiblePacks[activeIndex];
        if (job) onActivePackChange(job.id);
        for (const index of prefetchIndexesAhead(activeIndex, visiblePacks.length, 3)) {
            onActivePackChange(visiblePacks[index].id);
        }
    }, [activeIndex, visiblePacks, onActivePackChange]);

    const exportPdfForJob = useCallback(
        async (job: PublicJob, data: ResumeData) => {
            const filename = deriveResumePdfFilename({
                company: job.company ?? null,
                role: job.title ?? data.profile.profession ?? null,
                fallbackLabel: data.profile.name || "resume",
                dateIso: new Date().toISOString(),
            });
            try {
                await exportZipResumePdfFromData(data, `${filename}.pdf`);
            } catch {
                toast.error("Failed to generate PDF");
                throw new Error("pdf failed");
            }
        },
        [],
    );

    const handleDownloadApply = useCallback(() => {
        if (!activeJob || !resume || applying) return;
        onOpenPosting(activeJob);
        onRoleSignal?.("apply");
        setApplying(true);
        void (async () => {
            try {
                const located = resumeForPackApply(resume);
                const hydrated = hydratedJobs.get(activeJob.id)?.job ?? activeJob;
                let draft = draftCache.current.get(activeJob.id);
                if (!draft) {
                    draft = await tailorResumeForJob(located, jobToTailorInput(hydrated), {
                        allowModel: false,
                    });
                    draftCache.current.set(activeJob.id, draft);
                }
                const tailored = hasMeaningfulDiff(draft) ? draft.tailored : located;
                await exportPdfForJob(activeJob, resumeForPackApply(tailored));
            } catch {
                // toast already shown for PDF failure
            } finally {
                setApplying(false);
            }
        })();
    }, [activeJob, resume, applying, hydratedJobs, exportPdfForJob, onOpenPosting, onRoleSignal]);

    // Rows render without a résumé. fitActive stays on the props type for
    // callers; it must not keep a non-empty pack on the ranking shell.
    const showLoading = deckListLoading({
        proofLoading,
        fitResolving,
        loading,
        packCount: visiblePacks.length,
    });
    const canNavigate = !showLoading && visiblePacks.length > 0;

    useEffect(() => {
        if (!firstRevealDeckFocus || showLoading || visiblePacks.length === 0) return;
        const id = window.requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>('[data-testid="for-you-download-apply"]');
            el?.focus({ preventScroll: true });
            onFirstRevealFocusDone?.();
        });
        return () => window.cancelAnimationFrame(id);
    }, [firstRevealDeckFocus, showLoading, visiblePacks.length, onFirstRevealFocusDone]);

    const selectedIndex =
        activeIndex >= 0 && activeIndex < visiblePacks.length ? activeIndex : 0;
    const selectedJob = visiblePacks[selectedIndex] ?? activeJob;
    const selectedJobId = selectedJob?.id;

    // The résumé place question above the pack, or a screen too short for the
    // stack's floor, can leave the bottom of the stack (and its actions) under
    // the fold. When the pack's roles arrive, scroll just far enough to show
    // the whole stack, never so far that it slides under the header row (which
    // stays stuck under the top bar). A page left scrolled past the stack (the
    // hub was scrolled down to its chips, and the shorter pack page clamps
    // there) scrolls back up to that row. What sits above keeps growing for a
    // moment (filter counts, the résumé band), and the router may reset the
    // scroll after the first fit, so refit on every resize and scroll while
    // the page settles, until the visitor scrolls or touches anything.
    // Keyed on having roles, not on how many, so stepping or Skip never
    // refits. A pack opened after another first shows the old list for a
    // moment, which empties before its own roles arrive: those start a fresh fit.
    const controlsRef = useRef<HTMLDivElement>(null);
    const hasRoles = visiblePacks.length > 0;
    useEffect(() => {
        if (!hasRoles) return;
        let settled = false;
        const settle = () => {
            settled = true;
        };
        const fit = () => {
            const controls = controlsRef.current;
            const stage = document.querySelector<HTMLElement>('[data-testid="role-stack"]');
            if (settled || !controls || !stage) return;
            const topbar = parseFloat(getComputedStyle(stage).getPropertyValue("--topbar-h")) || 0;
            // The phone tab bar covers the bottom of the screen (its height
            // var lives on body and grows by the safe area), so measure it.
            const tabbar = document.querySelector("[data-mobile-tabbar]");
            const floor = tabbar?.getClientRects().length ? tabbar.getBoundingClientRect().top : window.innerHeight;
            const below = stage.getBoundingClientRect().bottom + 8 - floor;
            // As far as the stack can rise before it meets the header row, which
            // sticks under the top bar (anything between them scrolls away).
            // Negative when the page sits past the stack: scroll back up.
            const room = stage.getBoundingClientRect().top - topbar - controls.offsetHeight - 4;
            const by = room < 0 ? room : Math.min(Math.max(below, 0), room);
            if (Math.abs(by) > 1) window.scrollBy({ top: by, behavior: "instant" });
        };
        const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
        for (const type of inputs) window.addEventListener(type, settle, { passive: true });
        window.addEventListener("scroll", fit, { passive: true });
        const main = document.getElementById("main");
        const observer = new ResizeObserver(fit);
        if (main) observer.observe(main);
        const home = document.querySelector('[data-testid="for-you-home"]');
        if (home) observer.observe(home);
        const frame = window.requestAnimationFrame(fit);
        const stop = window.setTimeout(settle, 5000);
        return () => {
            for (const type of inputs) window.removeEventListener(type, settle);
            window.removeEventListener("scroll", fit);
            observer.disconnect();
            window.cancelAnimationFrame(frame);
            window.clearTimeout(stop);
        };
    }, [hasRoles]);

    // A control focused on the open card loses focus when the card moves back
    // (it goes inert); carry it to the card that comes forward.
    const carryFocus = useRef<string | null>(null);
    useEffect(() => {
        const testId = carryFocus.current;
        carryFocus.current = null;
        if (testId) restoreStackFocus(testId);
    }, [selectedJobId]);

    // Next, Previous, the arrow keys and a swipe all land here: a role the
    // visitor stepped to counts as viewed. The first card and the one Skip
    // brings forward arrive on their own and are not recorded.
    const goTo = useCallback(
        (index: number) => {
            const next = clampDeckIndex(index, visiblePacks.length);
            if (next === selectedIndex) return;
            carryFocus.current = focusedStackControl();
            onActiveIndexChange(next);
            const job = visiblePacks[next];
            if (job) onOpenRow?.(job);
        },
        [visiblePacks, selectedIndex, onActiveIndexChange, onOpenRow],
    );

    // Skip removes the open role from the list. Keep it on the stack long
    // enough to tip back under the role that replaces it (RoleStack).
    const skipActive = useCallback(() => {
        const job = visiblePacks[clampDeckIndex(activeIndex, visiblePacks.length)];
        if (job) setDeparting(job);
        carryFocus.current = focusedStackControl();
        onSkip();
    }, [visiblePacks, activeIndex, onSkip]);

    useEffect(() => {
        if (!departing) return;
        const id = window.setTimeout(() => setDeparting(null), MOTION_DURATION_MS.stack + 100);
        return () => window.clearTimeout(id);
    }, [departing]);

    // "Fewer like this" leaves the same way Skip does.
    const fewerActive = useCallback(() => {
        const job = visiblePacks[clampDeckIndex(activeIndex, visiblePacks.length)];
        if (job) setDeparting(job);
        carryFocus.current = focusedStackControl();
        onFewerLikeThis?.();
    }, [visiblePacks, activeIndex, onFewerLikeThis]);

    // Reading one role for a while is a quiet "more like this". Counted once
    // per role, and only while the page is in front.
    const dwellJobId = showLoading ? null : selectedJobId;
    const roleSignalRef = useRef(onRoleSignal);
    roleSignalRef.current = onRoleSignal;
    useEffect(() => {
        if (!dwellJobId) return;
        let elapsed = 0;
        const id = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            elapsed += 1;
            if (elapsed < DWELL_SECONDS) return;
            window.clearInterval(id);
            roleSignalRef.current?.("dwell");
        }, 1000);
        return () => window.clearInterval(id);
    }, [dwellJobId]);

    const shortcutStateRef = useRef({ selectedIndex, canNavigate, applying, goTo, skipActive });
    shortcutStateRef.current = { selectedIndex, canNavigate, applying, goTo, skipActive };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const { selectedIndex, canNavigate, applying, goTo, skipActive } = shortcutStateRef.current;
            if (!canNavigate) return;
            const action = resolveDeckShortcut({
                key: event.key,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
                defaultPrevented: event.defaultPrevented,
                target: event.target,
            });
            if (action === "previous") {
                goTo(selectedIndex - 1);
            } else if (action === "next") {
                goTo(selectedIndex + 1);
            } else if (action === "skip" && !applying) {
                skipActive();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    const showingLine = formatDeckShowingLine(visiblePacks.length, resultTotal);
    // The pack's own count: what applying these filters returns, not the size of the deck on screen.
    // The pack's location is where the candidate can work, so a search that dropped it counts 0.
    const [packTotal, setPackTotal] = useState<number | null>(null);
    const packKey = filters ? serializeJobsUrl(filters) : null;
    useEffect(() => {
        if (!filters) return;
        let live = true;
        setPackTotal(null);
        void countResults(filters, searchJobsAction, { locationRequired: true }).then((total) => {
            if (live) setPackTotal(total);
        });
        return () => {
            live = false;
        };
        // `packKey` is the identity of `filters`; `searchJobsAction` is a stable action.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [packKey]);
    useEffect(() => {
        if (visiblePacks.length === 0) return;
        if (activeIndex < 0 || activeIndex >= visiblePacks.length) onActiveIndexChange(0);
    }, [activeIndex, visiblePacks.length, onActiveIndexChange]);

    const packLabel = HUB_PACK_SHORT_LABELS[tileId ?? "all"];
    const lastIndex = visiblePacks.length - 1;
    const atEnd = selectedIndex >= lastIndex;
    const upNext = atEnd ? null : visiblePacks[selectedIndex + 1];

    const renderCard = (job: PublicJob, active: boolean) => {
        const hydration = resolveDescriptionHydration(job, hydratedJobs.get(job.id));
        return (
            <StackedRoleCard
                job={hydration.job}
                active={active}
                nowMs={nowMs}
                matchScore={matchScores?.get(job.id) ?? null}
                resume={resume}
                descriptionPending={hydration.descriptionPending}
                onRetryDescription={onRetryDescription ? () => onRetryDescription(job.id) : undefined}
                onOpenPosting={() => {
                    onOpenPosting(hydration.job);
                    if (active) onRoleSignal?.("open");
                }}
                actions={cardActions(hydration.job, active)}
                tuning={
                    onMoreLikeThis && onFewerLikeThis ? (
                        <RoleTuningButtons
                            active={active}
                            liked={likedIds?.has(job.id) ?? false}
                            disabled={applying}
                            onMore={onMoreLikeThis}
                            onFewer={fewerActive}
                        />
                    ) : null
                }
            />
        );
    };

    // Every card carries the same actions so a card sliding in never changes
    // height. Only the open role's are wired and carry test ids; the rest are
    // look-alikes on inert cards (RoleStack). Their Save shows unsaved because
    // the page only knows the open role's pursuit.
    const cardActions = (job: PublicJob, active: boolean) => (
        <div className="role-card-actions flex flex-col gap-2">
            {!resume && onReplaceResume ? (
                <div className="role-card-note space-y-2">
                    <p className="text-xs text-muted-foreground">{FOR_YOU_UPLOAD_PDF_EMPTY}</p>
                    <Button
                        type="button"
                        variant="outline"
                        data-testid={active ? "for-you-upload-resume" : undefined}
                        onClick={onReplaceResume}
                        className="inline-flex items-center gap-1.5"
                    >
                        <UploadSimple size={16} weight="bold" aria-hidden />
                        Upload résumé
                    </Button>
                </div>
            ) : null}
            <Button
                type="button"
                className="role-card-apply w-full"
                data-testid={active ? "for-you-download-apply" : undefined}
                onClick={active ? handleDownloadApply : undefined}
                disabled={applying || !resume}
            >
                {applying && active ? (
                    <>
                        <InlineSpinner size={16} className="mr-2" />
                        Preparing…
                    </>
                ) : (
                    FOR_YOU_DOWNLOAD_LABEL
                )}
            </Button>
            <div className="role-card-secondary flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    data-testid={active ? "for-you-skip" : undefined}
                    onClick={active ? skipActive : undefined}
                    disabled={applying}
                >
                    Skip
                </Button>
                {resume ? (
                    active ? (
                        <LocalCustomizePanel job={job} resume={resume} compactTrigger signedIn />
                    ) : (
                        <Button type="button" variant="outline" className="shrink-0 px-3" tabIndex={-1}>
                            Customize résumé
                        </Button>
                    )
                ) : null}
                {active ? (
                    <span data-testid="for-you-deck-save" className="shrink-0">
                        <RowBookmarkButton
                            pursuit={activePursuit}
                            onGoAfter={() => {
                                if (!activePursuit) onRoleSignal?.("save");
                                onGoAfter?.(job);
                            }}
                            successPulse={saveSuccessPulse}
                            className="rounded-ctl border border-border bg-surface"
                        />
                    </span>
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        size={jobActionIconSize}
                        tabIndex={-1}
                        aria-label="Save this job"
                        className="shrink-0 border border-border bg-surface text-muted-foreground"
                    >
                        <BookmarkSimple size={20} />
                    </Button>
                )}
            </div>
        </div>
    );

    // A thin pack's note and broaden options: above the stack, inside the
    // screen it fills, so they shorten the cards instead of pushing them down.
    const thinBlock =
        filters && !showLoading && packTotal != null && isThinResults(packTotal) ? (
            <div className="mb-3 shrink-0 space-y-3" data-testid="for-you-pack-filters">
                {packTotal > 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="for-you-thin-note">
                        Only {packTotal} {packTotal === 1 ? "role matches" : "roles match"} your filters.
                    </p>
                ) : null}
                <BroadenOptions
                    state={filters}
                    total={packTotal}
                    ctx={{ relocation: signals?.relocation.value, locationRequired: true }}
                    search={searchJobsAction}
                />
            </div>
        ) : null;
    const stackOpen = !showLoading && !noRolesThereTitle && hasRoles;

    return (
        <div
            className={cn(
                JOBS_SESSION_FRAME_CLASS,
                // clip, not hidden: a hidden box is a scroll container, and the
                // pack header's sticky would stick to it instead of the page.
                "state-opacity-in h-auto min-h-0 flex-1 overflow-clip",
            )}
            data-testid="for-you-home"
        >
            {/* One row above the stack (Vivek, 2026-09-30: the way back, Replace
                résumé, Edit filters and the position each took a row of their own,
                pushing the role down the screen). It names the pack, which nothing
                on the page did, and keeps every control the rows held. A phone
                keeps the way back, Edit filters and Previous / Next as icons;
                Replace résumé is the Résumé tab there. It sticks under the top bar,
                so whatever scrolls the page (a short screen, a card's scroll
                carrying on) never takes the way back or Next with it. */}
            <div
                ref={controlsRef}
                data-testid="for-you-pack-header"
                className="sticky top-[var(--topbar-h)] z-[var(--z-pack-header)] mb-1 flex min-h-10 shrink-0 items-center gap-2 bg-background sm:gap-3"
            >
                {onBackToPacks ? (
                    <button
                        type="button"
                        onClick={() => onBackToPacks()}
                        className="ctl-md ctl-button -ml-2 inline-flex shrink-0 items-center gap-1 px-2 text-brand hover:underline"
                        data-testid="jobs-back-to-packs"
                        aria-label="Back to Job Packs"
                        title="Back to Job Packs"
                    >
                        <ArrowLeft size={16} weight="bold" aria-hidden />
                        <span className="hidden sm:inline">Job Packs</span>
                    </button>
                ) : null}
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-foreground" title={packLabel}>
                        {packLabel}
                    </h2>
                    {canNavigate ? (
                        <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                            <span data-testid="for-you-deck-position" className="shrink-0 tabular-nums" aria-live="polite">
                                Role {selectedIndex + 1} of {visiblePacks.length}
                            </span>
                            <span className="hidden min-w-0 truncate lg:inline">
                                <span aria-hidden>· </span>
                                {upNext
                                    ? `Up next: ${upNext.title ?? "Untitled role"}${
                                          displayCompanyBrand(upNext.company, upNext.company_domain, upNext.title)
                                              ? `, ${displayCompanyBrand(upNext.company, upNext.company_domain, upNext.title)}`
                                              : ""
                                      }`
                                    : "That's the last role here."}
                            </span>
                        </p>
                    ) : null}
                </div>
                {filters && !showLoading ? (
                    <Link
                        href={jobsBoardHref(filters)}
                        data-testid="pack-edit-filters"
                        className={REPLACE_RESUME_CLASS}
                    >
                        Edit filters
                    </Link>
                ) : null}
                {hasUsableResume && onReplaceResume ? (
                    <button
                        type="button"
                        data-testid="jobs-replace-resume"
                        onClick={onReplaceResume}
                        className={cn(REPLACE_RESUME_CLASS, "hidden md:inline")}
                    >
                        Replace résumé
                    </button>
                ) : null}
                {canNavigate ? (
                    <div className="flex shrink-0 gap-1 sm:gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="for-you-previous"
                            onClick={() => goTo(selectedIndex - 1)}
                            disabled={selectedIndex === 0}
                            aria-label="Previous role"
                            className="px-2.5 sm:px-3"
                        >
                            <CaretLeft weight="bold" aria-hidden className="sm:hidden" />
                            <span className="hidden sm:inline">Previous</span>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="for-you-next"
                            onClick={() => goTo(selectedIndex + 1)}
                            disabled={atEnd}
                            aria-label="Next role"
                            className="px-2.5 sm:px-3"
                        >
                            <span className="hidden sm:inline">Next</span>
                            <CaretRight weight="bold" aria-hidden className="sm:hidden" />
                        </Button>
                    </div>
                ) : null}
            </div>

            {stackOpen ? null : thinBlock}

            {showLoading ? (
                <WaitState
                    data-testid="for-you-loading"
                    className="state-opacity-in"
                    label="Loading your ranked roles"
                    skeleton={<RoleCardSkeleton />}
                />
            ) : noRolesThereTitle ? (
                <ConceptAEmptyPageSlot placement="page" className="flex-1" data-testid="for-you-no-roles-there-wrap">
                    <ConceptAEmptyState
                        testId="for-you-no-roles-there"
                        title={noRolesThereTitle}
                        description="Edit filters or broaden the search to see roles elsewhere."
                    />
                </ConceptAEmptyPageSlot>
            ) : visiblePacks.length === 0 && loadError ? (
                <LoadFailedState
                    title="We can't load your matches right now."
                    detail={loadError}
                    onRetry={onRetryLoad}
                    testId="for-you-load-failed"
                />
            ) : visiblePacks.length === 0 ? (
                <ConceptAEmptyPageSlot placement="page" className="flex-1" data-testid="for-you-empty-wrap">
                    <ConceptAEmptyState
                        testId="for-you-empty"
                        title="No ranked roles to show right now."
                        description="Try Search to browse the full list—we'll keep your place here."
                        actions={
                            showSearchCta ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="for-you-empty-search-cta"
                                    onClick={() => onHomeViewChange("search")}
                                >
                                    Go to Search
                                </Button>
                            ) : undefined
                        }
                    />
                </ConceptAEmptyPageSlot>
            ) : (
                <>
                <div
                    data-testid="for-you-deck"
                    className={cn("flex min-h-0 flex-1 flex-col", firstRevealEnter && "state-opacity-in")}
                >
                    {/* The screen under the header row (globals.css .role-stack-screen),
                        not what the page leaves over: growing into the leftover kept the
                        footer and the AI note on the first screen and the role card short. */}
                    <div className="role-stack-screen">
                        {thinBlock}
                        {tuning ? (
                            <p className="mb-2 flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground" data-testid="deck-tuning">
                                <span className="min-w-0 truncate" aria-live="polite">
                                    {tuningLine(tuning)}
                                </span>
                                {onResetTuning ? (
                                    <button
                                        type="button"
                                        data-testid="deck-tuning-reset"
                                        onClick={onResetTuning}
                                        className={cn(REPLACE_RESUME_CLASS, "shrink-0")}
                                    >
                                        Reset
                                    </button>
                                ) : null}
                            </p>
                        ) : null}
                        <RoleStack
                            className="flex-1"
                            roles={visiblePacks}
                            activeIndex={selectedIndex}
                            departing={departing}
                            renderCard={renderCard}
                            onSwipe={(direction) => goTo(selectedIndex + (direction === "next" ? 1 : -1))}
                        />
                    </div>
                    {signupGate}
                    {!signupGate && atEnd && (showingLine || (hasMore && onLoadMore)) ? (
                        <div
                            className="flex shrink-0 flex-col items-center gap-2 pb-2"
                            data-testid="for-you-show-more-wrap"
                        >
                            {showingLine ? (
                                <p
                                    className="text-xs text-muted-foreground"
                                    data-testid="for-you-showing-total"
                                >
                                    {showingLine}
                                </p>
                            ) : null}
                            {hasMore && onLoadMore ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="for-you-show-more"
                                    onClick={() => void onLoadMore()}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? "Loading more…" : "Show more matches"}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                {selectedJob ? (
                    <McpHandoffNote
                        className="mt-3 shrink-0"
                        job={{
                            id: selectedJob.id,
                            title: selectedJob.title ?? "",
                            company: selectedJob.company ?? "",
                            location: selectedJob.location,
                        }}
                    />
                ) : null}
                </>
            )}
        </div>
    );
}

/** Neutral first-paint column while résumé presence is still unknown.
 *  Same frame as For you — never Search chrome. */
export function ForYouHomePending() {
    return (
        <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")} data-testid="for-you-home-pending">
            <JobsSessionLoadingShell />
        </div>
    );
}
