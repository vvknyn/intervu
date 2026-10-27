"use client";

import { useSyncExternalStore } from "react";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { BrandMark, HEADER_MARK_SRC } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import {
    CHROME_EXTENSION_NAME,
    CHROME_EXTENSION_STORE_URL,
} from "@/lib/brand/extension-store";
import { cn } from "@/lib/utils";

export const EXTENSION_BAND_DISMISSED_KEY = "velai.jobs.extensionBandDismissed";

const ADD_TO_CHROME_LINK = (
    <a
        href={CHROME_EXTENSION_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="extension-tile-link"
        aria-label="Add to Chrome, opens the Chrome Web Store"
    >
        Add to Chrome
        <ArrowSquareOut size={16} aria-hidden />
    </a>
);

let bandDismissedThisVisit = false;
const bandListeners = new Set<() => void>();
const subscribeBand = (cb: () => void) => {
    bandListeners.add(cb);
    return () => void bandListeners.delete(cb);
};
/** Dismissal is a per-browser convenience, so absent or throwing storage reads as "not dismissed". */
function readBandDismissed(): boolean {
    if (bandDismissedThisVisit) return true;
    try {
        return localStorage.getItem(EXTENSION_BAND_DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

/**
 * The Velai Chrome extension as one dismissible row in the list slot: what it does, and one way in, the Chrome Web
 * Store. A page cannot tell whether the extension is installed (it has no content script on velai.app), so the action
 * is always "Add to Chrome", never "Open".
 */
export function ExtensionTile({ className }: { className?: string }) {
    const dismissed = useSyncExternalStore(subscribeBand, readBandDismissed, () => true);
    if (dismissed) return null;
    return (
        <section
            aria-label={CHROME_EXTENSION_NAME}
            data-testid="extension-tile"
            data-variant="band"
            className={cn(
                "surface-paper flex items-center gap-2.5 rounded-panel border border-border bg-surface-postcard px-3 py-2 text-surface-postcard-foreground",
                className,
            )}
        >
            <BrandMark src={HEADER_MARK_SRC} className="h-5 w-5 shrink-0" pixelSize={20} />
            <p className="min-w-0 flex-1 truncate text-xs">{CHROME_EXTENSION_NAME} checks postings before you apply</p>
            <Button asChild variant="secondary" size="sm" className="shrink-0">
                {ADD_TO_CHROME_LINK}
            </Button>
            <button
                type="button"
                aria-label="Dismiss"
                onClick={() => {
                    try {
                        localStorage.setItem(EXTENSION_BAND_DISMISSED_KEY, "1");
                    } catch {
                        // Private mode or quota: it returns next visit.
                    }
                    bandDismissedThisVisit = true;
                    bandListeners.forEach((cb) => cb());
                }}
                className="ctl-md ctl-button ctl-square inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <X size={16} weight="bold" aria-hidden />
            </button>
        </section>
    );
}
