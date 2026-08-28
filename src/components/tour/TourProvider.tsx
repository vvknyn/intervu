"use client";

import {
  createContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { tourSteps, type TourStep } from "./tour-steps";
import { rectsEqual } from "./tour-target-rect";
import {
  markTourSeen,
  clearTourMinimized,
  writeTourMinimized,
  hasSeenTourId,
  readTourStorage,
} from "./tour-storage";

interface TourState {
  isActive: boolean;
  isMinimized: boolean;
  currentStep: number;
  pageId: string;
  steps: TourStep[];
  targetRect: DOMRect | null;
}

interface TourContextValue extends TourState {
  startTour: (tourId?: string) => void;
  stopTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  minimize: () => void;
  resume: () => void;
  hasSeenTour: (pageId: string) => boolean;
}

export const TourContext = createContext<TourContextValue | null>(null);

function getPageId(pathname: string): string {
  if (pathname === "/" || pathname === "") return "dashboard";
  const segment = pathname.replace(/^\//, "").split("/")[0];
  return segment || "dashboard";
}

function tourBelongsOnPage(tourId: string, pathname: string): boolean {
  const pageId = getPageId(pathname);
  return pageId === tourId || tourId.startsWith(`${pageId}-`);
}

/** Steps for a tour whose target is currently visible in the DOM (no fallback). */
export function visibleStepsForTour(tourId: string): TourStep[] {
  const catalog = tourSteps[tourId] || [];
  return catalog.filter((step) => !!visibleTourTarget(step.selector));
}

function stepsForTour(tourId: string): TourStep[] {
  const available = visibleStepsForTour(tourId);
  return available.length > 0 ? available : tourSteps[tourId] || [];
}

/** First DOM match that is actually visible — skips hidden lg-only nav duplicates. */
export function visibleTourTarget(selector: string): Element | null {
  if (typeof document === "undefined") return null;
  for (const el of document.querySelectorAll(selector)) {
    if (!(el instanceof Element)) continue;
    const visible = el.checkVisibility?.() ?? el.getClientRects().length > 0;
    if (visible) return el;
  }
  return null;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pageId = getPageId(pathname);

  const [state, setState] = useState<TourState>({
    isActive: false,
    isMinimized: false,
    currentStep: 0,
    pageId,
    steps: [],
    targetRect: null,
  });

  const rafRef = useRef<number>(0);

  // Track target element rect
  const updateRect = useCallback(() => {
    setState((prev) => {
      if (!prev.isActive || prev.isMinimized || prev.steps.length === 0)
        return prev;
      const step = prev.steps[prev.currentStep];
      if (!step) return prev;
      const el = visibleTourTarget(step.selector);
      if (!el) return prev;
      const rect = el.getBoundingClientRect();
      if (rectsEqual(prev.targetRect, rect)) return prev;
      return { ...prev, targetRect: rect };
    });
  }, []);

  // Sample live target rect every frame while tour is visible
  useEffect(() => {
    if (!state.isActive || state.isMinimized) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      updateRect();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [state.isActive, state.isMinimized, updateRect]);

  // Restore minimized tour for this page after reload or return navigation
  useEffect(() => {
    const stored = readTourStorage().minimized;
    if (!stored || !tourSteps[stored.tourId]) return;
    if (!tourBelongsOnPage(stored.tourId, pathname)) return;

    const steps = stepsForTour(stored.tourId);
    if (steps.length === 0) return;

    setState((prev) => {
      if (prev.isActive && !prev.isMinimized) return prev;
      if (
        prev.isActive &&
        prev.isMinimized &&
        prev.pageId === stored.tourId
      ) {
        return prev;
      }
      return {
        isActive: true,
        isMinimized: true,
        currentStep: Math.min(stored.step, steps.length - 1),
        pageId: stored.tourId,
        steps,
        targetRect: null,
      };
    });
  }, [pathname]);

  // Auto-stop on route change
  useEffect(() => {
    setState((prev) => {
      if (!prev.isActive) return prev;
      if (tourBelongsOnPage(prev.pageId, pathname)) return prev;
      return {
        ...prev,
        isActive: false,
        isMinimized: false,
        currentStep: 0,
        steps: [],
        targetRect: null,
        pageId,
      };
    });
  }, [pageId, pathname]);

  // Scroll into view and update rect when step changes
  useEffect(() => {
    if (!state.isActive || state.isMinimized || state.steps.length === 0)
      return;
    const step = state.steps[state.currentStep];
    if (!step) return;

    const el = visibleTourTarget(step.selector);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state.currentStep, state.isActive, state.isMinimized, state.steps]);

  const minimizeTour = useCallback(() => {
    setState((prev) => {
      if (!prev.isActive) return prev;
      writeTourMinimized(prev.pageId, prev.currentStep);
      return { ...prev, isMinimized: true, targetRect: null };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!state.isActive) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        minimizeTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setState((prev) => {
          if (prev.currentStep >= prev.steps.length - 1) return prev;
          return { ...prev, currentStep: prev.currentStep + 1 };
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setState((prev) => {
          if (prev.currentStep <= 0) return prev;
          return { ...prev, currentStep: prev.currentStep - 1 };
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.isActive, minimizeTour]);

  const startTour = useCallback(
    (tourId?: string) => {
      clearTourMinimized();
      const effectivePageId = tourId ?? pageId;
      const steps = stepsForTour(effectivePageId);

      if (steps.length === 0) return;

      setState({
        isActive: true,
        isMinimized: false,
        currentStep: 0,
        pageId: effectivePageId,
        steps,
        targetRect: null,
      });
    },
    [pageId],
  );

  const stopTour = useCallback(() => {
    setState((prev) => {
      markTourSeen(prev.pageId);
      clearTourMinimized();
      return {
        ...prev,
        isActive: false,
        isMinimized: false,
        currentStep: 0,
        steps: [],
        targetRect: null,
      };
    });
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => {
      if (prev.currentStep >= prev.steps.length - 1) {
        markTourSeen(prev.pageId);
        clearTourMinimized();
        return {
          ...prev,
          isActive: false,
          isMinimized: false,
          currentStep: 0,
          steps: [],
          targetRect: null,
        };
      }
      return { ...prev, currentStep: prev.currentStep + 1 };
    });
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => {
      if (prev.currentStep <= 0) return prev;
      return { ...prev, currentStep: prev.currentStep - 1 };
    });
  }, []);

  const resumeTour = useCallback(() => {
    clearTourMinimized();
    setState((prev) => ({ ...prev, isMinimized: false }));
  }, []);

  const hasSeenTour = useCallback((pid: string) => {
    return hasSeenTourId(pid);
  }, []);

  return (
    <TourContext.Provider
      value={{
        ...state,
        startTour,
        stopTour,
        nextStep,
        prevStep,
        minimize: minimizeTour,
        resume: resumeTour,
        hasSeenTour,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}
