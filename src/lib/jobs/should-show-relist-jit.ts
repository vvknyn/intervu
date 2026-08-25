export type ExceptionJitKind = "both" | "stale" | "relisted";

export type ExceptionJitInput = {
    mainTourActive: boolean;
    /** First-visit jobs tour already finished or skipped — JIT must not steal that overlay. */
    hasSeenMainTour: boolean;
    /** Any jobs-* exception JIT tour (relist / stale / both) is on screen. */
    exceptionTourActive: boolean;
    hasSeenBoth: boolean;
    hasSeenStale: boolean;
    hasSeenRelist: boolean;
    bothInDom: boolean;
    staleInDom: boolean;
    relistInDom: boolean;
    /** Job results list is on screen — not the mobile field directory alone. */
    listingsVisible: boolean;
};

/** Pick which one-step exception coachmark to auto-start, if any. Precedence: both > stale > relisted. */
export function pickExceptionJit({
    mainTourActive,
    hasSeenMainTour,
    exceptionTourActive,
    hasSeenBoth,
    hasSeenStale,
    hasSeenRelist,
    bothInDom,
    staleInDom,
    relistInDom,
    listingsVisible,
}: ExceptionJitInput): ExceptionJitKind | null {
    if (!hasSeenMainTour || mainTourActive || exceptionTourActive || !listingsVisible) return null;
    if (bothInDom && !hasSeenBoth) return "both";
    if (staleInDom && !hasSeenStale) return "stale";
    if (relistInDom && !hasSeenRelist) return "relisted";
    return null;
}

export type RelistJitInput = {
    mainTourActive: boolean;
    hasSeenMainTour: boolean;
    hasSeenRelist: boolean;
    relistInDom: boolean;
    listingsVisible: boolean;
};

/** Thin wrapper — relist-only gate for callers/tests that haven't moved to `pickExceptionJit`. */
export function shouldShowRelistJit(input: RelistJitInput): boolean {
    return pickExceptionJit({
        ...input,
        exceptionTourActive: false,
        hasSeenBoth: true,
        hasSeenStale: true,
        bothInDom: false,
        staleInDom: false,
    }) === "relisted";
}
