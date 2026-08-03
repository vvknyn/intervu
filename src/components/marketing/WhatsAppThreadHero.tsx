"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FileText } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { WHATSAPP_THREAD } from "./openclaw-content";
import { resolveThreadRenderMode } from "./thread-render-mode";

const MESSAGE_DELAY_MS = 500;
const MESSAGE_DURATION_S = 0.32;

/**
 * The signature phone mockup — reveals `WHATSAPP_THREAD` one bubble at a
 * time on mount, mounting each message only once its turn arrives (rather
 * than rendering all of them up front at `opacity: 0`) so the panel actually
 * grows with the conversation instead of pre-reserving its full final
 * height as blank space. Reuses framer-motion's `useReducedMotion()`
 * (already used by `TourOverlay.tsx`) rather than hand-rolling a matchMedia
 * subscription; the animated-vs-instant branch itself lives in the pure
 * `resolveThreadRenderMode` so it's unit-testable without rendering this
 * component. This is the only thing that animates on either page it mounts
 * on.
 *
 * The phone panel is deliberately a fixed dark/night tone in BOTH site
 * light and dark mode — it's a lit phone screen, not page chrome, so it
 * doesn't track `--background`/`--card` the way the rest of `.openclaw`
 * does. `--oc-night` / `--oc-coral` / `--oc-bubble` are defined identically
 * in `.openclaw` and `.dark .openclaw` (openclaw-marketing.css)
 * specifically so referencing them here is theme-invariant.
 */
export function WhatsAppThreadHero({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const mode = resolveThreadRenderMode(prefersReducedMotion);
  // Only the animated path ever needs a counter — the instant path reads
  // the full thread length directly below, so the effect never has reason
  // to set state synchronously in its own body (only from the timer
  // callback), which is what a bare `setVisibleCount(...)` in the "instant"
  // branch would have triggered.
  const [visibleCount, setVisibleCount] = useState(0);
  const displayCount = mode === "instant" ? WHATSAPP_THREAD.length : visibleCount;

  useEffect(() => {
    if (mode === "instant") return;
    if (visibleCount >= WHATSAPP_THREAD.length) return;
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), MESSAGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mode, visibleCount]);

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[360px] overflow-hidden rounded-[26px] border border-border bg-[rgb(var(--oc-night))] shadow-lg",
        className,
      )}
      role="group"
      aria-label="Example WhatsApp conversation with the agent"
    >
      <div className="flex items-center gap-2 border-b border-white/10 bg-[rgb(var(--oc-night))] px-4 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--oc-coral))]" aria-hidden="true" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
          WhatsApp · Agent
        </span>
      </div>
      <div className="flex flex-col gap-2 bg-[rgb(var(--oc-night))] px-3 py-3.5">
        <AnimatePresence initial={false}>
          {WHATSAPP_THREAD.slice(0, displayCount).map((msg, i) => (
            <motion.div
              key={i}
              initial={mode === "animated" ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: MESSAGE_DURATION_S, ease: "easeOut" }}
              className={cn(
                "flex max-w-[82%] flex-col",
                msg.role === "user" ? "self-end items-end" : "self-start items-start",
              )}
            >
              {msg.timestamp ? (
                <span className="mb-1 ml-1 font-mono text-[10px] text-white/40">{msg.timestamp}</span>
              ) : null}
              <div
                className={cn(
                  "rounded-2xl text-[13px] leading-snug",
                  msg.role === "user"
                    ? "min-w-[2.75rem] rounded-tr-sm bg-[rgb(var(--oc-coral))] px-4 py-2.5 text-center text-white"
                    : "rounded-tl-sm border border-white/10 bg-[rgb(var(--oc-bubble))] px-3 py-2 text-left text-white/90",
                )}
              >
                <p>{msg.text}</p>
                {msg.attachment ? (
                  <span
                    role="img"
                    aria-label={msg.attachment}
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]",
                      msg.role === "user"
                        ? "border border-white/35 text-white"
                        : "border border-white/15 bg-black/20 text-white/70",
                    )}
                  >
                    <FileText size={13} weight="bold" aria-hidden="true" />
                    resume.pdf
                  </span>
                ) : null}
                {msg.followText ? <p className="mt-1">{msg.followText}</p> : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
