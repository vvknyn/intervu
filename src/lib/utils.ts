import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge's default config only recognizes Tailwind's own T-shirt
// size suffixes (sm/lg/xl/...) as members of the `rounded-*` conflict
// group, so it doesn't know our semantic radius tokens (globals.css
// --radius-ctl/-panel/-pill) conflict with rounded-none or with each
// other — without this, cn("rounded-none", "rounded-ctl") keeps BOTH
// classes and the cascade's tiebreak (not the intended override) decides
// which one renders, silently dropping the override on any component
// whose base already sets a radius (e.g. Button's `rounded-none`).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["ctl", "panel", "pill"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
