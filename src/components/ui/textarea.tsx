import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-0 border-b border-input placeholder:text-placeholder-text aria-invalid:border-destructive bg-muted flex field-sizing-content min-h-20 w-full rounded-none px-3 py-2 text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
