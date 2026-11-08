import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Grouped surface frame (@coss/frame adapted to Velai's semantic token vocabulary).
 * Wraps one or more inner `FramePanel` surfaces inside a quiet recessed well with
 * optional header/footer slots — replacing ad-hoc nested card + bevel-shadow wrappers.
 */
function Frame({
  className,
  stacked = false,
  ...props
}: React.ComponentProps<"div"> & {
  stacked?: boolean
}) {
  return (
    <div
      data-slot="frame"
      data-stacked={stacked ? "" : undefined}
      className={cn(
        // tab-kit: KEEP — Frame is the grouped panel well primitive (@coss/frame), not a segmented tab bar
        "relative flex flex-col rounded-panel border border-border bg-muted p-1",
        stacked
          ? "*:has-[+[data-slot=frame-panel]]:rounded-b-none *:has-[+[data-slot=frame-panel]]:border-b-0 *:[+[data-slot=frame-panel]]:rounded-t-none"
          : "*:[[data-slot=frame-panel]+[data-slot=frame-panel]]:mt-1",
        className,
      )}
      {...props}
    />
  )
}

function FramePanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="frame-panel"
      className={cn(
        "relative rounded-ctl border border-border bg-surface p-4 text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function FrameHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="frame-panel-header"
      className={cn("flex flex-col px-4 py-3", className)}
      {...props}
    />
  )
}

function FrameTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="frame-panel-title"
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function FrameDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="frame-panel-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function FrameFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      data-slot="frame-panel-footer"
      className={cn("flex items-center justify-between gap-2 px-4 py-2.5", className)}
      {...props}
    />
  )
}

export {
  Frame,
  FramePanel,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FrameFooter,
}
