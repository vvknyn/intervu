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

export const REQUIRE_AUTHKIT_EVENT = "velai-require-authkit";

/**
 * /jobs holds AuthKit's idle mount until its first list is on screen. The
 * provider's session check is a server action, and server actions run one
 * at a time, so mounting it first queues the search behind it (measured on
 * a throttled phone profile: up to ~180 ms before the first row). Nothing on
 * the page reads AuthKit's context (see DeferredAuthKitProvider), so waiting
 * costs nothing. `requireAuthKitSoon` lifts the hold.
 */
let authKitHeld = false;

export function holdAuthKitUntilRequired(): void {
    authKitHeld = true;
}

export function isAuthKitHeld(): boolean {
    return authKitHeld;
}

export function requireAuthKitSoon(): void {
    authKitHeld = false;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(REQUIRE_AUTHKIT_EVENT));
}
