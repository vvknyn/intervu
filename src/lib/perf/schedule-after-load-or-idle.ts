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

export function requireAuthKitSoon(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(REQUIRE_AUTHKIT_EVENT));
}
