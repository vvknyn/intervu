"use client";

import { useState } from "react";
import { Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { performShare, type ShareRequest } from "@/lib/share/share-decision";

type VisualState = "idle" | "copied" | "failed";

/**
 * Shared state/timer plumbing behind every share control: attempts the
 * share, and — only for the two outcomes with something to say ("copied",
 * "failed") — shows it for 1.5s before reverting to idle. A completed
 * native share and a cancelled one both leave the control on its idle
 * state: the OS sheet already gave its own feedback, and a cancel isn't a
 * failure. `ShareAction` below and the "Share Velai" menu item
 * (TopBar.tsx) both use this, so neither re-implements the bookkeeping —
 * only their render shell (icon button vs. menu row) differs.
 */
export function useShareControl() {
  const [state, setState] = useState<VisualState>("idle");

  const trigger = async (request: ShareRequest) => {
    const outcome = await performShare(request);
    if (outcome === "copied" || outcome === "failed") {
      setState(outcome);
      setTimeout(() => setState("idle"), 1500);
    }
  };

  return { state, trigger };
}

interface ShareActionProps {
  title: string;
  text: string;
  url: string;
  /** Visible/aria label for the idle state. Omit for an icon-only control
   *  (see CopyJobLinkButton's old idiom in JobDetail.tsx, which this
   *  replaces) — provided, it renders as text instead (e.g. a menu item). */
  label?: string;
  className?: string;
}

/**
 * One reusable share control: the native share sheet when the runtime
 * exposes it, clipboard copy otherwise. Mirrors JobDetail's old
 * CopyJobLinkButton copied-state idiom (Check/Copy icon swap, an aria-label
 * that tracks state) so it reads as native to the rest of the app.
 */
export function ShareAction({ title, text, url, label, className }: ShareActionProps) {
  const { state, trigger } = useShareControl();

  const displayText = state === "copied" ? "Copied" : state === "failed" ? "Couldn't share" : label;

  return (
    <button
      type="button"
      onClick={() => trigger({ title, text, url })}
      aria-label={displayText ?? "Share"}
      className={className}
    >
      {label ? (
        displayText
      ) : state === "copied" ? (
        <Check size={16} weight="bold" />
      ) : state === "failed" ? (
        <WarningCircle size={16} weight="bold" />
      ) : (
        <Copy size={16} />
      )}
    </button>
  );
}
