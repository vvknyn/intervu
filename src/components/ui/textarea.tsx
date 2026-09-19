import * as React from "react"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border border-border placeholder:text-placeholder-text aria-invalid:border-destructive bg-card flex field-sizing-content min-h-20 w-full rounded-ctl px-3 py-2 text-base transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
        CONTROL_FOCUS_VISIBLE,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
