"use client";

import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";
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

interface ShareActionProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick" | "children" | "aria-label"> {
  title: string;
  text: string;
  url: string;
  /** Visible/aria label for the idle state. Omit for an icon-only control
   *  (see CopyJobLinkButton's old idiom in JobDetail.tsx, which this
   *  replaces) — provided, it renders as text instead (e.g. a menu item). */
  label?: string;
  /** Job-surface share — see `ShareRequest.jobId` (share-decision.ts). */
  jobId?: string;
}

/**
 * One reusable share control: the native share sheet when the runtime
 * exposes it, clipboard copy otherwise. Mirrors JobDetail's old
 * CopyJobLinkButton copied-state idiom (Check/Copy icon swap, an aria-label
 * that tracks state) so it reads as native to the rest of the app.
 *
 * `forwardRef` + `...rest` spread (rather than a plain function destructuring
 * only its own props) so this can sit under a Radix `TooltipTrigger asChild`
 * (see JobDetail.tsx's pane-header usage) — `asChild` clones its child via
 * `Slot`, which merges a `ref` and the trigger's pointer/focus handlers onto
 * whatever the child renders; a component that doesn't forward both would
 * silently never open the tooltip, the same way every other `asChild`
 * trigger in this codebase (ContextHelp, JobsTourReplayButton) is a bare
 * `<button>` rather than an opaque component.
 */
export const ShareAction = forwardRef<HTMLButtonElement, ShareActionProps>(function ShareAction(
  { title, text, url, label, className, jobId, ...rest },
  ref,
) {
  const { state, trigger } = useShareControl();

  const displayText = state === "copied" ? "Copied" : state === "failed" ? "Couldn't share" : label;

  return (
    <button
      type="button"
      ref={ref}
      onClick={() => trigger({ title, text, url, jobId })}
      aria-label={displayText ?? "Share"}
      className={className}
      {...rest}
    >
      {label ? (
        displayText
      ) : state === "copied" ? (
        <Check />
      ) : state === "failed" ? (
        <WarningCircle />
      ) : (
        <Copy />
      )}
    </button>
  );
});
