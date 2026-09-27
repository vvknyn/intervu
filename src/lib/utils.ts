import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The semantic radius tokens declared in globals.css's @theme block
// (--radius-ctl/-panel/-pill). Exported so tests can assert this list
// stays in sync with globals.css — see tests/unit/cn-radius-tokens.test.ts.
export const RADIUS_TOKENS = ["ctl", "panel", "pill"] as const

// design-language.md §2: "Focus: controls `border-foreground`" — the one
// focus-visible treatment every control primitive (Input, Select, Textarea,
// Button, Tabs) applies. One exported constant so a future control can't
// reintroduce its own ad hoc outline/ring and drift from the others.
export const CONTROL_FOCUS_VISIBLE =
  "designed-focus focus-visible:border-foreground focus-visible:outline-none";

/** Tab bar and icon-only controls — live ring, offset for thumb targets. */
export const CHROME_FOCUS_VISIBLE = "designed-focus-ring focus-visible:outline-none";

// tailwind-merge's default config only recognizes Tailwind's own T-shirt
// size suffixes (sm/lg/xl/...) as members of the `rounded-*` conflict
// group, so it doesn't know our semantic radius tokens conflict with
// rounded-none or with each other — without this, cn("rounded-none",
// "rounded-ctl") keeps BOTH classes and the cascade's tiebreak (not the
// intended override) decides which one renders, silently dropping the
// override on any component whose base already sets a radius (e.g.
// Button's `rounded-none`).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: [...RADIUS_TOKENS],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
