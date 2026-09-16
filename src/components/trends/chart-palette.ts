/**
 * Single source of truth for /trends chart colors. The rulebook's color
 * remap (RULEBOOK.md clause 5) leaves categorical series and one caution
 * accent as literal values — Tailwind's semantic tokens (`bg-st-intv`,
 * `text-warn`) resolve through `--warn`, which is NOT the rulebook's
 * caution color (`#B45309`) in this codebase's globals.css. Rather than
 * touch the shared token (out of scope for this change), every /trends
 * component that needs the rulebook's caution or categorical-series colors
 * imports them from here and applies them via inline `style` — Tailwind's
 * JIT can't resolve arbitrary-value classes built from a JS variable, so
 * `style` is the only way to consume a shared constant safely.
 */
export const TREND_SERIES = ["#002FA7", "#8D8D8D", "#0A0A0A"] as const;
export const TREND_CAUTION = "#B45309";
