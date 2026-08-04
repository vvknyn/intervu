"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BatteryFull,
  CellSignalFull,
  Checks,
  DotsThreeVertical,
  FileText,
  Microphone,
  Phone,
  VideoCamera,
  WifiHigh,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { WHATSAPP_THREAD } from "./openclaw-content";
import { resolveThreadRenderMode } from "./thread-render-mode";
import { deriveMessageTime } from "./whatsapp-message-time";

const MESSAGE_DELAY_MS = 500;
const MESSAGE_DURATION_S = 0.32;

// Fixed height of the message-reveal viewport (between the date pill and the
// composer) — chosen so the full 7-message thread fits with a few px of
// slack. The device frame is a fixed shell, not a card that grows with the
// conversation, so this never changes with `displayCount`.
const MESSAGE_VIEWPORT_HEIGHT_PX = 416;

// Faint repeating-doodle wallpaper texture behind the chat, at ~4% opacity
// via the wrapping layer's `opacity-[0.04]` below (not baked into the SVG
// itself) — a tiny inline data-URI dot pattern rather than an image asset.
const DOODLE_BACKGROUND_IMAGE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='8' cy='10' r='1.6'/%3E%3Ccircle cx='36' cy='22' r='1.6'/%3E%3Ccircle cx='50' cy='46' r='1.6'/%3E%3Ccircle cx='16' cy='50' r='1.6'/%3E%3Ccircle cx='44' cy='6' r='1.6'/%3E%3C/g%3E%3C/svg%3E\")";

