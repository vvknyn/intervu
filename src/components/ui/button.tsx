import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-all duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-brand focus-visible:ring-offset-0 active:scale-[0.99]",
  {
    variants: {
      variant: {
        default:
          "bg-slate-900/90 text-white hover:bg-slate-900 dark:bg-slate-100/90 dark:text-slate-900 dark:hover:bg-white backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] font-semibold",
        brand: "bg-brand/90 text-brand-foreground hover:bg-brand backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)] font-semibold",
        destructive:
          "bg-destructive/90 text-white hover:bg-destructive backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
        outline:
          "border border-border/80 bg-background/60 hover:bg-muted/80 text-foreground font-medium backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
        secondary:
          "bg-muted/60 text-foreground hover:bg-muted/90 font-medium backdrop-blur-md border border-border/40",
        ghost:
          "hover:bg-muted/60 text-foreground backdrop-blur-xs",
        link: "text-brand underline-offset-4 hover:underline",
        quiet: "border border-border/80 bg-card/60 text-foreground hover:bg-card/90 backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5 text-xs font-medium",
        lg: "h-11 px-6 has-[>svg]:px-4 text-base font-semibold",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
