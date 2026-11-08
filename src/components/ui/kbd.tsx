import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Keyboard shortcut keycap (@coss/kbd adapted to Velai semantic tokens).
 * Pairs inside InputGroupAddon or command tooltips on the semantic sans scale.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 rounded-ctl border border-border bg-muted px-1.5 text-xs font-semibold text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
