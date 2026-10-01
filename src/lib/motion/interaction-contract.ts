/**
 * TypeScript mirror of motion tokens in `src/app/globals.css`.
 * Tests assert parity; runtime code reads CSS vars through the DOM when needed.
 */

export const MOTION_EASE = {
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  outExit: "cubic-bezier(0.4, 0, 1, 1)",
  stack: "cubic-bezier(0.22, 0.9, 0.24, 1)",
} as const;

/** Durations in milliseconds — keep in sync with `--transition-*` in globals.css. */
export const MOTION_DURATION_MS = {
  instant: 0,
  fast: 100,
  base: 150,
  press: 100,
  lift: 150,
  panel: 150,
  enter: 200,
  deck: 220,
  page: 180,
  stack: 600,
} as const;

export const MOTION_SCALE = {
  press: 0.98,
  liftY: -1,
} as const;

export const MOTION_CSS_VAR = {
  easeStandard: "--ease-standard",
  transitionInstant: "--transition-instant",
  transitionFast: "--transition-fast",
  transitionBase: "--transition-base",
  transitionPress: "--transition-press",
  transitionLift: "--transition-lift",
  transitionPanel: "--transition-panel",
  transitionEnter: "--transition-enter",
  transitionDeck: "--transition-deck",
  transitionPage: "--transition-page",
  transitionStack: "--transition-stack",
  easeStack: "--ease-stack",
  motionPressScale: "--motion-press-scale",
  motionLiftY: "--motion-lift-y",
} as const;

/** SSR-safe reduced-motion probe for JS-only paths (haptics, deck follow). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `useSyncExternalStore` subscription — client snapshot always reads live media query. */
export function subscribePrefersReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function getPrefersReducedMotionSnapshot(): boolean {
  return prefersReducedMotion();
}

export function getPrefersReducedMotionServerSnapshot(): boolean {
  return false;
}
