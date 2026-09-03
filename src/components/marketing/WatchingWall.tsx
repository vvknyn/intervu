"use client";

import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WATCHING_WALL_TITLES } from "./watching-wall-titles";
import { resolveThreadRenderMode } from "./thread-render-mode";

/** Full drift cycle — one direction, ~100s (spec range: 90-120s). */
const DRIFT_SECONDS = 100;

/**
 * The hero's background signature: a very faint, full-bleed field of real
 * job titles drifting sideways behind the scene (2026-08-03 one-viewport
 * rebuild). Purely decorative — `aria-hidden`, no interactive content, and
 * masked (CSS `mask-image`) so it fades to near-zero behind the left text
 * column where legibility is non-negotiable.
 *
 * Reuses `resolveThreadRenderMode` (already shared by `WhatsAppThreadHero`)
 * for the reduced-motion branch rather than a second reduced-motion check —
 * the decision ("animate or hold still") is identical, only the visual
 * payload differs. Two copies of the row keep the CSS `translate` drift
 * seamless (the second is simply the first's continuation); the animation
 * itself is a plain CSS transform, not framer-motion, since it never needs
 * to react to state — a `<style>` tag scopes the keyframes to this
 * component without adding a global rule to `globals.css` for a single
 * consumer.
 */
export function WatchingWall({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const mode = resolveThreadRenderMode(prefersReducedMotion);
  const rowText = WATCHING_WALL_TITLES.join("    ·    ");

  return (
    <div
      aria-hidden="true"
      className={cn(
        // No explicit z-index here (verified live, 2026-08-03): a
        // NEGATIVE z-index combined with `mask-image` fails to paint at
        // all in Chromium 145 — the element silently renders as fully
        // transparent regardless of mask/opacity/color, even a uniform
        // fully-opaque mask. The foreground layers (hero nav, grid content)
        // instead carry an explicit `z-10`, which is enough on its own to
        // stack this z-index:auto background layer beneath them.
        "pointer-events-none select-none overflow-hidden",
        // Fades to ~0 behind the left column, holds visible on the right —
        // legibility of the headline/search column is non-negotiable. The
        // "visible" stops must be `white`, not `black`: a plain gradient
        // `mask-image` defaults to LUMINANCE masking in Chromium, where
        // black has zero luminance — the same "invisible" value as
        // `transparent` — which made the whole wall vanish everywhere, not
        // just on the left, until this was caught by screenshot (verified
        // live, 2026-08-03).
        // Two gradients INTERSECTED: the horizontal fade above plus a
        // vertical one that clears the nav band at the top and the viewport
        // edge at the bottom — titles crossing the nav row read as clutter
        // next to the CTA (caught by screenshot review, 2026-08-03).
        "[mask-image:linear-gradient(to_right,transparent_0%,transparent_38%,white_66%,white_92%,rgba(255,255,255,0.45)_100%),linear-gradient(to_bottom,transparent_0%,transparent_9%,white_18%,white_88%,transparent_100%)]",
        "[mask-composite:intersect]",
        className,
      )}
    >
      <style>{`
        @keyframes watching-wall-drift {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
      {/* `h-full justify-between` (not `gap-*`) spreads the 6 rows across
          the WHOLE container height — plain flex-col + gap only clusters
          them near the top, since flex children don't stretch to fill
          remaining space by default; the rest of a 100dvh container would
          render with no wall in it at all. */}
      <div className="flex h-full flex-col justify-between whitespace-nowrap text-xs text-foreground/[0.05]">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            key={row}
            className="flex w-max"
            style={
              mode === "animated"
                ? {
                    animation: `watching-wall-drift ${DRIFT_SECONDS + row * 7}s linear infinite`,
                    animationDirection: row % 2 === 0 ? "normal" : "reverse",
                  }
                : undefined
            }
          >
            <span className="pr-6">{rowText}</span>
            <span className="pr-6">{rowText}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
