"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { resolveThreadRenderMode } from "./thread-render-mode";

/**
 * The soft violet-to-coral radial glow behind the phone mockup — a slow
 * "breathing" scale/opacity oscillation (2026-08-03 one-viewport rebuild).
 * `aria-hidden`, `pointer-events-none`: painted background only.
 *
 * Colors reuse `--oc-violet` / `--oc-coral` (declared identically in both
 * `.openclaw` and `.dark .openclaw` in `openclaw-marketing.css`) rather than
 * a new pair of hardcoded hex values — same theme-invariant tokens the rest
 * of the OpenClaw pitch surfaces already read, so this glow can't drift out
 * of sync with `OpenclawStatusBadge`'s accent color. Callers must render
 * this inside an element with the `.openclaw` class for the vars to resolve.
 *
 * Reuses `resolveThreadRenderMode` (the same reduced-motion decision
 * `WhatsAppThreadHero` and `WatchingWall` already use) rather than a third
 * local reduced-motion branch: reduced motion renders one static frame
 * instead of the oscillating one.
 */
export function DawnGlow({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const mode = resolveThreadRenderMode(prefersReducedMotion);

  return (
    <motion.div
      aria-hidden="true"
      className={cn(
        // No explicit z-index (see `WatchingWall`'s identical comment) — a
        // negative z-index paired with a masked/gradient background layer
        // was found to fail to paint at all in Chromium 145. The phone
        // (`WhatsAppThreadHero`) instead carries an explicit `z-10` at its
        // call site, which is enough to keep this z-index:auto glow behind
        // it without this element needing a negative value itself.
        "pointer-events-none rounded-full blur-3xl",
        "bg-[radial-gradient(circle,rgb(var(--oc-violet))_0%,rgb(var(--oc-coral))_45%,transparent_72%)]",
        className,
      )}
      initial={false}
      animate={
        mode === "animated"
          ? { scale: [1, 1.12, 1], opacity: [0.22, 0.34, 0.22] }
          : { scale: 1, opacity: 0.26 }
      }
      transition={
        mode === "animated"
          ? { duration: 20, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    />
  );
}
