"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
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
        default: "flex border-b border-border gap-0 bg-transparent p-0",
        line: "flex border-b border-border gap-0 bg-transparent p-0",
        // Segmented control, not a nav-tab pattern — kept for login-form.tsx's
        // sign-in/create-account toggle, outside this pass's line-tabs scope.
        block: "gap-0 rounded-ctl border border-border bg-muted p-0.5 inline-flex w-fit items-center justify-center group-data-[orientation=horizontal]/tabs:h-auto",
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

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-11 items-center justify-center gap-1.5 rounded-ctl px-4 text-sm font-normal whitespace-nowrap text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
        "-mb-px border-b-2 border-transparent hover:text-foreground",
        "data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:",
        "group-data-[variant=block]/tabs-list:h-8 group-data-[variant=block]/tabs-list:border-b-0 group-data-[variant=block]/tabs-list:data-[state=active]:bg-primary group-data-[variant=block]/tabs-list:data-[state=active]:text-primary-foreground",
        className
      )}
      {...props}
    />
  )
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

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
