/** Run once after window load, then requestIdleCallback (with timeout fallback). */
export function scheduleAfterLoadOrIdle(run: () => void, options?: { timeout?: number }): () => void {
    const timeout = options?.timeout ?? 6000;
    let cancelled = false;
    let ran = false;

    const invoke = () => {
        if (cancelled || ran) return;
        ran = true;
        run();
    };

    const afterLoad = () => {
        if (typeof requestIdleCallback !== "undefined") {
            const id = requestIdleCallback(invoke, { timeout });
            return () => cancelIdleCallback(id);
        }
        const t = window.setTimeout(invoke, 1);
        return () => window.clearTimeout(t);
    };

    let cancelInner: (() => void) | undefined;

    if (typeof window !== "undefined" && document.readyState === "complete") {
        cancelInner = afterLoad();
    } else if (typeof window !== "undefined") {
        const onLoad = () => {
            cancelInner = afterLoad();
        };
        window.addEventListener("load", onLoad, { once: true });
        return () => {
            cancelled = true;
            window.removeEventListener("load", onLoad);
            cancelInner?.();
        };
    }

    return () => {
        cancelled = true;
        cancelInner?.();
    };
}

export const FIRST_LIST_RELEASED_EVENT = "velai-first-list-released";

/**
 * /jobs holds the deferred providers' idle mounts (AuthKit, PostHog) until
 * its first list is on screen. AuthKit's session check is a server action,
 * and server actions run one at a time, so mounting it first queued the
 * search behind it while the search was an action too (measured on a
 * throttled phone profile: up to ~180 ms before the first row; the search
 * goes over fetch since 2026-10-01, see app/api/jobs/search). PostHog is ~240 KB of JS whose download and parse
 * landed while the list's own code was starting. Nothing on the page reads
 * either provider's context, and events wait for PostHog in events.ts's
 * hold, so waiting costs nothing. `releaseFirstListHold` lifts the hold.
 */
let firstListHold = false;

export function holdDeferredLoadsUntilFirstList(): void {
    firstListHold = true;
}

export function isFirstListHoldActive(): boolean {
    return firstListHold;
}

export function releaseFirstListHold(): void {
    firstListHold = false;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(FIRST_LIST_RELEASED_EVENT));
}

/**
 * The deferred-provider mount rule: after load and idle, unless /jobs holds
 * it for its first list, in which case as soon as the hold is lifted.
 * Returns a cleanup.
 */
export function scheduleDeferredProviderMount(mount: () => void, options?: { timeout?: number }): () => void {
    window.addEventListener(FIRST_LIST_RELEASED_EVENT, mount);
    const cancelIdle = scheduleAfterLoadOrIdle(() => {
        if (!isFirstListHoldActive()) mount();
    }, options);
    return () => {
        window.removeEventListener(FIRST_LIST_RELEASED_EVENT, mount);
        cancelIdle();
    };
}
