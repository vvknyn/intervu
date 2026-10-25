import * as React from "react"
import { CaretDown } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * The one disclosure (WAI-ARIA disclosure pattern) on native `<details>`.
 * Native, not Radix Collapsible, because the closed content must stay in the
 * server-rendered HTML for search engines and Cmd-F (Collapsible unmounts it
 * unless `forceMount`, and then hides it with `hidden`, which find-in-page
 * skips). Zero client JS; the browser owns the keyboard and the open state.
 * `<DisclosureSummary>` must be the first child.
 */
function Disclosure({ className, ...props }: React.ComponentProps<"details">) {
  return <details data-slot="disclosure" className={cn("group/disclosure", className)} {...props} />
}

/** `marker={false}` drops the browser triangle for a caller that draws its own (`DisclosureCaret`). */
function DisclosureSummary({
  className,
  marker = true,
  ...props
}: React.ComponentProps<"summary"> & { marker?: boolean }) {
  return (
    <summary
      data-slot="disclosure-summary"
      className={cn(
        "cursor-pointer rounded-ctl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        !marker && "list-none [&::-webkit-details-marker]:hidden",
        className
      )}
      {...props}
    />
  )
}

/** The chevron that turns over while its `Disclosure` is open. */
function DisclosureCaret({ className, ...props }: React.ComponentProps<typeof CaretDown>) {
  return (
    <CaretDown
      size={16}
      aria-hidden
      className={cn("transition-transform group-open/disclosure:rotate-180", className)}
      {...props}
    />
  )
}

export { Disclosure, DisclosureCaret, DisclosureSummary }
