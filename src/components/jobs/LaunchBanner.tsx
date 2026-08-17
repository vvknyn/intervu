"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "@phosphor-icons/react";
import { readLaunchBannerDismissed, writeLaunchBannerDismissed } from "@/lib/jobs/launch-banner";

/**
 * Static markup, split out from the visibility-gated wrapper below so it can
 * be render-tested (`renderToStaticMarkup`) without mounting React or
 * stubbing localStorage — same "pure decision, thin I/O" split the board's
 * other banners use (`resolveVisitBannerState` next to `BoardVisitBanner`).
 */
export function LaunchBannerContent({ onDismiss }: { onDismiss: () => void }) {
    return (
        <div
            data-testid="launch-banner"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-300/80 bg-emerald-50/80 px-4 py-3 shadow-2xs dark:border-emerald-800/80 dark:bg-emerald-950/60"
        >
            <p className="font-mono text-[12.5px] font-medium text-emerald-900 dark:text-emerald-200">
                Search intervu&apos;s verified jobs from inside Claude, ChatGPT, or Cursor — no tab-switching required.{" "}
                <Link href="/connect" className="font-semibold underline underline-offset-2 hover:no-underline">
                    Connect your AI
                </Link>
            </p>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss launch banner"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-800/70 transition-colors hover:bg-emerald-100 dark:text-emerald-300/70 dark:hover:bg-emerald-900"
            >
                <X size={16} aria-hidden />
            </button>
        </div>
    );
}

/**
 * Top-of-board banner routing visitors to `/connect` — the "search jobs
 * from inside your AI assistant" experience. Exists to bridge PH-style
 * headlines ("search jobs from inside Claude") against the board itself,
 * which otherwise gives no on-page hint that path exists.
 *
 * Starts hidden on both the server render and the initial client render
 * (same posture as `BoardVisitBanner`/`MotivationalBanner`) so there's
 * never a server/client markup mismatch, then flips visible post-mount if
 * the dismissal flag isn't set — a single insert, not a reserved-then-
 * collapsed slot, so it doesn't shift anything already on screen.
 */
export function LaunchBanner() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(!readLaunchBannerDismissed());
    }, []);

    if (!visible) return null;

    return (
        <LaunchBannerContent
            onDismiss={() => {
                writeLaunchBannerDismissed();
                setVisible(false);
            }}
        />
    );
}
