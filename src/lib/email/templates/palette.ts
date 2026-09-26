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
 * Light values only, on purpose: the shell sets `color-scheme: light` to opt
 * out of the automatic inversion Apple Mail and Outlook apply, so the dark
 * half of the token set never renders.
 */

import { BRAND_LOCKUP_WORDMARK_PX } from "@/components/brand/BrandMark";

/** Path the drift test reads. Relative to the repo root. */
export const EMAIL_TOKEN_SOURCE = "src/app/globals.css";

/**
 * Which `globals.css` custom property each email colour role is a copy of.
 * The roles are named for their job in an email rather than borrowing the
 * site's names, because the mapping is not always one-to-one — `faint` does
 * duty for both the unsubscribe line and the `·` separators, which on the
 * site are two different treatments.
 */
export const EMAIL_COLOR_TOKENS = {
  ink: "--foreground",
  muted: "--muted-foreground",
  faint: "--faint",
  line: "--border",
  page: "--background",
  card: "--card",
  brand: "--brand",
  onBrand: "--brand-foreground",
} as const;

export type EmailColorRole = keyof typeof EMAIL_COLOR_TOKENS;

export const EMAIL_COLORS = {
  ink: "#FAFAFA",
  muted: "#9CA3AF",
  faint: "#737A87",
  line: "#2D323E",
  page: "#0B0D12",
  card: "#141720",
  brand: "#0E9F4E",
  onBrand: "#0B0D12",
} as const satisfies Record<EmailColorRole, string>;

/**
 * `--font-sans` from `globals.css` with the next/font variable dropped —
 * `var(--font-inter)` cannot resolve in a mail client, and a font-family
 * whose first entry is an unresolvable var falls through unpredictably.
 * Naming Inter directly means the recipients who have it installed get the
 * site's face and everyone else gets the same system fallback chain the site
 * declares.
 */
export const EMAIL_FONT_SANS =
  "'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Title-case wordmark — matched to `BrandLockup` (Source Sans 600, warm white). */
export const EMAIL_WORDMARK = {
  text: "Velai",
  fontSize: BRAND_LOCKUP_WORDMARK_PX,
  fontWeight: 600,
  letterSpacing: "0em",
  /** Warm white — matches in-app `text-wordmark` / `--foreground`. */
  color: EMAIL_COLORS.ink,
} as const;
