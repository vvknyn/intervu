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

const STORAGE_KEY = "intervu-tour-state";

function getPageId(pathname: string): string {
  if (pathname === "/" || pathname === "") return "dashboard";
  const segment = pathname.replace(/^\//, "").split("/")[0];
  return segment || "dashboard";
}

function getSeenPages(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markPageSeen(pageId: string) {
  try {
    const seen = getSeenPages();
    seen[pageId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // storage full or blocked
  }
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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Track target element rect
  const updateRect = useCallback(() => {
    setState((prev) => {
      if (!prev.isActive || prev.isMinimized || prev.steps.length === 0)
        return prev;
      const step = prev.steps[prev.currentStep];
      if (!step) return prev;
      const el = document.querySelector(step.selector);
      if (!el) return prev;
      const rect = el.getBoundingClientRect();
      // Only update if rect actually changed
      if (
        prev.targetRect &&
        prev.targetRect.x === rect.x &&
        prev.targetRect.y === rect.y &&
        prev.targetRect.width === rect.width &&
        prev.targetRect.height === rect.height
      ) {
        return prev;
      }
      return { ...prev, targetRect: rect };
    });
  }, []);

  // Set up scroll/resize tracking
  useEffect(() => {
    if (!state.isActive || state.isMinimized) return;

    const onUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateRect);
    };

    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);

    // Also observe target element resizes
    const step = state.steps[state.currentStep];
    if (step) {
      const el = document.querySelector(step.selector);
      if (el) {
        resizeObserverRef.current = new ResizeObserver(onUpdate);
        resizeObserverRef.current.observe(el);
      }
    }

    return () => {
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
      cancelAnimationFrame(rafRef.current);
      resizeObserverRef.current?.disconnect();
    };
  }, [state.isActive, state.isMinimized, state.currentStep, state.steps, updateRect]);

  // Auto-stop on route change
  useEffect(() => {
    setState((prev) => {
      if (!prev.isActive) return prev;
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
  }, [pageId]);

  // Scroll into view and update rect when step changes
  useEffect(() => {
    if (!state.isActive || state.isMinimized || state.steps.length === 0)
      return;
    const step = state.steps[state.currentStep];
    if (!step) return;

    const el = document.querySelector(step.selector);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Wait for scroll to finish, then update rect
    const timer = setTimeout(updateRect, 400);
    return () => clearTimeout(timer);
  }, [state.currentStep, state.isActive, state.isMinimized, state.steps, updateRect]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!state.isActive) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setState((prev) => ({
          ...prev,
          isActive: false,
          isMinimized: false,
          currentStep: 0,
          steps: [],
          targetRect: null,
        }));
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
  }, [state.isActive]);

  const startTour = useCallback((tourId?: string) => {
    const effectivePageId = tourId ?? pageId;
    const stepsForPage = tourSteps[effectivePageId] || [];
    // Filter out steps whose DOM element doesn't exist
    const availableSteps = stepsForPage.filter((step) => {
      return !!document.querySelector(step.selector);
    });

    if (availableSteps.length === 0) return;

    setState({
      isActive: true,
      isMinimized: false,
      currentStep: 0,
      pageId: effectivePageId,
      steps: availableSteps,
      targetRect: null,
    });
  }, [pageId]);

  const stopTour = useCallback(() => {
    markPageSeen(state.pageId);
    setState((prev) => ({
      ...prev,
      isActive: false,
      isMinimized: false,
      currentStep: 0,
      steps: [],
      targetRect: null,
    }));
  }, [state.pageId]);

  const nextStep = useCallback(() => {
    setState((prev) => {
      if (prev.currentStep >= prev.steps.length - 1) {
        markPageSeen(prev.pageId);
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

  const minimizeTour = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: true, targetRect: null }));
  }, []);

  const resumeTour = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: false }));
  }, []);

  const hasSeenTour = useCallback((pid: string) => {
    return !!getSeenPages()[pid];
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