/**
 * The signature phone mockup — a photoreal replica of a WhatsApp dark-mode
 * screenshot (status bar, chat header, doodle-textured message area, WA
 * bubble colors/tails, composer), built entirely from Tailwind + inline SVG
 * (via `@phosphor-icons/react`, already a dependency) with no image assets.
 * The phone shell (frame, status bar, header, date pill, composer) renders
 * at a fixed size on first paint, like a real phone that's already there —
 * it never grows or shrinks. Only the message-reveal viewport between the
 * date pill and composer changes: it's a fixed-height `overflow-hidden`
 * flex column with `justify-end`, so as `WHATSAPP_THREAD` reveals one
 * bubble at a time (mounting each message only once its turn arrives,
 * rather than rendering all of them up front at `opacity: 0`), the newest
 * bubble anchors to the bottom and earlier ones get pushed up and clipped
 * off the top once the stack outgrows the viewport — the same behavior a
 * real WhatsApp thread has, achieved with plain flexbox rather than
 * scroll-position tracking. Reuses framer-motion's `useReducedMotion()`
 * (already used by `TourOverlay.tsx`) rather than hand-rolling a
 * matchMedia subscription; the animated-vs-instant branch itself lives in
 * the pure `resolveThreadRenderMode` so it's unit-testable without
 * rendering this component. This is the only thing that animates on either
 * page it mounts on.
 *
 * The phone screen's colors are literal WhatsApp dark-theme hex values
 * (`#0B141A` chat bg, `#1F2C34` header/composer chrome, `#005C4B` outgoing /
 * `#202C33` incoming bubbles, `#53BDEB` WA blue for read receipts) — fixed
 * regardless of the site's own light/dark theme, the same "lit phone screen,
 * not page chrome" rationale this component has always documented. Unlike
 * the previous build, these are NOT the site's `--oc-*` tokens: a real
 * WhatsApp screenshot doesn't repaint itself when the surrounding page's
 * theme toggles, so this intentionally does not read `--oc-night` /
 * `--oc-coral` / `--oc-bubble` at all.
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

  // The one message that carries a real `timestamp` (found generically,
  // not assumed to be index 0) is the single source of truth every other
  // bubble's displayed time derives from — see `whatsapp-message-time.ts`.
  const baseTimestamp = WHATSAPP_THREAD.find((message) => message.timestamp)?.timestamp;

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[360px] rounded-[30px] bg-black p-[3px]",
        className,
      )}
      role="group"
      aria-label="Example WhatsApp conversation with the agent"
    >
      <div className="overflow-hidden rounded-[27px] bg-[#0B141A]">
        {/* Status bar */}
        <div className="relative flex items-center justify-between bg-[#0B141A] px-4 pb-0.5 pt-1">
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-0.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-black"
          />
          <span className="text-[10px] font-medium text-white/80">8:10</span>
          <span className="flex items-center gap-1 text-white/70" aria-hidden="true">
            <WifiHigh size={11} weight="bold" />
            <CellSignalFull size={11} weight="bold" />
            <BatteryFull size={13} weight="bold" />
          </span>
        </div>

        {/* Chat header */}
        <div className="flex items-center gap-2.5 border-b border-black/20 bg-[#1F2C34] px-3 py-1.5">
          <ArrowLeft size={17} className="shrink-0 text-white/80" aria-hidden="true" />
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2A3942] text-[11px] font-semibold text-white/80">
            in
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium text-white">intervu — your agent</span>
            <span className="text-[10px] text-[#8AAB9A]">online</span>
          </span>
          <span className="flex shrink-0 items-center gap-3 text-white/75" aria-hidden="true">
            <VideoCamera size={16} />
            <Phone size={15} />
            <DotsThreeVertical size={16} weight="bold" />
          </span>
        </div>

        {/* Chat area */}
        <div className="relative bg-[#0B141A]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: DOODLE_BACKGROUND_IMAGE, backgroundSize: "60px 60px" }}
          />
          <div className="relative flex flex-col">
            {/* Date pill — part of the fixed shell, always rendered. */}
            <span className="mx-auto mb-0.5 mt-1.5 rounded-md bg-[#1F2C34] px-2.5 py-0.5 text-[10px] text-white/55">
              Today
            </span>
            {/* Fixed-height clipping viewport — bottom-anchored so the
                newest bubble stays put and earlier ones clip off the top
                once the stack outgrows this height, instead of the panel
                growing to fit every message. */}
            <div
              className="flex flex-col justify-end gap-0.5 overflow-hidden px-2.5 pb-1.5"
              style={{ height: MESSAGE_VIEWPORT_HEIGHT_PX }}
            >
              <AnimatePresence initial={false}>
                {WHATSAPP_THREAD.slice(0, displayCount).map((msg, i) => {
                  // Generic "starts a new run" check — compares this message's
                  // role to the PREVIOUS message's role (not a hardcoded
                  // index), so the tail placement stays correct however the
                  // content's role sequence is authored.
                  const isFirstOfRun = i === 0 || WHATSAPP_THREAD[i - 1].role !== msg.role;
                  const time = baseTimestamp ? deriveMessageTime(baseTimestamp, i) : undefined;
                  return (
                    <motion.div
                      key={i}
                      initial={mode === "animated" ? { opacity: 0, y: 8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: MESSAGE_DURATION_S, ease: "easeOut" }}
                      className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "relative max-w-[80%] rounded-lg px-2.5 py-1 text-[13px] leading-[1.2] text-white",
                          msg.role === "user"
                            ? cn("bg-[#005C4B]", isFirstOfRun && "rounded-br-none")
                            : cn("bg-[#202C33]", isFirstOfRun && "rounded-bl-none"),
                        )}
                      >
                        {isFirstOfRun ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute bottom-0 h-2.5 w-2.5",
                              msg.role === "user"
                                ? "-right-[7px] bg-[#005C4B] [clip-path:polygon(0_0,100%_100%,0_100%)]"
                                : "-left-[7px] bg-[#202C33] [clip-path:polygon(100%_0,100%_100%,0_100%)]",
                            )}
                          />
                        ) : null}
                        <p>{msg.text}</p>
                        {msg.attachment ? (
                          <div
                            role="img"
                            aria-label={msg.attachment}
                            className="mt-1 flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10">
                              <FileText size={13} weight="bold" className="text-white/80" aria-hidden="true" />
                            </span>
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate text-[11.5px] text-white">resume.pdf</span>
                              <span className="text-[9.5px] text-white/50">128 kB · pdf</span>
                            </span>
                          </div>
                        ) : null}
                        {msg.followText ? <p className="mt-0.5">{msg.followText}</p> : null}
                        <div className="flex items-center justify-end gap-1">
                          {time ? <span className="text-[10px] text-white/45">{time}</span> : null}
                          {msg.role === "user" ? (
                            <Checks size={13} className="text-[#53BDEB]" aria-hidden="true" />
                          ) : null}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Composer */}
        <div className="flex items-center gap-2 bg-[#1F2C34] px-3 py-1">
          <span className="flex-1 truncate rounded-full bg-[#2A3942] px-3 py-1 text-[12px] text-white/40">
            Message
          </span>
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/70"
          >
            <Microphone size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}
