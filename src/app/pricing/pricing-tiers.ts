/**
 * Single source of truth for the /pricing ladder (v3 — free-only launch,
 * product decision 2026-08-02). One array, rendered via `.map()` in
 * `page.tsx` — a future paid tier is one entry here, never a hand-copied JSX
 * block. `PricingTier`'s `carriesFrom`/`highlight` are unused by the single
 * tier below but kept on the type: paid truth tiers come back later (see
 * /pricing's own copy), not a hypothetical.
 *
 * Replaces the v1 "AI-feature credit packs" framing (`src/lib/pricing.ts`,
 * `src/lib/llm/credit-gate.ts` — untouched, still power other surfaces) and
 * the v2 4-tier ladder. All AI actions (fit checks, tailoring, prep) moved to
 * MCP-only (2026-08-02) — the web app is search + truth signals + tracker.
 */

export interface PricingBullet {
  text: string;
  /** Set only when the bullet itself should be a link (e.g. "Connect your AI (MCP)" -> /connect). */
  href?: string;
}

export type PricingCta =
  | { kind: "link"; label: string; href: string; variant: "default" | "outline" | "quiet" }
  | { kind: "disabled"; label: string; variant: "quiet" };

export interface PricingTier {
  name: string;
  /** The literal price slot — a dollar figure, a unit ("credits/week"), or "let's talk". Always rendered font-mono. */
  price: string;
  /** Short phrase under the price describing what it buys. */
  tagline: string;
  /** Small note near the CTA explaining what the price/credits mean. */
  priceNote: string;
  /** Prior tier name this one carries forward, so bullet copy isn't duplicated tier to tier. */
  carriesFrom?: string;
  bullets: PricingBullet[];
  cta: PricingCta;
  /** Callout tag text (e.g. "Serious hunts") for the one tier meant to be visually promoted. */
  highlight?: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    name: "Free",
    price: "$0",
    tagline: "everything below — no card required",
    priceNote: "paid truth tiers come later",
    bullets: [
      { text: "Search 1.5M+ live verified jobs" },
      { text: "Ghost-signal truth on every posting" },
      { text: "Application tracker" },
      { text: "Connect your AI — fit, tailoring, prep run in YOUR AI", href: "/connect" },
      { text: "Up to 20 applications a day" },
    ],
    cta: { kind: "link", label: "Start free", href: "/", variant: "default" },
  },
];
