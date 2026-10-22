"use client";

import { useSyncExternalStore } from "react";
import { ArrowSquareOut, FileText, ListChecks, ShieldCheck, Target, X, type Icon } from "@phosphor-icons/react";
import { BrandMark, HEADER_MARK_SRC } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import {
    CHROME_EXTENSION_LEAD,
    CHROME_EXTENSION_NAME,
    CHROME_EXTENSION_POINTS,
    CHROME_EXTENSION_STORE_URL,
    type ExtensionPointId,
} from "@/lib/brand/extension-store";
import { cn } from "@/lib/utils";

const POINT_ICON: Record<ExtensionPointId, Icon> = {
    fit: Target,
    posting: ShieldCheck,
    resume: FileText,
    apply: ListChecks,
};

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

/** The list-slot version: one dismissible row. */
function ExtensionBand({ className }: { className?: string }) {
    const dismissed = useSyncExternalStore(subscribeBand, readBandDismissed, () => true);
    if (dismissed) return null;
    return (
        <section
            aria-label={CHROME_EXTENSION_NAME}
            data-testid="extension-tile"
            data-variant="band"
            className={cn(
                "surface-paper flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-border bg-surface-postcard px-3 py-2 text-surface-postcard-foreground",
                className,
            )}
        >
            <BrandMark src={HEADER_MARK_SRC} className="h-6 w-6 shrink-0" pixelSize={24} />
            <p className="min-w-[14rem] flex-1 text-sm">{CHROME_EXTENSION_NAME} checks the role before you apply</p>
            <Button asChild size="sm" className="shrink-0">
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

/**
 * The Velai Chrome extension, as a tile in the packs hub's own style (cream paper, navy ink): what it does on a job
 * page in four short lines, and one way in, the Chrome Web Store. A page cannot tell whether the extension is
 * installed (it has no content script on velai.app), so the action is always "Add to Chrome", never "Open".
 */
export function ExtensionTile({ className, variant = "front-door" }: { className?: string; variant?: "band" | "front-door" }) {
    if (variant === "band") return <ExtensionBand className={className} />;
    return (
        <section
            aria-label={CHROME_EXTENSION_NAME}
            data-testid="extension-tile"
            className={cn(
                "surface-paper @container flex flex-col gap-4 rounded-panel border border-border bg-surface-postcard p-4 text-surface-postcard-foreground @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-6",
                className,
            )}
        >
            <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-panel border border-border bg-background">
                    <BrandMark src={HEADER_MARK_SRC} className="h-7 w-7" pixelSize={28} />
                </span>
                <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <h3 className="text-base font-semibold leading-snug text-balance">{CHROME_EXTENSION_NAME}</h3>
                        <p className="text-xs text-muted-foreground">{CHROME_EXTENSION_LEAD}</p>
                    </div>
                    <ul className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-5 gap-y-1.5 text-xs text-muted-foreground" data-testid="extension-tile-points">
                        {CHROME_EXTENSION_POINTS.map((point) => {
                            const PointIcon = POINT_ICON[point.id];
                            return (
                                <li key={point.id} className="flex items-center gap-1.5" data-testid={`extension-tile-point-${point.id}`}>
                                    <PointIcon size={16} aria-hidden className="shrink-0 text-brand" />
                                    {point.text}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
            <Button asChild className="w-full shrink-0 whitespace-nowrap @2xl:w-auto">
                {ADD_TO_CHROME_LINK}
            </Button>
        </section>
    );
}
