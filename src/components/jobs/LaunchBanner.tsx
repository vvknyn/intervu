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
            className="mb-2.5 grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3.5 gap-y-2 rounded-xl bg-card border border-border p-4 text-left border-l-4 border-l-brand transition-all"
        >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-brand font-semibold text-xs">
                AI
            </div>
            <div className="min-w-0 flex flex-col justify-center">
                <span className="text-xs font-semibold text-brand">
                    AI WORKFLOWS
                </span>
                <p className="mt-1 text-sm font-normal leading-relaxed text-foreground">
                    Search velai&apos;s verified corpus inside Claude, ChatGPT, or Cursor without tab-switching.
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                    <Link
                        href="/connect"
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted text-live px-3 py-1 text-xs font-semibold hover:underline"
                    >
                        Connect your AI
                    </Link>
                </div>
            </div>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss launch banner"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
                <X aria-hidden />
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
