/**
 * Single source of truth for /trends chart colors. These resolve through
 * the same CSS custom properties as the Tailwind semantic tokens
 * (`rgb(var(--brand))` is the literal-color equivalent of the `bg-brand`
 * class) — used via inline `style` only because Tailwind's JIT can't
 * resolve a class built from a JS variable (categorical series index,
 * shared caution accent). Every /trends component that needs one of these
 * imports it from here instead of hand-rolling a literal.
 */
export const TREND_SERIES = [
  "rgb(var(--brand))",
  "rgb(var(--muted-foreground))",
  "rgb(var(--foreground))",
] as const;
export const TREND_CAUTION = "rgb(var(--warn))";
