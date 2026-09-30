"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import {
    landingNoticeFor,
    searchWithoutParam,
    type LandingNotice as Notice,
    type LandingSurface,
} from "@/lib/landing-notice";

/** How long a confirmation stays up; an error stays until dismissed. */
const SUCCESS_MS = 10_000;

const subscribeNothing = () => () => {};

/**
 * Says whether an emailed confirmation link worked, on the page it landed on
 * (see `landingNoticeFor`). Looks like a toast, but renders itself from
 * mount: the app's Toaster loads after idle, which can be later than a timed
 * toast fired on arrival would last.
 *
 * The flag comes off the URL as soon as it's read, so a reload or a shared
 * link doesn't say it again.
 */
export function LandingNotice({ surface }: { surface: LandingSurface }) {
    // Server HTML and the hydration pass render nothing; the URL is only
    // read in the browser, and the notice shows on the pass right after.
    const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
    const [notice] = useState<Notice | null>(() =>
        typeof window === "undefined" ? null : landingNoticeFor(surface, new URLSearchParams(window.location.search)),
    );
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!notice) return;
        window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${searchWithoutParam(window.location.search, notice.param)}${window.location.hash}`,
        );
    }, [notice]);

    useEffect(() => {
        if (notice?.tone !== "success") return;
        const timer = window.setTimeout(() => setDismissed(true), SUCCESS_MS);
        return () => window.clearTimeout(timer);
    }, [notice]);

    if (!hydrated || !notice || dismissed) return null;
    const isError = notice.tone === "error";

    return (
        <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+1rem)] z-[var(--z-toast)] flex flex-col items-end lg:inset-x-auto lg:bottom-4 lg:right-4">
            <div
                role={isError ? "alert" : "status"}
                aria-live={isError ? "assertive" : "polite"}
                data-testid="landing-notice"
                data-tone={notice.tone}
                className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-none border bg-background px-4 py-3 text-sm enter-reveal ${isError ? "border-danger-text" : "border-live"}`}
            >
                {isError ? (
                    <WarningCircle weight="fill" className="text-danger-text shrink-0" />
                ) : (
                    <CheckCircle weight="fill" className="text-live shrink-0" />
                )}
                <span className="flex-1 leading-snug text-foreground">{notice.text}</span>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="designed-focus shrink-0 rounded-ctl text-muted-foreground transition-colors hover:text-foreground focus-visible:border-foreground"
                    aria-label="Dismiss"
                >
                    <X weight="bold" />
                </button>
            </div>
        </div>
    );
}
