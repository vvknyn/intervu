import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A single key glyph chip for documenting a keyboard shortcut next to the
 * control it triggers (e.g. the For-you deck's Previous/Next/Skip). House
 * skin: squared corners, hairline border, quiet muted fill, monospace —
 * no codebase primitive for this shape existed yet, so this is new (see
 * the For-you polish deviation note).
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-none border border-border bg-muted px-1 font-mono text-[10px] font-semibold leading-none text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
