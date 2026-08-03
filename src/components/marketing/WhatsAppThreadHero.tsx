"use client";

import { motion, useReducedMotion } from "framer-motion";
import { FileText } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { WHATSAPP_THREAD } from "./openclaw-content";
import { resolveThreadRenderMode } from "./thread-render-mode";

const MESSAGE_DELAY_S = 0.5;
const MESSAGE_DURATION_S = 0.32;

/**
 * The signature phone mockup — reveals `WHATSAPP_THREAD` message-by-message
 * once on mount. Reuses framer-motion's `useReducedMotion()` (already used
 * by `TourOverlay.tsx`) rather than hand-rolling a matchMedia subscription;
 * the animated-vs-instant branch itself lives in the pure
 * `resolveThreadRenderMode` so it's unit-testable without rendering this
 * component. This is the only thing that animates on either page it mounts
 * on.
 */
export function WhatsAppThreadHero({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const mode = resolveThreadRenderMode(prefersReducedMotion);

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[360px] overflow-hidden rounded-[26px] border border-border bg-card shadow-lg",
        className,
      )}
      role="group"
      aria-label="Example WhatsApp conversation with the agent"
    >
      <div className="flex items-center gap-2 bg-[rgb(var(--oc-night))] px-4 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--oc-coral))]" aria-hidden="true" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
          WhatsApp · Agent
        </span>
      </div>
      <div className="flex flex-col gap-2 bg-background px-3 py-3.5">
        {WHATSAPP_THREAD.map((msg, i) => (
          <motion.div
            key={i}
            initial={mode === "animated" ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={
              mode === "animated"
                ? { delay: i * MESSAGE_DELAY_S, duration: MESSAGE_DURATION_S, ease: "easeOut" }
                : { duration: 0 }
            }
            className={cn(
              "max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-snug",
              msg.role === "user"
                ? "self-end rounded-tr-sm bg-[rgb(var(--oc-coral))] text-white"
                : "self-start rounded-tl-sm border border-border bg-card text-foreground",
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
                    : "border border-border bg-muted text-muted-foreground",
                )}
              >
                <FileText size={13} weight="bold" aria-hidden="true" />
                resume.pdf
              </span>
            ) : null}
            {msg.followText ? <p className="mt-1">{msg.followText}</p> : null}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
