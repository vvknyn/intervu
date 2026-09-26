/**
 * The product's design tokens, resolved to literal hex for email.
 *
 * Email has no CSS variables — Gmail strips `<head>` styles on forwarded
 * mail, so every rule is inline and every colour is a hex string. That makes
 * a copy of the design system unavoidable. What is avoidable is the copy
 * going stale in silence, which is exactly what happened: these values were
 * taken from `globals.css` before the Swiss Tinted Glass redesign (#217)
 * moved the palette off slate/emerald, and nothing failed. The email kept
 * rendering, the tests kept passing, and the brand colour was simply wrong.
 *
 * So the copy is declared HERE, once, next to the token it copies, and
 * `tests/unit/email-palette-matches-globals.test.ts` reads `globals.css` and
 * fails when the two disagree. Changing a token on the site now breaks a
 * test instead of quietly shipping an off-brand email.
 *
 * Concept A (2026-09-26): charcoal poster header band + cream postcard body.
 * The shell sets `color-scheme: light` so clients do not auto-invert the
 * paper layer into unreadable grey-on-charcoal.
 */

import { BRAND_LOCKUP_WORDMARK_PX } from "@/components/brand/BrandMark";

/** Path the drift test reads. Relative to the repo root. */
export const EMAIL_TOKEN_SOURCE = "src/app/globals.css";

/**
 * Which `globals.css` custom property each email colour role is a copy of.
 * Roles are named for their job in mail HTML, not the site's token names.
 */
export const EMAIL_COLOR_TOKENS = {
  page: "--background",
  band: "--surface-poster",
  bandInk: "--surface-poster-foreground",
  card: "--surface-postcard",
  ink: "--surface-postcard-foreground",
  muted: "--surface-postcard-muted",
  faint: "--surface-postcard-muted",
  brand: "--brand",
  onBrand: "--brand-foreground",
  link: "--brand-muted",
} as const;

/** 12% `--surface-postcard-foreground` over `--surface-postcard` (paper rule). */
export function paperLineHex(postcardForeground: string, postcard: string): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
  };
  const [fr, fg, fb] = parse(postcardForeground);
  const [br, bg, bb] = parse(postcard);
  const a = 0.12;
  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(fr, br))}${toHex(mix(fg, bg))}${toHex(mix(fb, bb))}`.toUpperCase();
}

export const EMAIL_COLORS = {
  page: "#0B0D12",
  band: "#0B0D12",
  bandInk: "#FAFAFA",
  card: "#F4F0E6",
  ink: "#0C1A33",
  muted: "#525252",
  faint: "#525252",
  line: paperLineHex("#0C1A33", "#F4F0E6"),
  brand: "#0E9F4E",
  onBrand: "#0B0D12",
  link: "#108E48",
} as const;

export type EmailColorRole = keyof typeof EMAIL_COLORS;

/**
 * `--font-sans` from `globals.css` with the next/font variable dropped —
 * `var(--font-inter)` cannot resolve in a mail client, and a font-family
 * whose first entry is an unresolvable var falls through unpredictably.
 * Naming Inter directly means the recipients who have it installed get the
 * site's face and everyone else gets the same system fallback chain the site
 * declares.
 */
export const EMAIL_FONT_SANS =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Title-case wordmark — matched to `BrandLockup` (sans 600, tight tracking). */
export const EMAIL_WORDMARK = {
  text: "Velai",
  fontSize: BRAND_LOCKUP_WORDMARK_PX,
  fontWeight: 600,
  letterSpacing: "-0.02em",
} as const;
