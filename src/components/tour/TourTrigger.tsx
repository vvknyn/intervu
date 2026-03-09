"use client";

import { useEffect, useState } from "react";
import { useTour } from "@/hooks/use-tour";
import { Question, X, Play } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { tourSteps } from "./tour-steps";

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
    const found = stepsForPage.some((s) => document.querySelector(s.selector));
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

  // No tour targets on this page — don't render the button
  if (!hasTargets) return null;

  // Default floating ? button — small and subtle
  return (
    <button
      onClick={startTour}
      className="fixed bottom-24 right-4 lg:bottom-4 z-[80] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-muted/80 text-muted-foreground backdrop-blur-sm border border-border/50 hover:bg-muted hover:text-foreground transition-all text-[10px] font-medium shadow-sm"
      aria-label="Start guided tour"
    >
      <Question size={14} weight="bold" />
      <span className="tracking-wide">i am legend</span>
      {!hasSeen && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand animate-ping opacity-60" />
      )}
    </button>
  );
}
