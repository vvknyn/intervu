import * as React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Label + control wrapper — the one field primitive for every form on the
 * site (login, forgot/reset password, contact). Visible mono-weight label
 * over the control, replacing the sr-only-label + placeholder-only pattern
 * and the various one-off underline/pill input stylings that had grown up
 * around individual forms. Deliberately generic: it renders whatever
 * control is passed as `children` (Input, Textarea, ...), so it never needs
 * to know about a specific surface.
 */
function Field({
  label,
  htmlFor,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: string; htmlFor: string }) {
  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <Label htmlFor={htmlFor} className="text-xs font-bold uppercase tracking-wider text-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export { Field }
