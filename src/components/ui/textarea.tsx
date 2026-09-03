import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-border placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-brand aria-invalid:ring-destructive dark:aria-invalid:ring-destructive aria-invalid:border-destructive dark:bg-muted bg-muted flex field-sizing-content min-h-16 w-full rounded-lg border px-3 py-2 text-base shadow-sm transition-[color,box-shadow,border-color] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
