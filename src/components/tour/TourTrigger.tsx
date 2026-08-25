"use client";

import { useEffect, useState } from "react";
import { useTour } from "@/hooks/use-tour";
import { Question, X, Play } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { tourSteps } from "./tour-steps";
import { visibleTourTarget } from "./TourProvider";

function getPageId(pathname: string): string {
  if (pathname === "/" || pathname === "") return "dashboard";
  const segment = pathname.replace(/^\//, "").split("/")[0];
  return segment || "dashboard";
}

export function TourTrigger() {
  const {
    isActive,
    isMinimized,
    currentStep,
    steps,
    startTour,
    stopTour,
    resume,
    hasSeenTour,
  } = useTour();

  const pathname = usePathname();
  const pageId = getPageId(pathname);
  const hasSeen = hasSeenTour(pageId);

  // Only show the button if the current page has tour targets in the DOM
  const [hasTargets, setHasTargets] = useState(false);

  useEffect(() => {
    const stepsForPage = tourSteps[pageId] || [];
    const found = stepsForPage.some((s) => visibleTourTarget(s.selector));
    setHasTargets(found);
  }, [pageId]);

  // When tour is active and not minimized, overlay handles everything
  if (isActive && !isMinimized) return null;

  // Minimized pill
  if (isActive && isMinimized) {
    return (
      <div className="fixed bottom-24 right-6 lg:bottom-6 z-[80] flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <button
          onClick={resume}
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-brand text-brand-foreground text-xs font-semibold shadow-lg hover:opacity-90 transition-opacity"
        >
          <Play size={12} weight="fill" />
          <span>
            Tour ({currentStep + 1}/{steps.length})
          </span>
        </button>
        <button
          onClick={stopTour}
          className="p-1.5 rounded-full bg-card text-muted-foreground shadow-lg border border-border hover:text-foreground transition-colors"
          aria-label="End tour"
        >
          <X size={12} weight="bold" />
        </button>
      </div>
    );
  }

  // /jobs uses its own quiet replay control on the filters row — the
  // floating pill collides with SIGN IN TO APPLY on mobile.
  if (pageId === "jobs") return null;

  // No tour targets on this page — don't render the button
  if (!hasTargets) return null;

  // Default floating button — small and subtle. Sits above the mobile tab bar
  // (bottom ~7rem) and clear of the footer on desktop (bottom-6), honoring the
  // iOS safe-area inset so it never collides with footer text.
  return (
    <button
      onClick={() => startTour()}
      className="fixed right-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-[80] flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/80 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 lg:bottom-6"
      aria-label="Take a tour"
    >
      <Question size={14} weight="bold" />
      <span className="tracking-wide">Take a tour</span>
      {!hasSeen && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-brand opacity-60 motion-safe:animate-ping" />
      )}
    </button>
  );
}
