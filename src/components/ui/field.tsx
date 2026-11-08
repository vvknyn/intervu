import * as React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Label + control + optional description/error wrapper (@coss/field adapted to Velai).
 * Backward-compatible with existing `<Field label="..." htmlFor="...">` call sites,
 * while supporting inline `description`, `error`, and composable subparts.
 */
function FieldLabel({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof Label> & { required?: boolean }) {
  return (
    <Label data-slot="field-label" className={cn("inline-flex items-center gap-1", className)} {...props}>
      {children}
      {required && (
        <span aria-hidden="true" className="text-danger-text">
          *
        </span>
      )}
    </Label>
  )
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  if (!children) return null
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn("text-xs text-danger-text", className)}
      {...props}
    >
      {children}
    </p>
  )
}

function Field({
  label,
  htmlFor,
  description,
  error,
  invalid,
  required,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  label?: React.ReactNode
  htmlFor?: string
  description?: React.ReactNode
  error?: React.ReactNode
  invalid?: boolean
  required?: boolean
}) {
  return (
    <div
      data-slot="field"
      data-invalid={invalid || error ? "" : undefined}
      className={cn("flex flex-col gap-2", className)}
      {...props}
    >
      {label != null && (
        <FieldLabel htmlFor={htmlFor} required={required}>
          {label}
        </FieldLabel>
      )}
      {children}
      {description && !error && (
        <FieldDescription id={htmlFor ? `${htmlFor}-description` : undefined}>
          {description}
        </FieldDescription>
      )}
      {error && (
        <FieldError id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </FieldError>
      )}
    </div>
  )
}

export { Field, FieldLabel, FieldDescription, FieldError }
