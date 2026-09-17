"use client";

import { useEffect, useState } from "react";
import { useTour } from "@/hooks/use-tour";
import { Question, X, Play } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { visibleStepsForTour } from "./TourProvider";
import { dismissTourThisSession, isTourDismissedThisSession } from "./tour-storage";

function getPageId(pathname: string): string {
  if (pathname === "/" || pathname === "") return "dashboard";
  const segment = pathname.replace(/^\//, "").split("/")[0];
  return segment || "dashboard";
}

export function TourTrigger() {
  const { isActive, isMinimized, currentStep, steps, startTour, stopTour, resume, hasSeenTour } = useTour();

  const pathname = usePathname();
  const pageId = getPageId(pathname);
  const hasSeen = hasSeenTour(pageId);

  // A 1-step "tour" isn't a tour — only offer it once at least 2 of its
  // steps have a visible target in the current DOM.
  const [tourAvailable, setTourAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setTourAvailable(visibleStepsForTour(pageId).length >= 2);
    setDismissed(isTourDismissedThisSession(pageId));
  }, [pageId]);

  // Overlay handles everything while the tour is active and expanded.
  if (isActive && !isMinimized) return null;

  const minimizedTour = isActive && isMinimized;

  // /jobs uses its own quiet replay control on the filters row — the
  // floating pill collides with SIGN IN TO APPLY on mobile. Only the idle
  // offer is suppressed here; a minimized in-progress tour still resumes.
  if (!minimizedTour && pageId === "jobs") return null;
  if (!minimizedTour && (!tourAvailable || dismissed)) return null;

  const label = minimizedTour ? `Tour (${currentStep + 1}/${steps.length})` : "Tour";

  const handlePillClick = () => {
    if (minimizedTour) resume();
    else startTour();
  };

  const handleDismiss = () => {
    if (minimizedTour) {
      stopTour();
      return;
    }
    // Session-only: the permanent seen-state (`markTourSeen`) is reserved
    // for actually completing/stopping a tour, not for waving off the offer.
    dismissTourThisSession(pageId);
    setDismissed(true);
  };

  return (
    // Single dismissible-chip control: one pill, an inline ✕ hit-area.
    // Sits above the mobile bottom tab bar (its real height token, not a
    // guessed offset) and clear of the footer on desktop.
    <div
      className={cn(
        "fixed right-4 z-[80] flex items-center gap-0.5 rounded-none pl-2.5 pr-1 py-1 text-xs transition-all outline-none animate-in fade-in slide-in-from-bottom-2 duration-200",
        // design-lint-allow: composes the existing --mobile-tabbar-h token
        // with env(safe-area-inset-bottom) — not a literal.
        "bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+1rem)] lg:right-6 lg:bottom-6",
        minimizedTour
          ? "bg-brand text-brand-foreground"
          : "border border-border bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={handlePillClick}
        className="flex items-center gap-1.5 rounded-none py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {minimizedTour ? <Play weight="fill" /> : <Question weight="bold" />}
        <span className="">{label}</span>
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={minimizedTour ? "End tour" : "Dismiss tour"}
        className={cn(
          "relative rounded-none p-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
          minimizedTour ? "text-brand-foreground hover:text-brand-foreground" : "hover:text-foreground",
        )}
      >
        <X weight="bold" />
        {!minimizedTour && !hasSeen && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-none bg-brand opacity-60 motion-safe:animate-ping" />
        )}
      </button>
    </div>
  );
}
