import * as React from "react"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-placeholder-text selection:bg-brand selection:text-brand-foreground h-11 w-full min-w-0 rounded-ctl border border-border bg-card px-3 text-base transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        CONTROL_FOCUS_VISIBLE,
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
