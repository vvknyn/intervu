"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useIsCompact } from "@/hooks/use-media-query"

type TooltipSide = "top" | "right" | "bottom" | "left"

/** A tip beside its trigger has no room on a phone (the "Relisted" tip ran off
 *  the right edge): left/right become top, which Radix flips to bottom. */
export function compactTooltipSide(side: TooltipSide | undefined, compact: boolean): TooltipSide | undefined {
  return compact && (side === "left" || side === "right") ? "top" : side
}

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 16, side, style, ...props }, ref) => {
  const compact = useIsCompact()
  return (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      side={compactTooltipSide(side, compact)}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      // Inline, so a site's `max-w-*` class cannot lift the cap past the screen.
      style={{ maxWidth: "min(20rem, var(--radix-tooltip-content-available-width))", ...style }}
      className={cn(
        "z-[var(--z-popover)] overflow-hidden rounded-panel bg-foreground px-2 py-1 text-xs text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
