"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        // Line tabs (Carbon) — the one tab treatment the rulebook names.
        // A row wider than its box scrolls sideways inside the underline,
        // like the TopBar's phone tab strip, instead of pushing the page
        // wider (the /connect client tabs did at 320px).
        default: "flex max-w-full overflow-x-auto no-scrollbar gap-0 bg-transparent p-0",
        line: "flex max-w-full overflow-x-auto no-scrollbar gap-0 bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * THE tab look — an underline tab, not a pill: no container, fill or radius,
 * and a 2px accent bar under the active item that sits flush with the bottom
 * border of whatever holds it (the header, a `TabsList`). Every tab, view
 * switch and nav link on the site takes its paint from this one recipe; a
 * hand-rolled segmented pill is a defect (tests/unit/tab-primitive-gate.test.ts).
 *
 * "Active" is read from whichever attribute the element already carries for
 * its own semantics — `data-state=active` (Radix tabs), `aria-current` (nav
 * links, view switches), `aria-pressed` (single-select groups) — so a caller
 * never restates it as a class.
 *
 * `font-medium` is deliberate: globals.css maps the medium weight onto the
 * rulebook's 400 (allowed weights are 400/600 only), so the 500 of the design
 * renders at 400 and the active item is told apart by colour + bar, not by
 * weight — which also keeps the row from shifting when the active tab changes.
 */
export const tabItemVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 text-sm font-normal text-muted-foreground transition-colors motion-reduce:transition-none outline-none hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-transparent data-[state=active]:text-foreground data-[state=active]:after:bg-brand aria-[current]:text-foreground aria-[current]:after:bg-brand aria-pressed:text-foreground aria-pressed:after:bg-brand",
  {
    variants: {
      size: {
        // Full header height: a tall hit area, a light visual.
        bar: "h-[var(--topbar-h)]", // control-scale-allow: spans the header row, its height is the bar's, not a control step
        inline: "ctl-md",
      },
    },
    defaultVariants: { size: "inline" },
  }
)

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabItemVariants(), className)}
      {...props}
    />
  )
}

/** A tab that is a link or a plain button rather than a Radix tab — a nav
 *  link, or a view switch that swaps state in place. `current` marks the
 *  active one (`"page"` for a link to the page you are on, `true` for a view
 *  within it); `asChild` paints a `Link`. */
function TabItem({
  current,
  size,
  asChild = false,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-current"> &
  VariantProps<typeof tabItemVariants> & {
    current?: boolean | "page"
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="tab-item"
      {...(asChild ? {} : { type: "button" as const })}
      aria-current={current ? (current === true ? "true" : current) : undefined}
      className={cn(tabItemVariants({ size }), className)}
      {...props}
    />
  )
}

/** The row that holds `TabItem`s — a labelled `<nav>`, no chrome of its own. */
function TabNav({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="tab-nav" className={cn("flex items-center", className)} {...props} />
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabItem, TabNav, tabsListVariants }
